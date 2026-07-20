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
  // BullMQ requires maxRetriesPerRequest: null on Worker connections.
  // Keep options minimal so free-tier Redis Cloud (often ~30 clients) is not
  // stressed by extra ready-checks / offline queues from abandoned clients.
  return {
    url,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    // Helps identify this app in Redis CLIENT LIST when debugging max-clients.
    connectionName: process.env.REDIS_CONNECTION_NAME ?? "yaadora",
  };
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

// ---------------------------------------------------------------------------
// Reprocess queue (spec 02 §3.1) — slow, resumable replay for derived data.
// ---------------------------------------------------------------------------

export const REPROCESS_QUEUE_NAME = "reprocess";

export interface ReprocessJobData {
  afterId?: string;
  userId?: string;
}

export const REPROCESS_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: true,
  removeOnFail: false,
};

let reprocessQueue: Queue | null = null;

export function getReprocessQueue(): Queue {
  if (!reprocessQueue) {
    reprocessQueue = new Queue(REPROCESS_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }
  return reprocessQueue;
}

/** Start or continue a replay. One memory per job keeps the worker limiter exact. */
export async function enqueueReprocess(data: ReprocessJobData = {}): Promise<void> {
  await getReprocessQueue().add("reprocess-memory", data, REPROCESS_JOB_OPTS);
}

// ---------------------------------------------------------------------------
// Consolidation queue (spec 02 §5) — the nightly "sleep" job. A single
// repeatable job fans out over all users inside the worker.
// ---------------------------------------------------------------------------

export const CONSOLIDATION_QUEUE_NAME = "consolidation";

/** null userId = every user; the worker resolves the list. */
export interface ConsolidationJobData {
  userId: string | null;
}

/** Cron for the nightly run. Server-local time; tune per deployment. */
export const CONSOLIDATION_CRON = process.env.CONSOLIDATION_CRON ?? "0 3 * * *";

let consolidationQueue: Queue | null = null;

export function getConsolidationQueue(): Queue {
  if (!consolidationQueue) {
    consolidationQueue = new Queue(CONSOLIDATION_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }
  return consolidationQueue;
}

/**
 * Register the nightly repeatable job (idempotent — fixed jobId, so re-running
 * at worker boot just re-affirms the schedule).
 */
export async function scheduleNightlyConsolidation(): Promise<void> {
  const data: ConsolidationJobData = { userId: null };
  await getConsolidationQueue().add("nightly", data, {
    repeat: { pattern: CONSOLIDATION_CRON },
    jobId: "nightly-consolidation",
    removeOnComplete: true,
    removeOnFail: false,
  });
}
