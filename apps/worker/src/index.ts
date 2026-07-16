import { Worker, type Job } from "bullmq";
import {
  INGESTION_QUEUE_NAME,
  CONSOLIDATION_QUEUE_NAME,
  createRedisConnection,
  runIngestion,
  runConsolidation,
  scheduleNightlyConsolidation,
  markMemoryFailed,
  type IngestionJobData,
  type ConsolidationJobData,
} from "@repo/core";
import { createLogger, initLogging } from "@repo/logger";
import {
  scheduleConversationMaintenance,
  startConversationMaintenanceWorker,
} from "./conversation-maintenance";
import {
  scheduleProspection,
  startProspectionWorker,
} from "./prospection";
import { registerReprocessWorker } from "./reprocess";

// Declare this process's log target FIRST — every log line (including those
// from @repo/core's ingestion/consolidation) is written to logs/worker.log in
// development.
initLogging("worker");
const log = createLogger("worker");

/**
 * apps/worker — the BullMQ ingestion worker (spec 01 §2, spec 02 §2).
 *
 * Consumes the `ingestion` queue (one job per captured memory) and runs the
 * full pipeline via `runIngestion(memoryId)`. The queue name, connection, and
 * job payload all come from @repo/core so the producer/consumer contract can't
 * drift.
 *
 * Run: `bun run src/index.ts` (or `bun run dev` for watch mode).
 */

// Concurrency: ingestion is I/O-bound (LLM + embeddings + DB). A handful of
// concurrent jobs keeps throughput up without hammering the model API. Tune via
// INGESTION_CONCURRENCY.
const CONCURRENCY = Number(process.env.INGESTION_CONCURRENCY ?? "5");

const worker = new Worker<IngestionJobData>(
  INGESTION_QUEUE_NAME,
  async (job: Job<IngestionJobData>) => {
    const startedAt = Date.now();
    log.info("ingestion started", {
      jobId: job.id,
      memoryId: job.data.memoryId,
      attempt: job.attemptsMade + 1,
    });
    await runIngestion(job.data.memoryId);
    log.debug("ingestion handler returned", {
      memoryId: job.data.memoryId,
      ms: Date.now() - startedAt,
    });
  },
  {
    connection: createRedisConnection(),
    concurrency: CONCURRENCY,
  },
);

worker.on("ready", () => {
  log.info("ingestion worker ready", {
    queue: INGESTION_QUEUE_NAME,
    concurrency: CONCURRENCY,
  });
});

worker.on("completed", (job) => {
  log.info("ingestion completed", { jobId: job.id, memoryId: job.data.memoryId });
});

// Retries/backoff are configured on the job (INGESTION_JOB_OPTS in @repo/core).
// This fires on EVERY failed attempt; only on the FINAL attempt do we mark the
// memory failed — its raw text is never lost (spec 02 §2.6).
worker.on("failed", async (job, err) => {
  if (!job) {
    log.error("ingestion job failed (no job handle)", err);
    return;
  }
  const attempts = job.opts.attempts ?? 1;
  log.warn("ingestion attempt failed", {
    memoryId: job.data.memoryId,
    attempt: job.attemptsMade,
    maxAttempts: attempts,
    error: err?.message ?? String(err),
  });
  if (job.attemptsMade >= attempts) {
    try {
      await markMemoryFailed(job.data.memoryId);
      log.error("memory marked failed after exhausting retries", {
        memoryId: job.data.memoryId,
        attempts,
      });
    } catch (markErr) {
      log.error("could not mark memory failed", {
        memoryId: job.data.memoryId,
        err: markErr,
      });
    }
  }
});

worker.on("error", (err) => {
  log.error("ingestion worker error", err);
});

// --- Consolidation worker (spec 02 §5) — the nightly "sleep" job -----------

const consolidationWorker = new Worker<ConsolidationJobData>(
  CONSOLIDATION_QUEUE_NAME,
  async (job: Job<ConsolidationJobData>) => {
    log.info("consolidation started", { jobId: job.id, userId: job.data.userId });
    const reports = await runConsolidation({ userId: job.data.userId });
    log.info("consolidation done", { users: reports.length, reports });
  },
  { connection: createRedisConnection(), concurrency: 1 },
);

// Historical replay has its own rate-limited worker, so normal capture
// ingestion remains responsive. An operator starts it with enqueueReprocess().
const reprocessWorker = registerReprocessWorker();

consolidationWorker.on("error", (err) => {
  log.error("consolidation worker error", err);
});

// Register the nightly repeatable job (idempotent — fixed jobId).
scheduleNightlyConsolidation()
  .then(() => log.info("nightly consolidation scheduled"))
  .catch((err) => log.error("could not schedule consolidation", err));

// --- Conversation maintenance (idle sweep + retention) — P0 item 2 ---------
// Append-only: module owns its queue/worker; do not fold into shared registration.
const conversationMaintenanceWorker = startConversationMaintenanceWorker();

scheduleConversationMaintenance()
  .then(() => log.info("conversation maintenance scheduled"))
  .catch((err) => log.error("could not schedule conversation maintenance", err));

// --- Prospection (daily foresight, morning local time) — P2 -----------------
// Append-only: module owns its queue/worker; do not fold into shared registration.
const prospectionWorker = startProspectionWorker();

scheduleProspection()
  .then(() => log.info("prospection scheduled"))
  .catch((err) => log.error("could not schedule prospection", err));

// Graceful shutdown so in-flight jobs finish and connections close cleanly.
async function shutdown(signal: string) {
  log.info("shutdown signal received — closing workers", { signal });
  await Promise.all([
    worker.close(),
    consolidationWorker.close(),
    conversationMaintenanceWorker.close(),
    prospectionWorker.close(),
    reprocessWorker.close(),
  ]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log.info(
  "starting ingestion + consolidation + conversation-maintenance + prospection + reprocess workers",
);
