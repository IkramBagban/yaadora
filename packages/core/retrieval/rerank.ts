import { generateObject } from "ai";
import { z } from "zod";
import type {
  FusedCandidate,
  RetrievedFact,
  RetrievedMemory,
} from "@repo/db";
import { fastModel } from "../ai/models";
import { createLogger } from "@repo/logger";

const log = createLogger("retrieval:rerank");

/**
 * Rerank & assemble (spec 02 §3.3).
 *
 * A precision pass over the high-recall hybrid pool: an LLM scores each
 * candidate's relevance to the question; we take the top 10–15. Salience
 * (spec 02 §5.4) is applied as a TIE-BREAKER prior — never a filter.
 *
 * DEFAULT: OFF. The LLM rerank is a second `fastModel` round-trip on the path of
 * EVERY search_memories call, and the agent may search up to MAX_STEPS times per
 * turn — so it multiplies. Set RERANK_ENABLED=true to turn it back on.
 *
 * When disabled we fall back to the fused retrieval score (see `fuse()` in
 * @repo/db), with salience as tie-breaker. Be aware what that costs: each
 * channel is normalised to [0,1] independently, so the top hit of a channel that
 * found nothing useful still scores ~1.0. The fused order is a RECALL merge, not
 * a relevance judgment. Turning rerank off trades precision for latency.
 *
 * `relevance` is still populated when disabled (from the fused score) so
 * `topRelevance` → `confidence` keeps a value — but it is NOT calibrated the way
 * the LLM's 0–1 judgment is. Don't build a refusal threshold on it without
 * re-enabling rerank or replacing it with a cross-encoder.
 *
 * TODO(perf): a cross-encoder (e.g. bge-reranker) would give the precision back
 * without the LLM round-trip. The interface here stays the same.
 */

/** A pool item unified across facts + memories for reranking. */
export interface Candidate {
  kind: "fact" | "memory";
  id: string;
  /** the text shown to the reranker + assembled into context */
  text: string;
  /** ISO timestamp used for temporal grounding + display */
  timestamp: string | null;
  /** source memory id (fact → its provenance; memory → itself) */
  memoryId: string;
  /** fused retrieval score from hybridSearch */
  retrievalScore: number;
  /** salience tie-breaker prior in [0, ~1] */
  salience: number;
  fact?: RetrievedFact;
  memory?: RetrievedMemory;
}

export interface RerankedCandidate extends Candidate {
  /** LLM relevance in [0,1] */
  relevance: number;
}

const fmtTs = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Build a unified candidate list from the fused hybrid pool. */
export function buildCandidates(pool: {
  facts: FusedCandidate<RetrievedFact>[];
  memories: FusedCandidate<RetrievedMemory>[];
}): Candidate[] {
  const factCands: Candidate[] = pool.facts.map((f) => ({
    kind: "fact",
    id: f.row.id,
    text: f.row.factText,
    timestamp: fmtTs(f.row.validFrom ?? f.row.createdAt),
    memoryId: f.row.sourceMemory,
    retrievalScore: f.score,
    salience: f.row.salience,
    fact: f.row,
  }));
  const memCands: Candidate[] = pool.memories.map((m) => ({
    kind: "memory",
    id: m.row.id,
    text: m.row.rawText,
    timestamp: fmtTs(m.row.occurredAt ?? m.row.createdAt),
    memoryId: m.row.id,
    retrievalScore: m.score,
    salience: m.row.salience,
    memory: m.row,
  }));
  return [...factCands, ...memCands];
}

const RerankSchema = z.object({
  rankings: z.array(
    z.object({
      ref: z.number().int(), // the [n] index shown in the prompt
      relevance: z.number().min(0).max(1),
    }),
  ),
});

/**
 * Is the LLM rerank pass on? Off unless RERANK_ENABLED is explicitly truthy.
 *
 * Read per call rather than cached at module load so tests and the eval harness
 * can flip it between runs (an A/B ablation is the only honest way to decide
 * whether the precision is worth the latency).
 */
export function isRerankEnabled(): boolean {
  const raw = process.env.RERANK_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Order by fused retrieval score, then salience, then take topK. */
function orderWithoutRerank(
  candidates: Candidate[],
  topK: number,
): RerankedCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      if (b.retrievalScore !== a.retrievalScore) {
        return b.retrievalScore - a.retrievalScore;
      }
      return b.salience - a.salience;
    })
    .slice(0, topK)
    .map((c) => ({ ...c, relevance: c.retrievalScore }));
}

/**
 * Rerank to a precise top-k.
 *
 * With RERANK_ENABLED on: an LLM scores each candidate's relevance to the
 * question, fused with salience as a tie-breaker prior.
 * Off (the default): falls back to the retrieval-score ordering above, with no
 * model call at all.
 *
 * Never throws on a model failure — a reranker that 500s must degrade to the
 * retrieval order, not take the whole answer down with it.
 */
export async function rerankCandidates(params: {
  question: string;
  candidates: Candidate[];
  topK?: number;
  /** cap how many candidates are shown to the reranker (token control) */
  maxToScore?: number;
  /** force on/off, bypassing the env var (used by evals + tests) */
  enabled?: boolean;
}): Promise<RerankedCandidate[]> {
  const { question, topK = 12, maxToScore = 60 } = params;
  if (!params.candidates.length) return [];

  const enabled = params.enabled ?? isRerankEnabled();
  if (!enabled) return orderWithoutRerank(params.candidates, topK);

  // Nothing to reorder: the pool already fits in topK, so an LLM call could
  // only change the ordering of items we're keeping regardless. Not worth a
  // round-trip.
  if (params.candidates.length <= topK) {
    return orderWithoutRerank(params.candidates, topK);
  }

  // Pre-trim by retrieval score so the reranker sees the strongest pool.
  const pool = [...params.candidates]
    .sort((a, b) => b.retrievalScore - a.retrievalScore)
    .slice(0, maxToScore);

  const listing = pool
    .map((c, i) => {
      const ts = c.timestamp ? ` (${c.timestamp})` : "";
      return `[${i}] (${c.kind})${ts} ${c.text}`;
    })
    .join("\n");

  let object: z.infer<typeof RerankSchema>;
  try {
    const result = await generateObject({
      model: fastModel,
      schema: RerankSchema,
      system:
        "You are the reranking stage of a personal memory system. Score how " +
        "relevant each candidate is to answering the question, from 0 (irrelevant) " +
        "to 1 (directly answers it). Judge only relevance to THIS question.",
      prompt: `Question:
"""
${question}
"""

Candidates:
${listing}

Return a relevance score for every candidate index.`,
    });
    object = result.object;
  } catch (err) {
    // A rate-limited or malformed rerank must not fail the whole answer — fall
    // back to retrieval order, which is exactly the disabled-path behaviour.
    log.warn("rerank failed; falling back to retrieval order", {
      message: err instanceof Error ? err.message : String(err),
      candidates: pool.length,
    });
    return orderWithoutRerank(params.candidates, topK);
  }

  const scoreByRef = new Map<number, number>();
  for (const r of object.rankings) scoreByRef.set(r.ref, r.relevance);

  const ranked: RerankedCandidate[] = pool.map((c, i) => ({
    ...c,
    relevance: scoreByRef.get(i) ?? 0,
  }));

  // Sort by relevance, breaking ties with the salience prior (§5.4), then the
  // retrieval score. Salience NEVER filters — only orders equals.
  ranked.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    if (b.salience !== a.salience) return b.salience - a.salience;
    return b.retrievalScore - a.retrievalScore;
  });

  return ranked.slice(0, topK);
}
