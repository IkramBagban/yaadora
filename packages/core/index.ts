// @repo/core — shared AI + queue layer for apps/server + apps/worker.
// Provider SDKs are imported ONLY inside ./ai/models.ts.
export {
  ingestionModel,
  reasoningModel,
  embeddingModel,
  AI_PROVIDER,
} from "./ai/models";

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
} from "./retrieval";
