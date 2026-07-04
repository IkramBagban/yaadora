import { sql, type SQL } from "drizzle-orm";
import { db } from "./client";

/**
 * Format a 1536-d embedding as a pgvector literal (`[0.1,0.2,...]`).
 * Shared by the entity-linking and (later) retrieval raw-SQL helpers.
 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export interface EntityCandidate {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  profile: string | null;
  mentionCount: number;
  /** cosine distance to the mention embedding (lower = closer); null if the
   * candidate has no profile embedding yet or no query embedding was given */
  distance: number | null;
  /** true when canonical_name or an alias matches the mention exactly */
  nameMatch: boolean;
}

/**
 * Entity-linking candidate lookup (spec 02 §2.3): alias / canonical-name match
 * UNION embedding similarity, scoped hard to `user_id` + `type`. Ordered so
 * exact name matches come first, then nearest by cosine distance.
 *
 * This is the deterministic pre-filter before the (rare) disambiguation LLM
 * call. Raw SQL lives here in @repo/db, never in apps or @repo/core callers.
 */
export async function findEntityCandidates(params: {
  userId: string;
  type: string;
  nameGuess: string;
  embedding?: number[] | null;
  limit?: number;
}): Promise<EntityCandidate[]> {
  const { userId, type, nameGuess, embedding, limit = 5 } = params;
  const distanceExpr =
    embedding && embedding.length
      ? sql`(profile_embedding <=> ${toVectorLiteral(embedding)}::vector)`
      : sql`NULL`;

  const rows = await db.execute<{
    id: string;
    type: string;
    canonical_name: string;
    aliases: string[] | null;
    profile: string | null;
    mention_count: number;
    distance: number | null;
    name_match: boolean;
  }>(sql`
    SELECT id, type, canonical_name, aliases, profile, mention_count,
      ${distanceExpr} AS distance,
      (lower(canonical_name) = lower(${nameGuess})
        OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(a) = lower(${nameGuess}))
      ) AS name_match
    FROM entities
    WHERE user_id = ${userId} AND type = ${type}
    ORDER BY name_match DESC, distance ASC NULLS LAST
    LIMIT ${limit}
  `);

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    type: String(r.type),
    canonicalName: String(r.canonical_name),
    aliases: (r.aliases as string[] | null) ?? [],
    profile: (r.profile as string | null) ?? null,
    mentionCount: Number(r.mention_count),
    distance: r.distance == null ? null : Number(r.distance),
    nameMatch: Boolean(r.name_match),
  }));
}

/**
 * Fetch retrieval-shaped memory rows by id (no embedding/fts), scoped to the
 * user. Used to assemble source-memory snippets for citations (spec 02 §3.3).
 * Preserves the caller's id order.
 */
export async function getMemoriesByIds(
  userId: string,
  ids: string[],
): Promise<RetrievedMemory[]> {
  if (!ids.length) return [];
  const rows = await db.execute(sql`
    SELECT m.id, m.user_id, m.raw_text, m.occurred_at, m.created_at, m.source,
           m.status, m.salience, m.pinned
    FROM memories m
    WHERE m.user_id = ${userId} AND m.id IN (${uuidInList(ids)})
  `);
  const mapped = asRows(rows).map((r) => mapMemoryRow(r, "vector").row);
  const order = new Map(ids.map((id, i) => [id, i]));
  return mapped.sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
}

export interface EntityProfile {
  id: string;
  type: string;
  canonicalName: string;
  profile: string | null;
}

/**
 * Fetch consolidated entity profiles by id (spec 02 §3.3 assembly). Scoped to
 * the user; no embeddings over the wire.
 */
export async function getEntityProfiles(
  userId: string,
  ids: string[],
): Promise<EntityProfile[]> {
  if (!ids.length) return [];
  const rows = await db.execute(sql`
    SELECT id, type, canonical_name, profile
    FROM entities
    WHERE user_id = ${userId} AND id IN (${uuidInList(ids)})
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    type: String(r.type),
    canonicalName: String(r.canonical_name),
    profile: r.profile ? String(r.profile) : null,
  }));
}

// ---------------------------------------------------------------------------
// Supersession candidate lookup (spec 02 §2.5) — currently-valid facts about the
// same subject with a similar predicate (embedding + lexical). Raw SQL here; the
// duplicate/update/conflict DECISION lives in @repo/core ingestion.
// ---------------------------------------------------------------------------

export interface SupersessionCandidateParams {
  userId: string;
  /** subject of the new fact; null = a "user" fact (null-safe matched) */
  subjectId: string | null;
  /** new fact embedding, 1536-d */
  embedding: number[];
  /** new fact predicate, for the lexical predicate match signal */
  predicate: string | null;
  /** don't match facts already produced by this same source memory */
  excludeMemory?: string;
  limit?: number;
}

export interface SupersessionCandidate {
  id: string;
  subjectId: string | null;
  predicate: string | null;
  objectText: string | null;
  objectId: string | null;
  factText: string;
  validFrom: Date | null;
  confidence: number;
  factType: string;
  sourceMemory: string;
  /** cosine distance to the new fact embedding (lower = more similar) */
  distance: number;
  /** true when predicate strings match case-insensitively */
  predicateMatch: boolean;
}

/**
 * Find currently-valid facts (`valid_to IS NULL`) about the SAME subject
 * (null-safe) ranked by embedding similarity to the new fact — the candidate
 * set for duplicate / update / conflict detection (spec 02 §2.5).
 */
export async function findSupersessionCandidates(
  params: SupersessionCandidateParams,
): Promise<SupersessionCandidate[]> {
  const { userId, subjectId, embedding, predicate, excludeMemory, limit = 5 } =
    params;
  if (!embedding.length) return [];
  const vec = toVectorLiteral(embedding);

  const conds: SQL[] = [
    sql`user_id = ${userId}`,
    sql`valid_to IS NULL`,
    sql`embedding IS NOT NULL`,
    sql`subject_id IS NOT DISTINCT FROM ${subjectId}::uuid`,
  ];
  if (excludeMemory) conds.push(sql`source_memory <> ${excludeMemory}::uuid`);

  const rows = await db.execute(sql`
    SELECT id, subject_id, predicate, object_text, object_id, fact_text,
           valid_from, confidence, fact_type, source_memory,
           (embedding <=> ${vec}::vector) AS distance,
           (lower(predicate) = lower(${predicate}::text)) AS predicate_match
    FROM facts
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY distance ASC
    LIMIT ${limit}
  `);

  return asRows(rows).map((r) => ({
    id: String(r.id),
    subjectId: r.subject_id ? String(r.subject_id) : null,
    predicate: r.predicate ? String(r.predicate) : null,
    objectText: r.object_text ? String(r.object_text) : null,
    objectId: r.object_id ? String(r.object_id) : null,
    factText: String(r.fact_text),
    validFrom: r.valid_from ? new Date(r.valid_from as string) : null,
    confidence: Number(r.confidence ?? 0),
    factType: String(r.fact_type),
    sourceMemory: String(r.source_memory),
    distance: Number(r.distance ?? 1),
    predicateMatch: Boolean(r.predicate_match),
  }));
}

/**
 * Typed raw-SQL hybrid-retrieval helpers (spec 02 §3.2).
 *
 * Hybrid retrieval lives HERE, in @repo/db — raw SQL never leaks into apps/* or
 * into @repo/core callers. Four channels (vector · lexical · graph · temporal),
 * each returning scored rows; `hybridSearch` fans out, applies HARD time/entity
 * WHERE predicates, and fuses a de-duplicated candidate pool (~50–100) for the
 * reranker in @repo/core.
 */

export type RetrievalChannel = "vector" | "lexical" | "graph" | "temporal";

/** Absolute time window — a HARD SQL predicate, never a similarity hope. */
export interface TimeRange {
  from: Date;
  to: Date;
}

/** Retrieval-shaped memory row (no embedding/fts over the wire). */
export interface RetrievedMemory {
  id: string;
  userId: string;
  rawText: string;
  occurredAt: Date | null;
  createdAt: Date;
  source: string;
  status: string;
  salience: number;
  pinned: boolean;
}

/** Retrieval-shaped fact row (no embedding). */
export interface RetrievedFact {
  id: string;
  userId: string;
  subjectId: string | null;
  predicate: string | null;
  objectText: string | null;
  objectId: string | null;
  factText: string;
  validFrom: Date | null;
  validTo: Date | null;
  confidence: number;
  factType: string;
  origin: string;
  sourceMemory: string;
  salience: number;
  createdAt: Date;
}

export interface Scored<T> {
  row: T;
  /** channel-local score, higher = better */
  score: number;
  channel: RetrievalChannel;
}

/** A candidate after cross-channel fusion (spec 02 §3.2 union). */
export interface FusedCandidate<T> {
  row: T;
  /** fused score in [0,1]-ish; salience is applied downstream as a tie-breaker */
  score: number;
  channels: RetrievalChannel[];
}

export interface VectorSearchParams {
  userId: string;
  /** query embedding, 1536-d (must match the DB column dimension) */
  embedding: number[];
  timeRange?: TimeRange | null;
  /** restrict to facts/memories linked to these resolved entity IDs */
  entityIds?: string[];
  /** prefer currently-valid facts (valid_to IS NULL) unless historical */
  currentOnly?: boolean;
  limit?: number;
}

export interface LexicalSearchParams {
  userId: string;
  /** plain user text; converted to a tsquery inside the helper */
  query: string;
  timeRange?: TimeRange | null;
  entityIds?: string[];
  limit?: number;
}

export interface GraphSearchParams {
  userId: string;
  /** resolved entity IDs — the graph seed. Empty → no graph results. */
  entityIds: string[];
  timeRange?: TimeRange | null;
  currentOnly?: boolean;
  /** hops of neighbour expansion via the fact graph (default 2 = "2-hop"). */
  maxHops?: number;
  limit?: number;
}

export interface TemporalSearchParams {
  userId: string;
  timeRange: TimeRange;
  currentOnly?: boolean;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Internal SQL fragment + row-mapping helpers
// ---------------------------------------------------------------------------

/** Parenthesised, individually-parametrised uuid list for IN (...) clauses. */
function uuidInList(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

function mapMemoryRow(
  r: Record<string, unknown>,
  channel: RetrievalChannel,
): Scored<RetrievedMemory> {
  return {
    row: {
      id: String(r.id),
      userId: String(r.user_id),
      rawText: String(r.raw_text),
      occurredAt: r.occurred_at ? new Date(r.occurred_at as string) : null,
      createdAt: new Date(r.created_at as string),
      source: String(r.source),
      status: String(r.status),
      salience: Number(r.salience ?? 0),
      pinned: Boolean(r.pinned),
    },
    score: Number(r.score ?? 0),
    channel,
  };
}

function mapFactRow(
  r: Record<string, unknown>,
  channel: RetrievalChannel,
): Scored<RetrievedFact> {
  return {
    row: {
      id: String(r.id),
      userId: String(r.user_id),
      subjectId: r.subject_id ? String(r.subject_id) : null,
      predicate: r.predicate ? String(r.predicate) : null,
      objectText: r.object_text ? String(r.object_text) : null,
      objectId: r.object_id ? String(r.object_id) : null,
      factText: String(r.fact_text),
      validFrom: r.valid_from ? new Date(r.valid_from as string) : null,
      validTo: r.valid_to ? new Date(r.valid_to as string) : null,
      confidence: Number(r.confidence ?? 0),
      factType: String(r.fact_type),
      origin: String(r.origin),
      sourceMemory: String(r.source_memory),
      salience: Number(r.salience ?? 0),
      createdAt: new Date(r.created_at as string),
    },
    score: Number(r.score ?? 0),
    channel,
  };
}

const asRows = (rows: unknown): Array<Record<string, unknown>> =>
  rows as unknown as Array<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Vector channel — pgvector cosine (spec 02 §3.2)
// ---------------------------------------------------------------------------

/** Vector channel over `memories.embedding`. Hard time/entity WHERE predicates. */
export async function vectorSearchMemories(
  params: VectorSearchParams,
): Promise<Scored<RetrievedMemory>[]> {
  const { userId, embedding, timeRange, entityIds, limit = 30 } = params;
  if (!embedding.length) return [];
  const vec = toVectorLiteral(embedding);

  const conds: SQL[] = [
    sql`m.user_id = ${userId}`,
    sql`m.embedding IS NOT NULL`,
  ];
  if (timeRange) {
    conds.push(
      sql`COALESCE(m.occurred_at, m.created_at) >= ${timeRange.from} AND COALESCE(m.occurred_at, m.created_at) <= ${timeRange.to}`,
    );
  }
  if (entityIds && entityIds.length) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM memory_entities me WHERE me.memory_id = m.id AND me.entity_id IN (${uuidInList(entityIds)}))`,
    );
  }

  const rows = await db.execute(sql`
    SELECT m.id, m.user_id, m.raw_text, m.occurred_at, m.created_at, m.source,
           m.status, m.salience, m.pinned,
           1 - (m.embedding <=> ${vec}::vector) AS score
    FROM memories m
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY m.embedding <=> ${vec}::vector
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => mapMemoryRow(r, "vector"));
}

/** Vector channel over `facts.embedding`. Prefers current facts unless historical. */
export async function vectorSearchFacts(
  params: VectorSearchParams,
): Promise<Scored<RetrievedFact>[]> {
  const { userId, embedding, timeRange, entityIds, currentOnly, limit = 30 } =
    params;
  if (!embedding.length) return [];
  const vec = toVectorLiteral(embedding);

  const conds: SQL[] = [sql`f.user_id = ${userId}`, sql`f.embedding IS NOT NULL`];
  if (currentOnly) conds.push(sql`f.valid_to IS NULL`);
  if (timeRange) {
    conds.push(
      sql`COALESCE(f.valid_from, f.created_at) >= ${timeRange.from} AND COALESCE(f.valid_from, f.created_at) <= ${timeRange.to}`,
    );
  }
  if (entityIds && entityIds.length) {
    conds.push(
      sql`(f.subject_id IN (${uuidInList(entityIds)}) OR f.object_id IN (${uuidInList(entityIds)}))`,
    );
  }

  const rows = await db.execute(sql`
    SELECT f.id, f.user_id, f.subject_id, f.predicate, f.object_text, f.object_id,
           f.fact_text, f.valid_from, f.valid_to, f.confidence, f.fact_type,
           f.origin, f.source_memory, f.salience, f.created_at,
           1 - (f.embedding <=> ${vec}::vector) AS score
    FROM facts f
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY f.embedding <=> ${vec}::vector
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => mapFactRow(r, "vector"));
}

// ---------------------------------------------------------------------------
// Lexical channel — tsvector / ts_rank_cd over memories.fts (spec 02 §3.2)
// ---------------------------------------------------------------------------

/** Lexical channel over `memories.fts` — catches exact names / rare terms. */
export async function lexicalSearchMemories(
  params: LexicalSearchParams,
): Promise<Scored<RetrievedMemory>[]> {
  const { userId, query, timeRange, entityIds, limit = 30 } = params;
  if (!query.trim()) return [];

  const conds: SQL[] = [sql`m.user_id = ${userId}`, sql`m.fts @@ q`];
  if (timeRange) {
    conds.push(
      sql`COALESCE(m.occurred_at, m.created_at) >= ${timeRange.from} AND COALESCE(m.occurred_at, m.created_at) <= ${timeRange.to}`,
    );
  }
  if (entityIds && entityIds.length) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM memory_entities me WHERE me.memory_id = m.id AND me.entity_id IN (${uuidInList(entityIds)}))`,
    );
  }

  const rows = await db.execute(sql`
    SELECT m.id, m.user_id, m.raw_text, m.occurred_at, m.created_at, m.source,
           m.status, m.salience, m.pinned,
           ts_rank_cd(m.fts, q) AS score
    FROM memories m, websearch_to_tsquery('english', ${query}) q
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => mapMemoryRow(r, "lexical"));
}

// ---------------------------------------------------------------------------
// Graph channel — resolved entities → facts + linked memories + N-hop neighbours
// (indexed FK joins; WITH RECURSIVE for multi-hop). Spec 02 §3.2.
// ---------------------------------------------------------------------------

/** Shared recursive neighbourhood CTE: seed entities expanded via the fact graph. */
function neighbourhoodCte(userId: string, entityIds: string[], maxHops: number): SQL {
  const seed = sql.join(
    entityIds.map((id) => sql`(${id}::uuid)`),
    sql`, `,
  );
  return sql`
    WITH RECURSIVE nbh AS (
      SELECT id AS entity_id, 0 AS depth
      FROM (VALUES ${seed}) AS v(id)
      UNION
      SELECT (CASE WHEN nf.subject_id = nbh.entity_id THEN nf.object_id
                   ELSE nf.subject_id END) AS entity_id,
             nbh.depth + 1
      FROM nbh
      JOIN facts nf
        ON (nf.subject_id = nbh.entity_id OR nf.object_id = nbh.entity_id)
      WHERE nbh.depth < ${maxHops}
        AND nf.user_id = ${userId}
        AND (CASE WHEN nf.subject_id = nbh.entity_id THEN nf.object_id
                  ELSE nf.subject_id END) IS NOT NULL
    )`;
}

/** Graph channel — facts about the resolved entities and their neighbours. */
export async function graphSearchFacts(
  params: GraphSearchParams,
): Promise<Scored<RetrievedFact>[]> {
  const { userId, entityIds, timeRange, currentOnly, maxHops = 2, limit = 40 } =
    params;
  if (!entityIds.length) return [];

  const conds: SQL[] = [sql`f.user_id = ${userId}`];
  if (currentOnly) conds.push(sql`f.valid_to IS NULL`);
  if (timeRange) {
    conds.push(
      sql`COALESCE(f.valid_from, f.created_at) >= ${timeRange.from} AND COALESCE(f.valid_from, f.created_at) <= ${timeRange.to}`,
    );
  }

  const rows = await db.execute(sql`
    ${neighbourhoodCte(userId, entityIds, maxHops)}
    SELECT f.id, f.user_id, f.subject_id, f.predicate, f.object_text, f.object_id,
           f.fact_text, f.valid_from, f.valid_to, f.confidence, f.fact_type,
           f.origin, f.source_memory, f.salience, f.created_at,
           MAX(1.0 / (1 + n.depth)) AS score
    FROM facts f
    JOIN nbh n ON (f.subject_id = n.entity_id OR f.object_id = n.entity_id)
    WHERE ${sql.join(conds, sql` AND `)}
    GROUP BY f.id
    ORDER BY score DESC, f.salience DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => mapFactRow(r, "graph"));
}

/** Graph channel — memories mentioning the resolved entities or their neighbours. */
export async function graphSearchMemories(
  params: GraphSearchParams,
): Promise<Scored<RetrievedMemory>[]> {
  const { userId, entityIds, timeRange, maxHops = 2, limit = 40 } = params;
  if (!entityIds.length) return [];

  const conds: SQL[] = [sql`m.user_id = ${userId}`];
  if (timeRange) {
    conds.push(
      sql`COALESCE(m.occurred_at, m.created_at) >= ${timeRange.from} AND COALESCE(m.occurred_at, m.created_at) <= ${timeRange.to}`,
    );
  }

  const rows = await db.execute(sql`
    ${neighbourhoodCte(userId, entityIds, maxHops)}
    SELECT m.id, m.user_id, m.raw_text, m.occurred_at, m.created_at, m.source,
           m.status, m.salience, m.pinned,
           MAX(1.0 / (1 + n.depth)) AS score
    FROM memories m
    JOIN memory_entities me ON me.memory_id = m.id
    JOIN nbh n ON n.entity_id = me.entity_id
    WHERE ${sql.join(conds, sql` AND `)}
    GROUP BY m.id
    ORDER BY score DESC, m.salience DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => mapMemoryRow(r, "graph"));
}

// ---------------------------------------------------------------------------
// Temporal channel — pure time-window recall (spec 02 §3.2). Hard predicate.
// ---------------------------------------------------------------------------

/** Temporal channel — memories inside the window, most recent first. */
export async function temporalSearchMemories(
  params: TemporalSearchParams,
): Promise<Scored<RetrievedMemory>[]> {
  const { userId, timeRange, limit = 30 } = params;
  const rows = await db.execute(sql`
    SELECT m.id, m.user_id, m.raw_text, m.occurred_at, m.created_at, m.source,
           m.status, m.salience, m.pinned,
           1.0 AS score
    FROM memories m
    WHERE m.user_id = ${userId}
      AND COALESCE(m.occurred_at, m.created_at) >= ${timeRange.from}
      AND COALESCE(m.occurred_at, m.created_at) <= ${timeRange.to}
    ORDER BY COALESCE(m.occurred_at, m.created_at) DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => mapMemoryRow(r, "temporal"));
}

/** Temporal channel — facts valid inside the window. */
export async function temporalSearchFacts(
  params: TemporalSearchParams,
): Promise<Scored<RetrievedFact>[]> {
  const { userId, timeRange, currentOnly, limit = 30 } = params;
  const conds: SQL[] = [
    sql`f.user_id = ${userId}`,
    sql`COALESCE(f.valid_from, f.created_at) >= ${timeRange.from}`,
    sql`COALESCE(f.valid_from, f.created_at) <= ${timeRange.to}`,
  ];
  if (currentOnly) conds.push(sql`f.valid_to IS NULL`);
  const rows = await db.execute(sql`
    SELECT f.id, f.user_id, f.subject_id, f.predicate, f.object_text, f.object_id,
           f.fact_text, f.valid_from, f.valid_to, f.confidence, f.fact_type,
           f.origin, f.source_memory, f.salience, f.created_at,
           1.0 AS score
    FROM facts f
    WHERE ${sql.join(conds, sql` AND `)}
    ORDER BY COALESCE(f.valid_from, f.created_at) DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => mapFactRow(r, "temporal"));
}

// ---------------------------------------------------------------------------
// Hybrid fusion (spec 02 §3.2) — parallel channels, union, de-dup pool
// ---------------------------------------------------------------------------

export interface HybridSearchParams {
  userId: string;
  /** one embedding per rewritten search query (multi-query expansion §3.1) */
  embeddings: number[][];
  /** the rewritten query strings for the lexical channel */
  queries: string[];
  /** resolved entity IDs (graph seed + hard entity filter on vector/lexical) */
  entityIds: string[];
  timeRange?: TimeRange | null;
  /** true unless the query is historical — prefers valid_to IS NULL facts */
  currentOnly?: boolean;
  perChannelLimit?: number;
  /** final de-duplicated pool size (~50–100) handed to the reranker */
  poolLimit?: number;
}

export interface HybridResult {
  memories: FusedCandidate<RetrievedMemory>[];
  facts: FusedCandidate<RetrievedFact>[];
}

/** Min-max normalise a channel's scores to [0,1] so channels fuse comparably. */
function normalise<T>(scored: Scored<T>[]): Array<Scored<T> & { norm: number }> {
  if (!scored.length) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const s of scored) {
    if (s.score < min) min = s.score;
    if (s.score > max) max = s.score;
  }
  const span = max - min;
  return scored.map((s) => ({
    ...s,
    norm: span > 1e-9 ? (s.score - min) / span : 1,
  }));
}

/** Fuse per-channel scored rows by id: max normalised score + small multi-channel bonus. */
function fuse<T extends { id: string }>(
  channelResults: Scored<T>[][],
  poolLimit: number,
): FusedCandidate<T>[] {
  const byId = new Map<
    string,
    { row: T; best: number; channels: Set<RetrievalChannel> }
  >();
  for (const results of channelResults) {
    for (const s of normalise(results)) {
      const existing = byId.get(s.row.id);
      if (existing) {
        existing.best = Math.max(existing.best, s.norm);
        existing.channels.add(s.channel);
      } else {
        byId.set(s.row.id, {
          row: s.row,
          best: s.norm,
          channels: new Set([s.channel]),
        });
      }
    }
  }
  return Array.from(byId.values())
    .map((v) => ({
      row: v.row,
      // multi-channel agreement is a strong precision signal → small bonus.
      score: Math.min(1, v.best + 0.1 * (v.channels.size - 1)),
      channels: Array.from(v.channels),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, poolLimit);
}

/**
 * Hybrid retrieval entry point (spec 02 §3.2): fan out across vector, lexical,
 * graph and temporal channels in parallel, applying HARD time/entity WHERE
 * predicates, then fuse a de-duplicated candidate pool for reranking upstream.
 */
export async function hybridSearch(
  params: HybridSearchParams,
): Promise<HybridResult> {
  const {
    userId,
    embeddings,
    queries,
    entityIds,
    timeRange = null,
    currentOnly = true,
    perChannelLimit = 30,
    poolLimit = 80,
  } = params;

  const memoryChannels: Promise<Scored<RetrievedMemory>[]>[] = [];
  const factChannels: Promise<Scored<RetrievedFact>[]>[] = [];

  // Vector + lexical are the RECALL channels: they search the full user corpus
  // (hard time predicate only). We deliberately do NOT hard-filter them by the
  // resolved entity — entity resolution is imperfect (a memory may not be linked
  // to the entity a query resolves to), and an AND-filter there silently drops
  // real matches to zero. Entity scoping/precision is provided by the graph
  // channel below + reranking, not by gating recall. (spec 02 §3.2)
  for (const embedding of embeddings) {
    memoryChannels.push(
      vectorSearchMemories({
        userId,
        embedding,
        timeRange,
        limit: perChannelLimit,
      }),
    );
    factChannels.push(
      vectorSearchFacts({
        userId,
        embedding,
        timeRange,
        currentOnly,
        limit: perChannelLimit,
      }),
    );
  }

  // Lexical: one pass per query string (includes the user's raw query — this is
  // what recalls literal rare terms like project names).
  for (const query of queries) {
    memoryChannels.push(
      lexicalSearchMemories({
        userId,
        query,
        timeRange,
        limit: perChannelLimit,
      }),
    );
  }

  // Graph: seeded by resolved entities (completeness — "everything about X").
  if (entityIds.length) {
    memoryChannels.push(
      graphSearchMemories({ userId, entityIds, timeRange, limit: perChannelLimit }),
    );
    factChannels.push(
      graphSearchFacts({
        userId,
        entityIds,
        timeRange,
        currentOnly,
        limit: perChannelLimit,
      }),
    );
  }

  // Temporal: pure time-window recall when a range is present.
  if (timeRange) {
    memoryChannels.push(
      temporalSearchMemories({ userId, timeRange, limit: perChannelLimit }),
    );
    factChannels.push(
      temporalSearchFacts({
        userId,
        timeRange,
        currentOnly,
        limit: perChannelLimit,
      }),
    );
  }

  const [memoryResults, factResults] = await Promise.all([
    Promise.all(memoryChannels),
    Promise.all(factChannels),
  ]);

  return {
    memories: fuse(memoryResults, poolLimit),
    facts: fuse(factResults, poolLimit),
  };
}

// ---------------------------------------------------------------------------
// Consolidation helpers (spec 02 §5) — the nightly "sleep" job. Raw SQL here in
// @repo/db; the orchestration + LLM calls live in @repo/core/consolidation.
// ---------------------------------------------------------------------------

/** Distinct user ids with at least one memory — the consolidation work list. */
export async function listUserIdsWithMemories(): Promise<string[]> {
  const rows = await db.execute(sql`SELECT DISTINCT user_id FROM memories`);
  return asRows(rows).map((r) => String(r.user_id));
}

/** Entities touched since `since` (last_seen), i.e. worth a profile rebuild (§5.1). */
export async function findEntitiesTouchedSince(
  userId: string,
  since: Date,
): Promise<Array<{ id: string; type: string; canonicalName: string }>> {
  const rows = await db.execute(sql`
    SELECT id, type, canonical_name
    FROM entities
    WHERE user_id = ${userId} AND (last_seen IS NULL OR last_seen >= ${since})
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    type: String(r.type),
    canonicalName: String(r.canonical_name),
  }));
}

/** Current (valid_to IS NULL) fact texts about an entity — profile rebuild input. */
export async function getCurrentFactTextsForEntity(
  userId: string,
  entityId: string,
  limit = 100,
): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT fact_text
    FROM facts
    WHERE user_id = ${userId} AND valid_to IS NULL
      AND (subject_id = ${entityId}::uuid OR object_id = ${entityId}::uuid)
    ORDER BY salience DESC, confidence DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => String(r.fact_text));
}

/** Persist a rebuilt entity profile + its embedding (§5.1). */
export async function updateEntityProfile(
  entityId: string,
  profile: string,
  profileEmbedding: number[],
): Promise<void> {
  await db.execute(sql`
    UPDATE entities
    SET profile = ${profile},
        profile_embedding = ${toVectorLiteral(profileEmbedding)}::vector
    WHERE id = ${entityId}::uuid
  `);
}

/**
 * Near-duplicate current-fact pairs about the same subject (§5.2). Returns
 * ordered pairs (keep, drop) with the higher-confidence fact as `keep`.
 */
export async function findDuplicateFactPairs(
  userId: string,
  maxDistance = 0.08,
): Promise<Array<{ keepId: string; dropId: string }>> {
  const rows = await db.execute(sql`
    SELECT a.id AS a_id, b.id AS b_id,
           a.confidence AS a_conf, b.confidence AS b_conf
    FROM facts a
    JOIN facts b
      ON a.user_id = b.user_id
     AND a.subject_id IS NOT DISTINCT FROM b.subject_id
     AND a.id < b.id
     AND a.valid_to IS NULL AND b.valid_to IS NULL
     AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
     AND (a.embedding <=> b.embedding) <= ${maxDistance}
    WHERE a.user_id = ${userId}
  `);
  return asRows(rows).map((r) => {
    const aConf = Number(r.a_conf ?? 0);
    const bConf = Number(r.b_conf ?? 0);
    const aId = String(r.a_id);
    const bId = String(r.b_id);
    return aConf >= bConf
      ? { keepId: aId, dropId: bId }
      : { keepId: bId, dropId: aId };
  });
}

/** Merge a duplicate: supersede `dropId` into `keepId` and reinforce it (§5.2). */
export async function mergeDuplicateFact(
  keepId: string,
  dropId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE facts SET confidence = LEAST(1.0, confidence + 0.05)
    WHERE id = ${keepId}::uuid AND valid_to IS NULL
  `);
  await db.execute(sql`
    UPDATE facts SET valid_to = now(), superseded_by = ${keepId}::uuid
    WHERE id = ${dropId}::uuid AND valid_to IS NULL
  `);
}

/** Recent episodic memory snippets for pattern mining (§5.3). */
export async function getRecentEpisodicMemories(
  userId: string,
  since: Date,
  limit = 200,
): Promise<Array<{ id: string; rawText: string; occurredAt: Date | null }>> {
  const rows = await db.execute(sql`
    SELECT id, raw_text, occurred_at
    FROM memories
    WHERE user_id = ${userId}
      AND status = 'processed'
      AND COALESCE(occurred_at, created_at) >= ${since}
    ORDER BY COALESCE(occurred_at, created_at) DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    rawText: String(r.raw_text),
    occurredAt: r.occurred_at ? new Date(r.occurred_at as string) : null,
  }));
}

/**
 * Recompute salience (§5.4) as a retrieval tie-breaker prior. NEVER deletes.
 *   memories: recency(30d) + provenance-richness + pin boost
 *   facts:    recency(30d) + confidence + preference/reflection weight
 * Applied to current facts only; historical facts keep their last score.
 */
export async function rescoreSalience(userId: string): Promise<void> {
  await db.execute(sql`
    UPDATE memories SET salience =
        0.5 * exp(-extract(epoch FROM (now() - COALESCE(occurred_at, created_at))) / (60*60*24*30))
      + 0.3 * LEAST(1.0, (SELECT count(*) FROM facts f WHERE f.source_memory = memories.id) / 5.0)
      + CASE WHEN pinned THEN 0.4 ELSE 0 END
    WHERE user_id = ${userId}
  `);
  await db.execute(sql`
    UPDATE facts SET salience =
        0.4 * exp(-extract(epoch FROM (now() - COALESCE(valid_from, created_at))) / (60*60*24*30))
      + 0.4 * confidence
      + CASE WHEN fact_type IN ('preference', 'reflection') THEN 0.2 ELSE 0 END
    WHERE user_id = ${userId} AND valid_to IS NULL
  `);
}
