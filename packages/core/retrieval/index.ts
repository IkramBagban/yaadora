import {
  db,
  users,
  eq,
  hybridSearch,
  getMemoriesByIds,
  getEntityProfiles,
  type RetrievedMemory,
} from "@repo/db";
import { understandQuery, type UnderstoodQuery } from "./understanding";
import { buildCandidates, rerankCandidates } from "./rerank";
import {
  assembleContext,
  streamGroundedAnswer,
  REFUSAL_TEXT,
  type Citation,
} from "./answer";

/**
 * The recall / retrieval engine (spec 02 §3), run synchronously in apps/server
 * for Ask: high recall (§3.2) → hard filters → rerank (§3.3) → grounded answer
 * (§3.4). High-recall pool from @repo/db raw SQL; precision + grounding here.
 */

export { understandQuery, QueryUnderstandingSchema } from "./understanding";
export type { UnderstoodQuery, QueryUnderstanding } from "./understanding";
export { rerankCandidates, buildCandidates } from "./rerank";
export type { Candidate, RerankedCandidate } from "./rerank";
export { assembleContext, streamGroundedAnswer, REFUSAL_TEXT } from "./answer";
export type { Citation, AssembledContext } from "./answer";

/**
 * Groundedness threshold (spec 02 §3.4): if the best reranked candidate scores
 * below this, we have nothing to stand on → refuse BEFORE generation rather than
 * risk a fabricated memory.
 */
const GROUNDEDNESS_MIN = 0.35;

export type AskResult =
  | {
      grounded: false;
      mode: "recall";
      /** the honest refusal text (streamed verbatim by the server) */
      text: string;
      citations: Citation[];
      confidence: number;
      understanding: UnderstoodQuery;
    }
  | {
      grounded: true;
      mode: "recall";
      /** token stream of the grounded answer */
      textStream: AsyncIterable<string>;
      citations: Citation[];
      confidence: number;
      understanding: UnderstoodQuery;
    };

/**
 * Answer a question end-to-end (spec 02 §3). Returns either a grounded token
 * stream + citations, or an honest refusal — the refusal branch is taken BEFORE
 * any generation when retrieval confidence is low (the groundedness guard).
 *
 * Decision-mode note: when `understanding.queryType === "decision"` we currently
 * route to normal single-pass recall.
 * TODO(§4 decision agent loop): branch here into the bounded multi-hop reasoning
 * loop (decompose → per-dimension retrieval → weigh evidence → outcome loop) and
 * return `mode: "reason"`. Out of scope for this wave.
 */
export async function answerQuestion(params: {
  userId: string;
  question: string;
  now?: Date;
  timezone?: string;
}): Promise<AskResult> {
  const { userId, question } = params;
  const now = params.now ?? new Date();

  // Resolve the user's timezone (drives temporal filter resolution) unless given.
  let timezone = params.timezone;
  if (!timezone) {
    const [user] = await db
      .select({ timezone: users.timezone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    timezone = user?.timezone ?? "UTC";
  }

  // §3.1 Query understanding: classify + hard filters + entity resolution.
  const understanding = await understandQuery({
    userId,
    question,
    now,
    timezone,
  });

  // §3.2 Hybrid candidate retrieval. Historical queries keep superseded facts.
  const pool = await hybridSearch({
    userId,
    embeddings: understanding.queryEmbeddings,
    queries: understanding.searchQueries,
    entityIds: understanding.entityIds,
    timeRange: understanding.timeRange,
    currentOnly: !understanding.historical,
  });

  const candidates = buildCandidates(pool);

  // GROUNDEDNESS GUARD (part 1): nothing retrieved → refuse before generation.
  if (!candidates.length) {
    return {
      grounded: false,
      mode: "recall",
      text: REFUSAL_TEXT,
      citations: [],
      confidence: 0,
      understanding,
    };
  }

  // §3.3 Rerank to the top 10–15 (salience is a tie-breaker prior, not a filter).
  const reranked = await rerankCandidates({ question, candidates });
  const topRelevance = reranked[0]?.relevance ?? 0;

  // GROUNDEDNESS GUARD (part 2): low confidence → refuse before generation.
  if (!reranked.length || topRelevance < GROUNDEDNESS_MIN) {
    return {
      grounded: false,
      mode: "recall",
      text: REFUSAL_TEXT,
      citations: [],
      confidence: topRelevance,
      understanding,
    };
  }

  // §3.3 Assemble: fetch source-memory snippets + entity profiles for context.
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

  // §3.4 Grounded, streamed answer with inline citations.
  const stream = streamGroundedAnswer({ question, context: contextText });

  return {
    grounded: true,
    mode: "recall",
    textStream: stream.textStream,
    citations,
    confidence: topRelevance,
    understanding,
  };
}
