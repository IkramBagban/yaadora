// @repo/core — shared AI + queue layer for apps/server + apps/worker.
// Provider SDKs are imported ONLY inside ./ai/models.ts.
export {
  ingestionModel,
  reasoningModel,
  embeddingModel,
  AI_PROVIDER,
} from "./ai/models";
// fastModel stays internal to core (awareness / matcher / push copy).

// The BullMQ queue contract (spec 01 §2) — enqueue on the server, process on
// the worker. Shared here so producer/consumer can't drift.
export {
  INGESTION_QUEUE_NAME,
  INGESTION_JOB_OPTS,
  createRedisConnection,
  getIngestionQueue,
  enqueueIngestion,
  REPROCESS_QUEUE_NAME,
  REPROCESS_JOB_OPTS,
  getReprocessQueue,
  enqueueReprocess,
  CONSOLIDATION_QUEUE_NAME,
  CONSOLIDATION_CRON,
  getConsolidationQueue,
  scheduleNightlyConsolidation,
} from "./queues";
export type { IngestionJobData, ReprocessJobData, ConsolidationJobData } from "./queues";

// Nightly consolidation (spec 02 §5) — run by apps/worker on the schedule above.
export { runConsolidation } from "./consolidation";
export type {
  ConsolidationOptions,
  ConsolidationReport,
} from "./consolidation";

// The ingestion pipeline (spec 02 §2). `runIngestion` is the worker entrypoint.
export {
  runIngestion,
  markMemoryFailed,
  runReprocessJob,
  extract,
  ExtractionSchema,
  linkEntities,
  captureFromConversation,
  CaptureGateSchema,
} from "./ingestion";
export type {
  Extraction,
  ExtractionContext,
  ReprocessJobData as IngestionReprocessJobData,
  MentionInput,
  EntityResolution,
  CaptureGate,
  CaptureResult,
} from "./ingestion";

// The recall / retrieval engine (spec 02 §3). `answerQuestion` is the server's
// Ask entrypoint — hybrid retrieval → rerank → grounded, cited, streamed answer.
export {
  answerQuestion,
  understandQuery,
  QueryUnderstandingSchema,
  rerankCandidates,
  buildCandidates,
  assembleContext,
  streamGroundedAnswer,
  retrieveMemories,
  REFUSAL_TEXT,
  assembleContextPack,
  buildContextPackText,
  estimateTokens,
  CONTEXT_PACK_TOKEN_BUDGET,
  matchStandingRules,
  filterRuleCandidates,
  shortRuleName,
  buildTurnEmbedText,
  RULE_SIMILARITY_THRESHOLD,
  RULE_MATCH_CAP,
  editRuleAsCorrection,
  planRuleCorrection,
  linkTurnEntities,
  TURN_ENTITY_CAP,
  assembleEntityContext,
  renderEntityContext,
  ENTITY_FACT_CAP,
  ENTITY_EDGE_CAP,
} from "./retrieval";
export type {
  AskHandle,
  AskResult,
  AskMode,
  AskStep,
  AskHistoryTurn,
  UnderstoodQuery,
  QueryUnderstanding,
  Candidate,
  RerankedCandidate,
  Citation,
  AssembledContext,
  SearchHit,
  SearchOutcome,
  ContextPack,
  ContextPackSlots,
  AssembleContextPackParams,
  LoopLine,
  RuleSlot,
  NudgeDirective,
  MatchedRule,
  RuleCandidate,
  RuleEditInput,
  RuleEditResult,
  EntityContextSlot,
  LinkedEntity,
  LinkTurnEntitiesParams,
  EntityContext,
  EntityContextLoop,
  EntityContextFact,
  EntityContextEdge,
} from "./retrieval";

// Proactive brain (spec 02 §5.4, §3.3, §6) — gates + awareness + push helpers.
export {
  runGates,
  gateLedger,
  gateAlreadyKnown,
  gateSeam,
  gateEvidence,
  gateBudget,
  isInQuietHours,
  localDateString,
  localDaysUntil,
  localMinutesOfDay,
  isPrepTypeTitle,
  hardBlockMidTask,
  P2_ENABLED_KINDS,
  IGNORED_COOLDOWN_DAYS,
  runAwarenessPass,
  AWARENESS_DEADLINE_MS,
  loadAwarenessCandidates,
  evaluateAndRecord,
  scanProspectionCandidates,
  userHadConversationToday,
  loadUserBudgetSettings,
  retargetSurfacingChannel,
  buildAlreadyKnownPatterns,
  generatePushCopy,
  sendExpoPush,
} from "./proactive";
export type {
  NudgeCandidate,
  GateInput,
  GateOutcome,
  Seam,
  Channel,
  AwarenessPassResult,
  AwarenessAttachment,
} from "./proactive";
