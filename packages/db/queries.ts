import { sql } from "drizzle-orm";
import { db } from "./client";
import type { Memory, Fact } from "./schema";

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
 * Typed raw-SQL retrieval helpers (spec 02 §3.2).
 *
 * Hybrid retrieval lives HERE, in @repo/db — raw SQL never leaks into apps/*.
 * These are well-typed SKELETONS. The actual hybrid ranking / fusion logic is
 * implemented later alongside the retrieval engine in @repo/core. Do not
 * over-build now.
 */

export interface VectorSearchParams {
  userId: string;
  /** query embedding, 1536-d (must match the DB column dimension) */
  embedding: number[];
  /** absolute time window; hard SQL predicate, not a similarity hope */
  timeRange?: { from: Date; to: Date } | null;
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
  timeRange?: { from: Date; to: Date } | null;
  limit?: number;
}

export interface Scored<T> {
  row: T;
  score: number;
}

/**
 * Vector channel — pgvector cosine over memories.embedding.
 * TODO(retrieval): implement cosine ORDER BY with hard time/entity WHERE
 * predicates; union with the facts.embedding channel; apply currentOnly.
 */
export async function vectorSearchMemories(
  _params: VectorSearchParams,
): Promise<Scored<Memory>[]> {
  // TODO(retrieval): real implementation. Placeholder keeps the connection warm
  // and the types honest.
  await db.execute(sql`select 1`);
  return [];
}

/**
 * Vector channel — pgvector cosine over facts.embedding.
 * TODO(retrieval): mirror vectorSearchMemories over the facts table.
 */
export async function vectorSearchFacts(
  _params: VectorSearchParams,
): Promise<Scored<Fact>[]> {
  return [];
}

/**
 * Lexical channel — ts_rank over memories.fts (the generated tsvector column).
 * TODO(retrieval): websearch_to_tsquery + ts_rank_cd, scoped by user + time.
 */
export async function lexicalSearchMemories(
  _params: LexicalSearchParams,
): Promise<Scored<Memory>[]> {
  return [];
}

/**
 * Hybrid retrieval entry point (spec 02 §3.2) — parallel channels, union,
 * hard filters, then rerank downstream in @repo/core.
 * TODO(retrieval): fan out to vector + lexical + graph + temporal channels and
 * return a de-duplicated candidate pool (~50–100) for reranking.
 */
export async function hybridSearch(
  params: VectorSearchParams & { query: string },
): Promise<{ memories: Scored<Memory>[]; facts: Scored<Fact>[] }> {
  const [memories, facts] = await Promise.all([
    vectorSearchMemories(params),
    vectorSearchFacts(params),
  ]);
  return { memories, facts };
}
