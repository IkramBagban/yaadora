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
  EntityContextSlot,
  ObservationSlot,
} from "./context-pack";

// Pattern surfacing (spec 03 P5) — at most one relevant, high-support,
// non-dismissed pattern offered as context; the agent decides whether to raise
// it. Suppression stays code+state inside `selectObservation`.
export {
  selectObservation,
  pickBestObservation,
  parsePatternReceipts,
  PATTERN_MIN_RECEIPTS,
  PATTERN_MIN_CONFIDENCE,
  PATTERN_MAX_DISTANCE,
  PATTERN_RECENT_DAYS,
} from "./observations";

// Graph doorway (spec 02 §5.2) — turn-time entity linker + context assembler.
export { linkTurnEntities, TURN_ENTITY_CAP } from "./entity-linker";
export type { LinkedEntity, LinkTurnEntitiesParams } from "./entity-linker";
export {
  assembleEntityContext,
  renderEntityContext,
  ENTITY_FACT_CAP,
  ENTITY_EDGE_CAP,
} from "./entity-context";
export type {
  EntityContext,
  EntityContextLoop,
  EntityContextFact,
  EntityContextEdge,
} from "./entity-context";

// Rules doorway (spec 02 §5.1) — task-matched standing rules.
export {
  matchStandingRules,
  filterRuleCandidates,
  shortRuleName,
  buildTurnEmbedText,
  RULE_SIMILARITY_THRESHOLD,
  RULE_MATCH_CAP,
} from "./rule-matcher";
export type { MatchedRule, RuleCandidate } from "./rule-matcher";
export { editRuleAsCorrection, planRuleCorrection } from "./rule-edit";
export type { RuleEditInput, RuleEditResult } from "./rule-edit";
