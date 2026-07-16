/**
 * The recall / reason engine (spec 02 §3–§4), run synchronously in apps/server
 * for Ask.
 *
 * Ask is a conversational tool-use loop (./agent.ts): the reasoning model
 * rewrites follow-ups from the in-session history, searches its memories from
 * multiple angles via `retrieveMemories` (./search.ts — the callable unit that
 * reuses the query-understanding → hybrid-search → rerank machinery), and then
 * either answers grounded ONLY in what it retrieved, or asks the user back when
 * the question is ambiguous. Groundedness: citations come only from retrieved
 * results; a low-signal turn yields the honest refusal, never a fabrication.
 */

export { understandQuery, QueryUnderstandingSchema } from "./understanding";
export type { UnderstoodQuery, QueryUnderstanding } from "./understanding";
export { rerankCandidates, buildCandidates } from "./rerank";
export type { Candidate, RerankedCandidate } from "./rerank";
export { assembleContext, streamGroundedAnswer, REFUSAL_TEXT } from "./answer";
export type { Citation, AssembledContext } from "./answer";
export { retrieveMemories } from "./search";
export type { SearchHit, SearchOutcome } from "./search";

export { answerQuestion } from "./agent";
export type {
  AskHandle,
  AskResult,
  AskMode,
  AskStep,
  AskHistoryTurn,
} from "./agent";

// The context pack (spec 02 §4) — always-present working memory, assembled fresh
// per Ask turn from precomputed digests + near-dated loops.
export {
  assembleContextPack,
  buildContextPackText,
  estimateTokens,
  CONTEXT_PACK_TOKEN_BUDGET,
} from "./context-pack";
export type {
  ContextPack,
  ContextPackSlots,
  AssembleContextPackParams,
  LoopLine,
  RuleSlot,
  NudgeDirective,
} from "./context-pack";
