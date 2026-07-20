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
    WHERE user_id = ${userId} AND (last_seen IS NULL OR last_seen >= ${since.toISOString()})
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
      AND COALESCE(occurred_at, created_at) >= ${since.toISOString()}
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

// ---------------------------------------------------------------------------
// entity_edges materialization (spec 02 §2.5) — derived-of-derived, rebuilt
// nightly by consolidation. DROP TABLE + rerun must reproduce it, so this is a
// full per-user rebuild (delete then re-derive), never an incremental patch.
// ---------------------------------------------------------------------------

/** Predicate fingerprints that, on their own, mark an edge `unresolved`. */
const EDGE_CONFLICT_PREDICATE_RE =
  "conflict|dispute|disput|unresolved|fell out|feud|estrange|fallout|owed|owes|argument|tension|rift";

/**
 * Rebuild `entity_edges` for one user from entity→entity facts, with
 * strength/recency enriched by `memory_entities` co-mention statistics and a
 * derived `status` (spec 02 §2.5, spec 03 P3 item 5).
 *
 * - Edges come from facts that connect two DISTINCT entities (both subject_id and
 *   object_id set); `rel_type` is the fact predicate. Pairs are normalized
 *   `a_id < b_id`; predicate semantics carry direction. BOTH current and closed
 *   facts contribute so an over-but-remembered relationship still surfaces as an
 *   edge (scenario 3: "co-founded with Vikram (ended)").
 * - `evidence` = the distinct source memories of the contributing facts
 *   (multi-provenance, fixes the single-provenance TODO).
 * - `strength` = co-mention frequency × recency(30-day exp decay).
 * - `status` is DERIVED:
 *     • `ended`      — the pair has NO currently-valid fact for this rel_type
 *                      (all superseded / valid_to-closed).
 *     • `unresolved` — a currently-live edge whose predicate reads as a conflict,
 *                      OR an open `unresolved_conflict` loop is attached to one of
 *                      the endpoints.
 *     • `active`     — the default.
 *
 * User edge-review flags (spec 03 P3 item 7) are stored on `status = 'flagged'`.
 * They are USER HISTORY, not derivable from the log, so this rebuild preserves
 * them across the delete+reinsert by natural key (user, a_id, b_id, rel_type).
 * A pure drop-table + rerun (the rebuild-story test, spec 02 §9) still reproduces
 * every DERIVED edge — the flag simply starts empty, exactly as user history
 * should. `flagged` wins over any derived status so a flagged edge stays excluded.
 *
 * Returns the number of edges written. Delete-then-insert makes it idempotent.
 */
export async function materializeEntityEdges(userId: string): Promise<number> {
  // Preserve user edge-review flags across the rebuild (natural key).
  const flaggedRows = await db.execute(sql`
    SELECT a_id, b_id, rel_type
    FROM entity_edges
    WHERE user_id = ${userId} AND status = 'flagged'
  `);
  const flagged = asRows(flaggedRows).map((r) => ({
    aId: String(r.a_id),
    bId: String(r.b_id),
    relType: String(r.rel_type),
  }));

  await db.execute(sql`DELETE FROM entity_edges WHERE user_id = ${userId}`);
  const rows = await db.execute(sql`
    WITH edge_facts AS (
      SELECT
        LEAST(subject_id, object_id)          AS a_id,
        GREATEST(subject_id, object_id)       AS b_id,
        predicate                             AS rel_type,
        array_agg(DISTINCT source_memory)     AS evidence,
        max(COALESCE(valid_from, created_at)) AS fact_last,
        bool_or(valid_to IS NULL)             AS has_current,
        bool_or(
          valid_to IS NULL
          AND predicate ~* ${EDGE_CONFLICT_PREDICATE_RE}
        )                                     AS predicate_conflict
      FROM facts
      WHERE user_id = ${userId}
        AND subject_id IS NOT NULL
        AND object_id IS NOT NULL
        AND subject_id <> object_id
        AND predicate IS NOT NULL
      GROUP BY 1, 2, 3
    ),
    comention AS (
      SELECT
        LEAST(me1.entity_id, me2.entity_id)        AS a_id,
        GREATEST(me1.entity_id, me2.entity_id)     AS b_id,
        count(DISTINCT me1.memory_id)              AS freq,
        max(COALESCE(m.occurred_at, m.created_at)) AS last_mentioned
      FROM memory_entities me1
      JOIN memory_entities me2
        ON me1.memory_id = me2.memory_id
       AND me1.entity_id < me2.entity_id
      JOIN memories m  ON m.id  = me1.memory_id
      JOIN entities ea ON ea.id = me1.entity_id AND ea.user_id = ${userId}
      JOIN entities eb ON eb.id = me2.entity_id AND eb.user_id = ${userId}
      GROUP BY 1, 2
    ),
    conflict_entities AS (
      SELECT DISTINCT entity_id
      FROM open_loops
      WHERE user_id = ${userId}
        AND status = 'open'
        AND kind = 'unresolved_conflict'
        AND entity_id IS NOT NULL
    )
    INSERT INTO entity_edges
      (user_id, a_id, b_id, rel_type, status, strength, last_mentioned, evidence, updated_at)
    SELECT
      ${userId}, ef.a_id, ef.b_id, ef.rel_type,
      CASE
        WHEN NOT ef.has_current THEN 'ended'
        WHEN ef.predicate_conflict
          OR ef.a_id IN (SELECT entity_id FROM conflict_entities)
          OR ef.b_id IN (SELECT entity_id FROM conflict_entities)
          THEN 'unresolved'
        ELSE 'active'
      END,
      COALESCE(cm.freq, 1) * exp(
        -extract(epoch FROM (now() - COALESCE(cm.last_mentioned, ef.fact_last, now())))
        / (60 * 60 * 24 * 30)
      ),
      COALESCE(cm.last_mentioned, ef.fact_last),
      ef.evidence,
      now()
    FROM edge_facts ef
    LEFT JOIN comention cm ON cm.a_id = ef.a_id AND cm.b_id = ef.b_id
    RETURNING id
  `);

  // Re-apply preserved flags (flag wins over derived status).
  for (const f of flagged) {
    await db.execute(sql`
      UPDATE entity_edges
      SET status = 'flagged'
      WHERE user_id = ${userId}
        AND a_id = ${f.aId}::uuid
        AND b_id = ${f.bId}::uuid
        AND rel_type = ${f.relType}
    `);
  }

  return asRows(rows).length;
}

/**
 * Flag an entity edge as a bad link ("wrong person", spec 03 P3 item 7).
 * Stored as `status = 'flagged'`, which excludes it from context assembly and
 * survives nightly rebuild (see `materializeEntityEdges`). Ownership-checked.
 * Returns the flagged edge's natural key, or null if not found / not owned.
 */
export async function flagEntityEdge(
  userId: string,
  edgeId: string,
): Promise<{ id: string } | null> {
  const rows = await db.execute(sql`
    UPDATE entity_edges
    SET status = 'flagged'
    WHERE id = ${edgeId}::uuid AND user_id = ${userId}
    RETURNING id
  `);
  const row = asRows(rows)[0];
  return row ? { id: String(row.id) } : null;
}

// ---------------------------------------------------------------------------
// Digests (spec 02 §3.2) — small, cache-like, rebuildable summaries the context
// pack (§4) reads. Consolidation writes them; the pack reads them.
// ---------------------------------------------------------------------------

/**
 * Current (valid_to IS NULL) facts ABOUT THE USER (subject "user" → subject_id
 * NULL), excluding consolidation-mined reflections. Input to the profile digest.
 */
export async function getUserProfileFactTexts(
  userId: string,
  limit = 60,
): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT fact_text
    FROM facts
    WHERE user_id = ${userId}
      AND valid_to IS NULL
      AND subject_id IS NULL
      AND origin = 'extraction'
      AND fact_type <> 'reflection'
    ORDER BY salience DESC, confidence DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => String(r.fact_text));
}

/** Conversation summaries touched since `since` — input to the 7-day digest. */
export async function getRecentConversationSummaries(
  userId: string,
  since: Date,
  limit = 20,
): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT summary
    FROM conversations
    WHERE user_id = ${userId}
      AND summary IS NOT NULL
      AND last_turn_at >= ${since.toISOString()}
    ORDER BY last_turn_at DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => String(r.summary));
}

/** Upsert a digest keyed by (user, kind) — cheap, overwrite-on-rebuild. */
export async function upsertDigest(
  userId: string,
  kind: string,
  content: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO digests (user_id, kind, content, updated_at)
    VALUES (${userId}, ${kind}, ${content}, now())
    ON CONFLICT (user_id, kind)
    DO UPDATE SET content = EXCLUDED.content, updated_at = now()
  `);
}

/** Read a digest's content (null if it has not been built yet). */
export async function getDigest(
  userId: string,
  kind: string,
): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT content FROM digests
    WHERE user_id = ${userId} AND kind = ${kind}
    LIMIT 1
  `);
  const row = asRows(rows)[0];
  return row?.content != null ? String(row.content) : null;
}

export interface DueOpenLoop {
  id: string;
  kind: string;
  title: string;
  dueAt: Date | null;
}

/**
 * Open loops with a `due_at` at or before `within` (the context pack's near
 * window, spec 02 §4). Ordered soonest-first. Past-due-but-still-open loops are
 * included — they're unfinished threads until resolved or expired.
 */
export async function getDueOpenLoops(
  userId: string,
  within: Date,
  limit = 20,
): Promise<DueOpenLoop[]> {
  // Bind as ISO text — raw Date can serialize as a non-timestamp string under
  // postgres.js and fail the due_at comparison.
  const withinIso = within.toISOString();
  const rows = await db.execute(sql`
    SELECT id, kind, title, due_at
    FROM open_loops
    WHERE user_id = ${userId}
      AND status = 'open'
      AND due_at IS NOT NULL
      AND due_at <= ${withinIso}::timestamptz
    ORDER BY due_at ASC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    title: String(r.title),
    dueAt: r.due_at ? new Date(r.due_at as string) : null,
  }));
}

// ---------------------------------------------------------------------------
// Reminders, read side (spec 01 §3.6).
//
// `open_loops` are LLM-inferred commitments; `reminders` are the user-facing
// scheduled items the Reminders tab shows, carrying accept/dismiss state. The
// Ask agent needs the latter — both to answer "what's on my plate" and to avoid
// creating a duplicate of a reminder that already exists.
// ---------------------------------------------------------------------------

export interface ReminderRow {
  id: string;
  text: string;
  dueAt: Date;
  status: string;
  origin: string;
  recurrence: string;
}

/**
 * Pending reminders due at or before `within`, soonest first.
 *
 * Past-due pending reminders are included: an overdue reminder is the most
 * relevant thing the user could be asked about, and hiding it would let the
 * agent claim there's nothing outstanding when there is.
 *
 * `status = 'suggested'` is deliberately excluded — an unconfirmed suggestion
 * is not yet a commitment the user has made, and treating it as one is exactly
 * the "app decides on your behalf" behaviour the product avoids.
 */
export async function getDueReminders(
  userId: string,
  within: Date,
  limit = 20,
): Promise<ReminderRow[]> {
  // Bind as ISO text — a raw Date can serialize as a non-timestamp string
  // under postgres.js and silently fail the comparison (same as open loops).
  const withinIso = within.toISOString();
  const rows = await db.execute(sql`
    SELECT id, text, due_at, status, origin, recurrence
    FROM reminders
    WHERE user_id = ${userId}
      AND status = 'pending'
      AND due_at <= ${withinIso}::timestamptz
    ORDER BY due_at ASC
    LIMIT ${limit}
  `);
  return asRows(rows).map(toReminderRow);
}

/**
 * Reminders matching a free-text query, for the agent's `search_reminders`.
 *
 * Deliberately ILIKE rather than full-text: reminders are short, literal
 * strings ("call the bank"), there's no tsvector column on the table, and the
 * agent is usually checking for a near-exact restatement of something it or the
 * user just said. Stemming would buy little and cost a migration.
 *
 * @param statuses which lifecycle states to include. Defaults to pending only.
 */
export async function searchReminders(
  userId: string,
  query: string,
  opts: { statuses?: string[]; limit?: number } = {},
): Promise<ReminderRow[]> {
  const statuses = opts.statuses?.length ? opts.statuses : ["pending"];
  const limit = opts.limit ?? 20;
  const trimmed = query.trim();

  // An empty query means "show me everything in these states", not "match ''".
  const pattern = trimmed.length > 0 ? `%${trimmed}%` : "%";

  const rows = await db.execute(sql`
    SELECT id, text, due_at, status, origin, recurrence
    FROM reminders
    WHERE user_id = ${userId}
      AND status = ANY(${statuses})
      AND text ILIKE ${pattern}
    ORDER BY due_at ASC
    LIMIT ${limit}
  `);
  return asRows(rows).map(toReminderRow);
}

/**
 * Pending reminders whose due time falls within `windowHours` of `dueAt`.
 * Used as the duplicate guard before inserting: "remind me to call mom Sunday"
 * twice should not produce two rows.
 */
export async function findNearbyPendingReminders(
  userId: string,
  dueAt: Date,
  windowHours = 24,
  limit = 10,
): Promise<ReminderRow[]> {
  const dueIso = dueAt.toISOString();
  const rows = await db.execute(sql`
    SELECT id, text, due_at, status, origin, recurrence
    FROM reminders
    WHERE user_id = ${userId}
      AND status = 'pending'
      AND due_at BETWEEN
        ${dueIso}::timestamptz - make_interval(hours => ${windowHours})
        AND ${dueIso}::timestamptz + make_interval(hours => ${windowHours})
    ORDER BY due_at ASC
    LIMIT ${limit}
  `);
  return asRows(rows).map(toReminderRow);
}

function toReminderRow(r: Record<string, unknown>): ReminderRow {
  return {
    id: String(r.id),
    text: String(r.text),
    dueAt: new Date(r.due_at as string),
    status: String(r.status),
    origin: String(r.origin),
    recurrence: String(r.recurrence ?? "once"),
  };
}

// ---------------------------------------------------------------------------
// Graph doorway (spec 02 §5.2) — turn-time entity linking + entity-context
// assembly. Raw SQL lives HERE in @repo/db; the linking DECISION + assembler
// orchestration live in @repo/core/retrieval.
// ---------------------------------------------------------------------------

export interface LinkableEntity {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
}

/**
 * All of a user's entities as lexical-match fodder for the turn-time linker
 * (spec 02 §5.2): id, type, canonical name, aliases. No embeddings over the
 * wire — the linker scans names first and only embeds to break ambiguity. A
 * decade of heavy use is a few thousand entities, so a full scan is cheap.
 */
export async function listLinkableEntities(
  userId: string,
): Promise<LinkableEntity[]> {
  const rows = await db.execute(sql`
    SELECT id, type, canonical_name, aliases
    FROM entities
    WHERE user_id = ${userId}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    type: String(r.type),
    canonicalName: String(r.canonical_name),
    aliases: (r.aliases as string[] | null) ?? [],
  }));
}

/**
 * Cosine distance from a turn embedding to specific entities' profile
 * embeddings (spec 02 §5.2) — used ONLY to break a same-name ambiguity in the
 * turn-time linker. Returns id → distance (lower = closer); entities without a
 * profile embedding are omitted.
 */
export async function entityEmbeddingDistances(
  userId: string,
  ids: string[],
  embedding: number[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length || !embedding.length) return out;
  const vec = toVectorLiteral(embedding);
  const rows = await db.execute(sql`
    SELECT id, (profile_embedding <=> ${vec}::vector) AS distance
    FROM entities
    WHERE user_id = ${userId}
      AND id IN (${uuidInList(ids)})
      AND profile_embedding IS NOT NULL
  `);
  for (const r of asRows(rows)) {
    out.set(String(r.id), Number(r.distance));
  }
  return out;
}

export interface EntityContextCore {
  id: string;
  type: string;
  canonicalName: string;
  profile: string | null;
}

/** Entity identity + consolidated profile (assembler + ownership check). */
export async function getEntityContextCore(
  userId: string,
  entityId: string,
): Promise<EntityContextCore | null> {
  const rows = await db.execute(sql`
    SELECT id, type, canonical_name, profile
    FROM entities
    WHERE user_id = ${userId} AND id = ${entityId}::uuid
    LIMIT 1
  `);
  const r = asRows(rows)[0];
  if (!r) return null;
  return {
    id: String(r.id),
    type: String(r.type),
    canonicalName: String(r.canonical_name),
    profile: r.profile ? String(r.profile) : null,
  };
}

export interface EntityOpenLoop {
  id: string;
  kind: string;
  title: string;
  dueAt: Date | null;
  sourceMemory: string;
}

/** Open loops attached to an entity (spec 02 §5.2), most recent first. */
export async function getOpenLoopsForEntity(
  userId: string,
  entityId: string,
  limit = 20,
): Promise<EntityOpenLoop[]> {
  const rows = await db.execute(sql`
    SELECT id, kind, title, due_at, source_memory
    FROM open_loops
    WHERE user_id = ${userId}
      AND entity_id = ${entityId}::uuid
      AND status = 'open'
    ORDER BY COALESCE(due_at, created_at) DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    title: String(r.title),
    dueAt: r.due_at ? new Date(r.due_at as string) : null,
    sourceMemory: String(r.source_memory),
  }));
}

export interface EntityCurrentFact {
  id: string;
  predicate: string | null;
  factText: string;
  sourceMemory: string;
  salience: number;
}

/**
 * Top currently-valid facts about an entity (spec 02 §5.2): subject OR object =
 * entity, `valid_to IS NULL`, ordered by salience. Cap ≤8 at the call site.
 */
export async function getTopCurrentFactsForEntity(
  userId: string,
  entityId: string,
  limit = 8,
): Promise<EntityCurrentFact[]> {
  const rows = await db.execute(sql`
    SELECT id, predicate, fact_text, source_memory, salience
    FROM facts
    WHERE user_id = ${userId}
      AND valid_to IS NULL
      AND (subject_id = ${entityId}::uuid OR object_id = ${entityId}::uuid)
    ORDER BY salience DESC, confidence DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    predicate: r.predicate ? String(r.predicate) : null,
    factText: String(r.fact_text),
    sourceMemory: String(r.source_memory),
    salience: Number(r.salience ?? 0),
  }));
}

export interface EntityOneHopEdge {
  id: string;
  relType: string;
  status: string;
  strength: number;
  lastMentioned: Date | null;
  evidence: string[];
  /** the OTHER endpoint of the edge (relative to the queried entity) */
  otherId: string;
  otherName: string;
  otherType: string;
  /** whether the other endpoint is itself a known entity node (spec 02 §5.2) */
  otherIsKnownEntity: boolean;
}

/**
 * 1-hop edges for an entity (spec 02 §5.2), strongest first, cap ≤6 at the call
 * site. FLAGGED edges (bad links the user reported) are EXCLUDED. Each row
 * resolves the other endpoint's name/type so the reasoning model can make the
 * 2-hop connection (scenario 3: "co-founded with Vikram (ended)") without any
 * traversal machinery.
 */
export async function getOneHopEdges(
  userId: string,
  entityId: string,
  limit = 6,
): Promise<EntityOneHopEdge[]> {
  const rows = await db.execute(sql`
    SELECT
      e.id, e.rel_type, e.status, e.strength, e.last_mentioned, e.evidence,
      other.id   AS other_id,
      other.canonical_name AS other_name,
      other.type AS other_type
    FROM entity_edges e
    JOIN entities other
      ON other.id = (CASE WHEN e.a_id = ${entityId}::uuid THEN e.b_id ELSE e.a_id END)
     AND other.user_id = ${userId}
    WHERE e.user_id = ${userId}
      AND (e.a_id = ${entityId}::uuid OR e.b_id = ${entityId}::uuid)
      AND e.status <> 'flagged'
    ORDER BY e.strength DESC, e.last_mentioned DESC NULLS LAST
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    relType: String(r.rel_type),
    status: String(r.status),
    strength: Number(r.strength ?? 0),
    lastMentioned: r.last_mentioned ? new Date(r.last_mentioned as string) : null,
    evidence: (r.evidence as string[] | null) ?? [],
    otherId: String(r.other_id),
    otherName: String(r.other_name),
    otherType: String(r.other_type),
    otherIsKnownEntity: true,
  }));
}

export interface EntityNotableEdge {
  id: string;
  relType: string;
  status: string;
  strength: number;
  lastMentioned: Date | null;
  evidence: string[];
  otherName: string;
}

/**
 * Notable edges for the awareness pass (spec 03 P3 item 4): edges attached to an
 * entity that are either `unresolved`, or strong-but-stale (not mentioned in the
 * last `staleDays`). Flagged edges excluded. Ordered unresolved-first, then by
 * strength. These feed edge_nudge candidates.
 */
export async function getNotableEdgesForEntity(params: {
  userId: string;
  entityId: string;
  now?: Date;
  staleDays?: number;
  limit?: number;
}): Promise<EntityNotableEdge[]> {
  const { userId, entityId, limit = 4 } = params;
  const now = params.now ?? new Date();
  const staleDays = params.staleDays ?? 90;
  const staleBefore = new Date(
    now.getTime() - staleDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = await db.execute(sql`
    SELECT
      e.id, e.rel_type, e.status, e.strength, e.last_mentioned, e.evidence,
      other.canonical_name AS other_name
    FROM entity_edges e
    JOIN entities other
      ON other.id = (CASE WHEN e.a_id = ${entityId}::uuid THEN e.b_id ELSE e.a_id END)
     AND other.user_id = ${userId}
    WHERE e.user_id = ${userId}
      AND (e.a_id = ${entityId}::uuid OR e.b_id = ${entityId}::uuid)
      AND e.status <> 'flagged'
      AND array_length(e.evidence, 1) >= 1
      AND (
        e.status = 'unresolved'
        OR (
          e.strength > 0
          AND (e.last_mentioned IS NULL OR e.last_mentioned < ${staleBefore}::timestamptz)
        )
      )
    ORDER BY (e.status = 'unresolved') DESC, e.strength DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    relType: String(r.rel_type),
    status: String(r.status),
    strength: Number(r.strength ?? 0),
    lastMentioned: r.last_mentioned ? new Date(r.last_mentioned as string) : null,
    evidence: (r.evidence as string[] | null) ?? [],
    otherName: String(r.other_name),
  }));
}

/**
 * Open loops attached to any of the given entities (spec 02 §4 second half:
 * loops on entities mentioned this turn, not just dated ones). Excludes loops
 * already in `excludeIds`. Ordered by due date then recency.
 */
export async function getOpenLoopsForEntities(
  userId: string,
  entityIds: string[],
  limit = 10,
): Promise<Array<EntityOpenLoop & { entityId: string }>> {
  if (!entityIds.length) return [];
  const rows = await db.execute(sql`
    SELECT id, kind, title, due_at, source_memory, entity_id
    FROM open_loops
    WHERE user_id = ${userId}
      AND status = 'open'
      AND entity_id IN (${uuidInList(entityIds)})
    ORDER BY due_at ASC NULLS LAST, created_at DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    title: String(r.title),
    dueAt: r.due_at ? new Date(r.due_at as string) : null,
    sourceMemory: String(r.source_memory),
    entityId: String(r.entity_id),
  }));
}

// ---------------------------------------------------------------------------
// Held intentions (spec 03 P4) — commitment-loop proximity match.
// ---------------------------------------------------------------------------

export interface CommitmentLoopCandidate {
  id: string;
  title: string;
  sourceMemory: string;
  /** cosine distance from the turn embedding to the loop embedding (lower = closer). */
  distance: number;
}

/**
 * Open `commitment` loops closest (by embedding) to the current turn (spec 03
 * P4). This is the CHEAP prefilter for the held-intention contradiction check:
 * it finds commitments that are semantically *near* what the user is talking
 * about now. It is NOT a contradiction detector — proximity means "same topic",
 * which could be agreement, tension, or an unrelated match. A fast-tier confirm
 * decides genuine tension afterward (bias to silence).
 *
 * Commitments are self-scoped (usually no entity), so we deliberately do NOT
 * filter on `entity_id`. Only loops WITH an embedding are considered; results
 * beyond `maxDistance` are dropped. Ordered nearest-first.
 */
export async function findCommitmentLoopCandidates(
  userId: string,
  embedding: number[],
  maxDistance: number,
  limit = 5,
): Promise<CommitmentLoopCandidate[]> {
  if (!embedding.length) return [];
  const vec = toVectorLiteral(embedding);
  const rows = await db.execute(sql`
    SELECT id, title, source_memory, (embedding <=> ${vec}::vector) AS distance
    FROM open_loops
    WHERE user_id = ${userId}
      AND status = 'open'
      AND kind = 'commitment'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vec}::vector ASC
    LIMIT ${limit}
  `);
  return asRows(rows)
    .map((r) => ({
      id: String(r.id),
      title: String(r.title),
      sourceMemory: String(r.source_memory),
      distance: Number(r.distance),
    }))
    .filter((r) => Number.isFinite(r.distance) && r.distance <= maxDistance);
}

// ---------------------------------------------------------------------------
// Pattern surfacing (spec 02 §3.2.3 / §5.4, P5). Consolidation writes pattern
// insights as origin='consolidation' facts; the Ask agent surfaces AT MOST ONE
// per turn through the context pack, decided by relevance + prompting rather
// than a forced nudge (P5 design refinement). Suppression stays code+state: a
// dismissed pattern, or one surfaced (non-suppressed) in the recent window, is
// filtered out HERE so it can never re-enter context.
// ---------------------------------------------------------------------------

export interface SurfaceablePatternRow {
  id: string;
  factText: string;
  /** raw object_text — carries "supported_by: id1, id2, ..." (parsed in core). */
  objectText: string | null;
  confidence: number;
  /** cosine distance to the current turn (lower = more relevant). */
  distance: number;
}

/**
 * Candidate pattern insights for the current turn: current (valid_to IS NULL)
 * consolidation reflections at or above `minConfidence`, ranked by relevance to
 * the turn embedding, EXCLUDING any pattern the user dismissed (ever) or that
 * was already surfaced without suppression within `recentDays`. The ≥5-receipt
 * check is applied in core after parsing `object_text`. Returns a small ranked
 * pool; the caller takes the top relevant one.
 */
export async function getSurfaceablePatternInsights(params: {
  userId: string;
  turnEmbedding: number[];
  minConfidence: number;
  recentDays: number;
  limit?: number;
}): Promise<SurfaceablePatternRow[]> {
  const { userId, turnEmbedding, minConfidence, recentDays, limit = 5 } = params;
  const vec = toVectorLiteral(turnEmbedding);
  const rows = await db.execute(sql`
    SELECT f.id, f.fact_text, f.object_text, f.confidence,
           (f.embedding <=> ${vec}::vector) AS distance
    FROM facts f
    WHERE f.user_id = ${userId}
      AND f.origin = 'consolidation'
      AND f.fact_type = 'reflection'
      AND f.valid_to IS NULL
      AND f.embedding IS NOT NULL
      AND f.confidence >= ${minConfidence}
      AND NOT EXISTS (
        SELECT 1 FROM surfacings s
        WHERE s.user_id = ${userId}
          AND s.subject_type = 'pattern_fact'
          AND s.subject_id = f.id
          AND s.suppressed_reason IS NULL
          AND (
            s.reaction = 'dismissed'
            OR s.shown_at > NOW() - (${recentDays}::int * INTERVAL '1 day')
          )
      )
    ORDER BY distance ASC
    LIMIT ${limit}
  `);
  return asRows(rows)
    .map((r) => ({
      id: String(r.id),
      factText: String(r.fact_text),
      objectText: r.object_text == null ? null : String(r.object_text),
      confidence: Number(r.confidence),
      distance: Number(r.distance),
    }))
    .filter((r) => Number.isFinite(r.distance));
}

export interface GraphSnapshotEntity {
  id: string;
  type: string;
  canonicalName: string;
  mentionCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
}
export interface GraphSnapshotEdge {
  aName: string;
  bName: string;
  relType: string;
  status: string;
}
export interface GraphSnapshotLoop {
  kind: string;
  title: string;
  status: string;
  dueAt: string | null;
}
export interface GraphSnapshotMemory {
  id: string;
  occurredAt: string | null;
  text: string;
}
export interface GraphSnapshot {
  entities: GraphSnapshotEntity[];
  edges: GraphSnapshotEdge[];
  loops: GraphSnapshotLoop[];
  memories: GraphSnapshotMemory[];
}

/**
 * A whole-graph snapshot for the nightly pattern pass (spec 02 §3.2.3): the
 * user's entities, materialized edges, open loops, and dated memories over a
 * window. Personal-scale data fits one reasoning-model context, so the model —
 * not a graph algorithm (spec 01 D1) — does the connecting. `memoryWindowDays`
 * bounds how far back dated memories reach so "projects went quiet at week
 * three" style patterns have their timeline; entities/edges/loops are the full
 * current graph.
 */
export async function getGraphSnapshot(params: {
  userId: string;
  memoryWindowDays: number;
  maxMemories?: number;
}): Promise<GraphSnapshot> {
  const { userId, memoryWindowDays, maxMemories = 300 } = params;

  const [entRows, edgeRows, loopRows, memRows] = await Promise.all([
    db.execute(sql`
      SELECT id, type, canonical_name, mention_count, first_seen, last_seen
      FROM entities WHERE user_id = ${userId}
      ORDER BY mention_count DESC LIMIT 400
    `),
    db.execute(sql`
      SELECT ea.canonical_name AS a_name, eb.canonical_name AS b_name,
             e.rel_type, e.status
      FROM entity_edges e
      JOIN entities ea ON ea.id = e.a_id
      JOIN entities eb ON eb.id = e.b_id
      WHERE e.user_id = ${userId}
      ORDER BY e.strength DESC LIMIT 300
    `),
    db.execute(sql`
      SELECT kind, title, status, due_at
      FROM open_loops WHERE user_id = ${userId} AND status = 'open'
      ORDER BY created_at DESC LIMIT 200
    `),
    db.execute(sql`
      SELECT id, occurred_at, raw_text
      FROM memories
      WHERE user_id = ${userId}
        AND status = 'processed'
        AND COALESCE(occurred_at, created_at) > NOW() - (${memoryWindowDays}::int * INTERVAL '1 day')
      ORDER BY COALESCE(occurred_at, created_at) DESC
      LIMIT ${maxMemories}
    `),
  ]);

  return {
    entities: asRows(entRows).map((r) => ({
      id: String(r.id),
      type: String(r.type),
      canonicalName: String(r.canonical_name),
      mentionCount: Number(r.mention_count),
      firstSeen: r.first_seen ? new Date(r.first_seen as string).toISOString() : null,
      lastSeen: r.last_seen ? new Date(r.last_seen as string).toISOString() : null,
    })),
    edges: asRows(edgeRows).map((r) => ({
      aName: String(r.a_name),
      bName: String(r.b_name),
      relType: String(r.rel_type),
      status: String(r.status),
    })),
    loops: asRows(loopRows).map((r) => ({
      kind: String(r.kind),
      title: String(r.title),
      status: String(r.status),
      dueAt: r.due_at ? new Date(r.due_at as string).toISOString() : null,
    })),
    memories: asRows(memRows).map((r) => ({
      id: String(r.id),
      occurredAt: r.occurred_at ? new Date(r.occurred_at as string).toISOString() : null,
      text: String(r.raw_text).replace(/\s+/g, " ").slice(0, 300),
    })),
  };
}

// ---------------------------------------------------------------------------
// Follow-up threads & absence (spec 04). CODE decides what may NOT be raised
// (dismissed-forever, statistical floors, the raised-unengaged-never-again rule
// for absence); the model decides what IS raised from the dossiers assembled in
// @repo/core/retrieval/follow-ups. All suppression is enforced HERE in SQL so a
// blocked subject can never re-enter context. ALWAYS pass turn embeddings
// through toVectorLiteral(vec)::vector for pgvector distance.
// ---------------------------------------------------------------------------

/**
 * Auto-expire dated open loops whose check-in window has fully passed (spec 04
 * §3.1): `due_at` older than `graceDays` (default 14, extended from 7d to give
 * the "how did it go?" check-in a window) AND never engaged with — no
 * non-suppressed `engaged` surfacing for the loop. Resolution (a later memory
 * closing it) is unaffected; this only retires loops the user never engaged.
 * Returns the number expired. Idempotent — safe to run every night.
 */
export async function expireStaleOpenLoops(
  userId: string,
  now: Date,
  graceDays = 14,
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - graceDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = await db.execute(sql`
    UPDATE open_loops o
    SET status = 'expired'
    WHERE o.user_id = ${userId}
      AND o.status = 'open'
      AND o.due_at IS NOT NULL
      AND o.due_at < ${cutoff}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM surfacings s
        WHERE s.user_id = ${userId}
          AND s.subject_type = 'open_loop'
          AND s.subject_id = o.id
          AND s.suppressed_reason IS NULL
          AND s.reaction = 'engaged'
      )
    RETURNING o.id
  `);
  return asRows(rows).length;
}

export interface FollowUpLoopRow {
  id: string;
  kind: string;
  title: string;
  dueAt: Date | null;
  entityId: string | null;
  sourceMemory: string;
  createdAt: Date;
  lastSurfacedAt: Date | null;
  /** cosine distance from the turn embedding to the loop embedding; null when
   * no turn embedding was supplied or the loop has none (lower = more relevant). */
  distance: number | null;
}

/**
 * Open loops eligible as follow-up (check-in) candidates for THIS turn
 * (spec 04 §3.1/§3.3). Two ripeness gates, both computed here so the caller
 * only ranks:
 *  - DATED loops become candidates once `due_at` is past by `checkInGraceHours`
 *    (default 2h) — the date passing is what flips "heads-up" into "how did it
 *    go?". Still-future dated loops are P2's job, not ours, so they're excluded.
 *  - UNDATED loops (threads, commitments, goals, conflicts) enter the pool once
 *    they're at least `undatedMinAgeHours` old (default 24h).
 * All open-loop kinds are eligible (an unresolved conflict is exactly the kind
 * of thing a friend circles back to). Dismissed-ever subjects are excluded in
 * SQL (NOT EXISTS) — dismissal is forever (spec 01 D5). `recentlyRaised` ranking
 * is the caller's job; this query does NOT exclude recently-raised loops.
 */
export async function getFollowUpLoopCandidates(params: {
  userId: string;
  now: Date;
  turnEmbedding?: number[] | null;
  checkInGraceHours?: number;
  undatedMinAgeHours?: number;
  limit?: number;
}): Promise<FollowUpLoopRow[]> {
  const {
    userId,
    now,
    turnEmbedding,
    checkInGraceHours = 2,
    undatedMinAgeHours = 24,
    limit = 30,
  } = params;
  const checkInBefore = new Date(
    now.getTime() - checkInGraceHours * 60 * 60 * 1000,
  ).toISOString();
  const undatedBefore = new Date(
    now.getTime() - undatedMinAgeHours * 60 * 60 * 1000,
  ).toISOString();
  const distanceExpr =
    turnEmbedding && turnEmbedding.length
      ? sql`(o.embedding <=> ${toVectorLiteral(turnEmbedding)}::vector)`
      : sql`NULL`;

  const rows = await db.execute(sql`
    SELECT o.id, o.kind, o.title, o.due_at, o.entity_id, o.source_memory,
           o.created_at, o.last_surfaced_at,
           ${distanceExpr} AS distance
    FROM open_loops o
    WHERE o.user_id = ${userId}
      AND o.status = 'open'
      AND (
        (o.due_at IS NOT NULL AND o.due_at < ${checkInBefore}::timestamptz)
        OR (o.due_at IS NULL AND o.created_at < ${undatedBefore}::timestamptz)
      )
      AND NOT EXISTS (
        SELECT 1 FROM surfacings s
        WHERE s.user_id = ${userId}
          AND s.subject_type = 'open_loop'
          AND s.subject_id = o.id
          AND s.suppressed_reason IS NULL
          AND s.reaction = 'dismissed'
      )
    ORDER BY distance ASC NULLS LAST, o.due_at ASC NULLS LAST, o.created_at DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    kind: String(r.kind),
    title: String(r.title),
    dueAt: r.due_at ? new Date(r.due_at as string) : null,
    entityId: r.entity_id ? String(r.entity_id) : null,
    sourceMemory: String(r.source_memory),
    createdAt: new Date(r.created_at as string),
    lastSurfacedAt: r.last_surfaced_at
      ? new Date(r.last_surfaced_at as string)
      : null,
    distance: r.distance == null ? null : Number(r.distance),
  }));
}

export interface AbsenceCandidateRow {
  entityId: string;
  name: string;
  type: string;
  lifetimeMentions: number;
  lastMentionAt: Date | null;
  monthsSinceLast: number;
  dropRatio: number;
}

/** Statistical-significance floors for absence (spec 04 §3.6) — evidence
 * strength, not human judgment (the legitimate kind of code threshold). */
export const ABSENCE_MIN_LIFETIME_MENTIONS = 10;
export const ABSENCE_MIN_MONTHS_SILENT = 6;
export const ABSENCE_MIN_DROP_RATIO = 0.9;

/**
 * The absence numeric floors as ONE pure, unit-testable predicate (spec 04
 * §3.6): ALL must hold — ≥10 lifetime mentions, silent > 6 months, mention rate
 * dropped > 90%. Kept pure and in @repo/db so both `getAbsenceCandidates` (the
 * runtime path applies it in JS) and the boundary tests (10-vs-9, 6-vs-5mo,
 * 90-vs-89%) share ONE source of truth and can never drift. All comparisons are
 * strict `>` for the rate/time floors — a signal exactly at the floor does not
 * qualify (the conservative, silence-preferring direction).
 */
export function meetsAbsenceFloors(s: {
  lifetimeMentions: number;
  monthsSinceLast: number;
  dropRatio: number;
}): boolean {
  return (
    s.lifetimeMentions >= ABSENCE_MIN_LIFETIME_MENTIONS &&
    s.monthsSinceLast > ABSENCE_MIN_MONTHS_SILENT &&
    s.dropRatio > ABSENCE_MIN_DROP_RATIO
  );
}

/**
 * Per-entity absence candidates (spec 04 §3.6) — the last, weakest candidate
 * source, computed at read time entirely from derived data + the ledger (no new
 * source-of-truth; fully rebuildable, spec 01). Baselines come from
 * `memory_entities` joined to `memories` over a trailing window, plus user
 * conversation-turn mentions so an entity actively discussed in chat can never
 * look "absent" (that's the highest-cost wrong guess in the product). An entity
 * qualifies only when ALL floors hold:
 *   - ≥ ABSENCE_MIN_LIFETIME_MENTIONS lifetime mentions;
 *   - mention rate dropped > ABSENCE_MIN_DROP_RATIO (recent 6mo vs the prior 12mo);
 *   - silent for > ABSENCE_MIN_MONTHS_SILENT months.
 * Two hard suppressions, both in SQL: dismissed-ever (forever, spec 01 D5), and
 * the kind-specific "raised-and-not-engaged NEVER re-enters unless the user
 * mentions the entity again" rule (spec 04 §3.6) — enforced as: exclude when a
 * non-suppressed `absence_nudge` exists with no memory/turn mention after it.
 */
export async function getAbsenceCandidates(params: {
  userId: string;
  now: Date;
  limit?: number;
}): Promise<AbsenceCandidateRow[]> {
  const { userId, now, limit = 20 } = params;
  const nowIso = now.getTime();
  const sixMonthsAgo = new Date(nowIso - 182 * 24 * 60 * 60 * 1000).toISOString();
  const eighteenMonthsAgo = new Date(
    nowIso - 547 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const rows = await db.execute(sql`
    WITH mem AS (
      SELECT me.entity_id AS eid,
             COALESCE(m.occurred_at, m.created_at) AS ts
      FROM memory_entities me
      JOIN memories m ON m.id = me.memory_id
      WHERE m.user_id = ${userId}
    ),
    conv AS (
      SELECT e.id AS eid, ct.created_at AS ts
      FROM entities e
      JOIN conversation_turns ct
        ON ct.user_id = ${userId} AND ct.role = 'user'
       AND ct.content ILIKE '%' || e.canonical_name || '%'
      WHERE e.user_id = ${userId}
    ),
    allm AS (
      SELECT eid, ts FROM mem
      UNION ALL
      SELECT eid, ts FROM conv
    ),
    stats AS (
      SELECT e.id AS entity_id, e.canonical_name, e.type,
        (SELECT COUNT(*) FROM mem WHERE mem.eid = e.id) AS lifetime,
        (SELECT MAX(ts) FROM allm WHERE allm.eid = e.id) AS last_mention,
        (SELECT COUNT(*) FROM allm
           WHERE allm.eid = e.id AND allm.ts > ${sixMonthsAgo}::timestamptz) AS recent_count,
        (SELECT COUNT(*) FROM mem
           WHERE mem.eid = e.id
             AND mem.ts > ${eighteenMonthsAgo}::timestamptz
             AND mem.ts <= ${sixMonthsAgo}::timestamptz) AS baseline_count
      FROM entities e
      WHERE e.user_id = ${userId}
        AND e.type IN ('person', 'org', 'project')
    )
    SELECT entity_id, canonical_name, type, lifetime, last_mention,
      CASE
        WHEN recent_count = 0 THEN 1.0
        WHEN baseline_count = 0 THEN 0.0
        ELSE 1.0 - ((recent_count / 6.0) / (baseline_count / 12.0))
      END AS drop_ratio
    FROM stats s
    WHERE s.lifetime >= ${ABSENCE_MIN_LIFETIME_MENTIONS}
      AND s.last_mention IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM surfacings d
        WHERE d.user_id = ${userId}
          AND d.subject_type = 'entity'
          AND d.subject_id = s.entity_id
          AND d.suppressed_reason IS NULL
          AND d.reaction = 'dismissed'
      )
      AND NOT EXISTS (
        SELECT 1 FROM surfacings a
        WHERE a.user_id = ${userId}
          AND a.subject_type = 'entity'
          AND a.subject_id = s.entity_id
          AND a.kind = 'absence_nudge'
          AND a.suppressed_reason IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM allm
            WHERE allm.eid = s.entity_id AND allm.ts > a.shown_at
          )
      )
    ORDER BY s.last_mention ASC
    LIMIT ${limit}
  `);
  return asRows(rows)
    .map((r) => {
      const last = r.last_mention ? new Date(r.last_mention as string) : null;
      const monthsSinceLast = last
        ? (now.getTime() - last.getTime()) / (30 * 24 * 60 * 60 * 1000)
        : Number.POSITIVE_INFINITY;
      return {
        entityId: String(r.entity_id),
        name: String(r.canonical_name),
        type: String(r.type),
        lifetimeMentions: Number(r.lifetime),
        lastMentionAt: last,
        monthsSinceLast,
        dropRatio: Number(r.drop_ratio),
      };
    })
    // Numeric floors applied in JS via the shared pure predicate so the
    // 10-vs-9 / 6-vs-5mo / 90-vs-89% boundaries have ONE source of truth.
    .filter((r) => meetsAbsenceFloors(r));
}

export interface RaisingHistoryEntry {
  subjectId: string;
  shownAt: Date;
  channel: string;
  reaction: string | null;
}

/**
 * Every prior NON-suppressed surfacing of the given subjects (spec 04 §3.3
 * dossier `raisingHistory`): when, through which channel, and how the user
 * reacted. Suppressed rows never count (they were never shown). `rule_applied`
 * is excluded — it is not a proactive raise. Ordered newest-first per subject
 * so the model can see "I already asked on Tuesday".
 */
export async function getRaisingHistoryForSubjects(
  userId: string,
  subjectIds: string[],
): Promise<RaisingHistoryEntry[]> {
  if (!subjectIds.length) return [];
  const rows = await db.execute(sql`
    SELECT subject_id, shown_at, channel, reaction
    FROM surfacings
    WHERE user_id = ${userId}
      AND subject_id IN (${uuidInList(subjectIds)})
      AND suppressed_reason IS NULL
      AND kind <> 'rule_applied'
    ORDER BY shown_at DESC
  `);
  return asRows(rows).map((r) => ({
    subjectId: String(r.subject_id),
    shownAt: new Date(r.shown_at as string),
    channel: String(r.channel),
    reaction: r.reaction == null ? null : String(r.reaction),
  }));
}

export interface SinceThenMemory {
  id: string;
  occurredAt: Date | null;
  snippet: string;
}

/**
 * "What's happened since" for a follow-up dossier (spec 04 §3.3 `sinceThen`):
 * later memories touching the same entity, captured AFTER `since`. Excludes the
 * loop's own source memory. Newest-first, capped (default 6). Used to let the
 * model see an already-told outcome and acknowledge rather than ask.
 */
export async function getSinceThenForEntity(params: {
  userId: string;
  entityId: string;
  since: Date;
  excludeMemoryId?: string | null;
  limit?: number;
}): Promise<SinceThenMemory[]> {
  const { userId, entityId, since, excludeMemoryId = null, limit = 6 } = params;
  const rows = await db.execute(sql`
    SELECT m.id, COALESCE(m.occurred_at, m.created_at) AS ts, m.raw_text
    FROM memory_entities me
    JOIN memories m ON m.id = me.memory_id
    WHERE me.entity_id = ${entityId}::uuid
      AND m.user_id = ${userId}
      AND COALESCE(m.occurred_at, m.created_at) > ${since.toISOString()}::timestamptz
      ${excludeMemoryId ? sql`AND m.id <> ${excludeMemoryId}::uuid` : sql``}
    ORDER BY ts DESC
    LIMIT ${limit}
  `);
  return asRows(rows).map((r) => ({
    id: String(r.id),
    occurredAt: r.ts ? new Date(r.ts as string) : null,
    snippet: String(r.raw_text).replace(/\s+/g, " ").slice(0, 200),
  }));
}
