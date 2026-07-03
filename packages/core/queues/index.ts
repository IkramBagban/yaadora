import { Queue, type JobsOptions, type ConnectionOptions } from "bullmq";

/**
 * The BullMQ queue contract — the ONE place the ingestion job shape lives.
 *
 * Both `apps/server` (enqueue) and `apps/worker` (process) import from here so
 * the producer/consumer contract can never drift (spec 01 §2, CONTEXT.md §2).
 *
 * Redis exception (CONTEXT.md §2): BullMQ depends on `ioredis`. This is the one
 * accepted place ioredis is used directly — there is no Bun-native BullMQ.
 */

/** The ingestion queue name. One job per captured memory. */
export const INGESTION_QUEUE_NAME = "ingestion";

/** Typed payload for an ingestion job. Keep it minimal — the worker loads the
 * memory row itself so the queue never carries stale/large data. */
export interface IngestionJobData {
  memoryId: string;
}

/**
 * Build the BullMQ connection options from REDIS_URL.
 *
 * We return a plain options object (not a constructed ioredis client) so BullMQ
 * manages its own bundled `ioredis` internally — the one accepted ioredis usage
 * (CONTEXT.md §2). `maxRetriesPerRequest: null` is REQUIRED by BullMQ for
 * blocking worker commands and harmless for producers. Bun auto-loads `.env`.
 */
export function createRedisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL is not set. Bun auto-loads .env — set REDIS_URL (e.g. redis://localhost:6379).",
    );
  }
  return { url, maxRetriesPerRequest: null };
}

/**
 * Default job options: retry with exponential backoff. On final failure the
 * worker marks the memory `status = 'failed'` — raw text is never lost (spec 02 §2.6).
 */
export const INGESTION_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: true,
  removeOnFail: false,
};

// Lazily-created singleton producer queue (server side). The worker constructs
// its own Worker with its own connection and does not use this.
let ingestionQueue: Queue | null = null;

/** Get (or lazily create) the ingestion producer queue. */
export function getIngestionQueue(): Queue {
  if (!ingestionQueue) {
    ingestionQueue = new Queue(INGESTION_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }
  return ingestionQueue;
}

/**
 * Enqueue an ingestion job. Called by `POST /memories` right after the raw
 * INSERT — this is the ONLY async handoff on the sacred fast path (spec 01 §2).
 */
export async function enqueueIngestion(memoryId: string): Promise<void> {
  const data: IngestionJobData = { memoryId };
  await getIngestionQueue().add("ingest", data, INGESTION_JOB_OPTS);
}
