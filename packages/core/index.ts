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
} from "./queues";
export type { IngestionJobData } from "./queues";

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
