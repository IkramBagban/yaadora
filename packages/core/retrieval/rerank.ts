import { generateObject } from "ai";
import { z } from "zod";
import type {
  FusedCandidate,
  RetrievedFact,
  RetrievedMemory,
} from "@repo/db";
import { reasoningModel } from "../ai/models";

/**
 * Rerank & assemble (spec 02 §3.3).
 *
 * A precision pass over the high-recall hybrid pool: an LLM scores each
 * candidate's relevance to the question; we take the top 10–15. Salience
 * (spec 02 §5.4) is applied as a TIE-BREAKER prior — never a filter.
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
 * LLM rerank. Scores each candidate's relevance to the question, then returns
 * the top `topK` fused with salience as a tie-breaker prior.
 *
 * TODO(perf): swap the LLM rerank for a cross-encoder (e.g. bge-reranker) if
 * latency/cost demands (spec 02 §3.3). The interface stays the same.
 */
export async function rerankCandidates(params: {
  question: string;
  candidates: Candidate[];
  topK?: number;
  /** cap how many candidates are shown to the reranker (token control) */
  maxToScore?: number;
}): Promise<RerankedCandidate[]> {
  const { question, topK = 12, maxToScore = 60 } = params;
  if (!params.candidates.length) return [];

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

  const { object } = await generateObject({
    model: reasoningModel,
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
