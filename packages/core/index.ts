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
  CONSOLIDATION_QUEUE_NAME,
  CONSOLIDATION_CRON,
  getConsolidationQueue,
  scheduleNightlyConsolidation,
} from "./queues";
export type { IngestionJobData, ConsolidationJobData } from "./queues";

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
  extract,
  ExtractionSchema,
  linkEntities,
} from "./ingestion";
export type {
  Extraction,
  ExtractionContext,
  MentionInput,
  EntityResolution,
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
  REFUSAL_TEXT,
} from "./retrieval";
export type {
  AskResult,
  UnderstoodQuery,
  QueryUnderstanding,
  Candidate,
  RerankedCandidate,
  Citation,
  AssembledContext,
} from "./retrieval";
