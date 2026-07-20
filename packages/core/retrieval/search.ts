import {
  hybridSearch,
  getMemoriesByIds,
  getEntityProfiles,
  type RetrievedMemory,
} from "@repo/db";
import { understandQuery, type UnderstoodQuery } from "./understanding";
import { buildCandidates, rerankCandidates, isRerankEnabled } from "./rerank";
import { assembleContext, type Citation } from "./answer";
import { createLogger } from "@repo/logger";

const log = createLogger("retrieval");

/**
 * The callable retrieval unit, extracted so the Ask agent
 * loop can invoke it as its `search_memories` tool. It reuses the SAME
 * query-understanding → hybrid-search → rerank → assemble machinery the old
 * single-pass Ask used — no SQL is duplicated here.
 *
 * One invocation = one retrieval angle: understand the query, fan out across the
 * hybrid channels, rerank to a precise top-k, and hand back compact hits plus
 * the assembled context + per-memory citations for grounding.
 */

/** One reranked result, compact enough to hand back to the reasoning model. */
export interface SearchHit {
  memoryId: string;
  /** short source-memory (or fact) snippet, for the model + the citation */
  snippet: string;
  occurredAt: string | null;
  /** LLM rerank relevance in [0,1] */
  score: number;
  kind: "fact" | "memory";
}

export interface SearchOutcome {
  /** compact hits (relevance-ordered) returned to the model as the tool result */
  hits: SearchHit[];
  /** best rerank relevance across the pool — the retrieval-quality signal */
  topRelevance: number;
  /** deduped per-memory citations (relevance order) for the final answer */
  citations: Citation[];
  /** the assembled context block (facts + memory snippets + entity profiles) */
  contextText: string;
  understanding: UnderstoodQuery;
}

const SNIPPET_MAX = 200;
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET_MAX ? `${clean.slice(0, SNIPPET_MAX)}…` : clean;
}


/** Trim + case-insensitively dedupe a list of query strings, preserving order. */
function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const trimmed = q.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Run one retrieval pass for `query` (optionally time-scoped by `timeframe`).
 * Returns compact hits for the model plus citations/context for grounding.
 */
export async function retrieveMemories(params: {
  userId: string;
  query: string;
  /** natural-language timeframe the model inferred ("last month", "in March") */
  timeframe?: string | null;
  now: Date;
  timezone: string;
}): Promise<SearchOutcome> {
  const { userId, query, timeframe, now, timezone } = params;

  // §3.1 Query understanding: classify + resolve entities + hard time filter +
  // multi-query expansion + embeddings. Fold the timeframe into the question so
  // temporal resolution has it as context.
  const question = timeframe ? `${query} (timeframe: ${timeframe})` : query;
  const understanding = await understandQuery({
    userId,
    question,
    now,
    timezone,
  });

  // §3.2 Hybrid candidate retrieval (hard time predicates inside; entities seed
  // the graph channel). Always include the user's RAW query in the lexical set —
  // the LLM rewrites can drop rare literal tokens (a project name like
  // "querywise"), and the lexical channel is exactly what recalls those.
  const lexicalQueries = dedupeQueries([query, ...understanding.searchQueries]);
  const pool = await hybridSearch({
    userId,
    embeddings: understanding.queryEmbeddings,
    queries: lexicalQueries,
    entityIds: understanding.entityIds,
    timeRange: understanding.timeRange,
    currentOnly: !understanding.historical,
  });

  const candidates = buildCandidates(pool);

  log.debug("Candidates Built", {
    query,
    timeframe: timeframe ?? null,
    queryType: understanding.queryType,
    historical: understanding.historical,
    entityIds: understanding.entityIds,
    searchQueries: understanding.searchQueries,
    lexicalQueries,
    timeRange: understanding.timeRange
      ? {
          from: understanding.timeRange.from.toISOString(),
          to: understanding.timeRange.to.toISOString(),
        }
      : null,
    poolMemories: pool.memories.length,
    poolFacts: pool.facts.length,
    candidates: candidates.length,
  });

  if (!candidates.length) {
    return {
      hits: [],
      topRelevance: 0,
      citations: [],
      contextText: "",
      understanding,
    };
  }

  // §3.3 Rerank to a precise top-k.
  const reranked = await rerankCandidates({ question: query, candidates });
  const topRelevance = reranked[0]?.relevance ?? 0;

  log.debug("Candidates Reranked", {
    query,
    stage: "reranked",
    // Off by default (RERANK_ENABLED). When false, `topRelevance` is the fused
    // retrieval score, not a calibrated relevance judgment.
    rerankEnabled: isRerankEnabled(),
    reranked: reranked.length,
    topRelevance,
    topSnippets: reranked.slice(0, 3).map((c) => ({
      kind: c.kind,
      relevance: c.relevance,
      text: snippet(c.text),
    })),
  });

  if (!reranked.length) {
    return {
      hits: [],
      topRelevance: 0,
      citations: [],
      contextText: "",
      understanding,
    };
  }

  // Assemble context + citations from the source memories + entity profiles.
  const memoryIds = Array.from(new Set(reranked.map((c) => c.memoryId)));
  const [memories, entityProfiles] = await Promise.all([
    getMemoriesByIds(userId, memoryIds),
    getEntityProfiles(userId, understanding.entityIds),
  ]);
  const memoriesById = new Map<string, RetrievedMemory>(
    memories.map((m) => [m.id, m]),
  );

  const { contextText, citations } = assembleContext({
    reranked,
    memoriesById,
    entityProfiles,
  });

  const hits: SearchHit[] = reranked.map((c) => {
    const mem = memoriesById.get(c.memoryId);
    const text = c.kind === "memory" ? mem?.rawText ?? c.text : c.text;
    return {
      memoryId: c.memoryId,
      snippet: snippet(text),
      occurredAt:
        (mem?.occurredAt ?? mem?.createdAt ?? null)?.toISOString() ??
        c.timestamp,
      score: c.relevance,
      kind: c.kind,
    };
  });

  return { hits, topRelevance, citations, contextText, understanding };
}
