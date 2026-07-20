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
 *
 * Redis free tiers often cap ~30 clients. Each BullMQ Worker uses ~2
 * connections, and each producer Queue uses ~1. WORKER_MINIMAL=true (default in
 * development) starts only ingestion + consolidation so local dev does not hit
 * "ERR max number of clients reached".
 */

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

const IS_DEV = (process.env.NODE_ENV ?? "development") !== "production";
// Minimal mode: fewer Redis connections. Override with WORKER_MINIMAL=false.
const WORKER_MINIMAL = envFlag("WORKER_MINIMAL", IS_DEV);
const ENABLE_REPROCESS = envFlag("WORKER_ENABLE_REPROCESS", !WORKER_MINIMAL);
const ENABLE_CONVERSATION_MAINTENANCE = envFlag(
  "WORKER_ENABLE_CONVERSATION_MAINTENANCE",
  !WORKER_MINIMAL,
);
const ENABLE_PROSPECTION = envFlag("WORKER_ENABLE_PROSPECTION", !WORKER_MINIMAL);

// Concurrency: ingestion is I/O-bound (LLM + embeddings + DB). A handful of
// concurrent jobs keeps throughput up without hammering the model API. Tune via
// INGESTION_CONCURRENCY. Cap lower in minimal mode to reduce burst load.
const CONCURRENCY = Number(
  process.env.INGESTION_CONCURRENCY ?? (WORKER_MINIMAL ? "2" : "5"),
);

const closers: Array<() => Promise<void>> = [];

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
closers.push(() => worker.close());

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
closers.push(() => consolidationWorker.close());

consolidationWorker.on("error", (err) => {
  log.error("consolidation worker error", err);
});

// Register the nightly repeatable job (idempotent — fixed jobId).
scheduleNightlyConsolidation()
  .then(() => log.info("nightly consolidation scheduled"))
  .catch((err) => log.error("could not schedule consolidation", err));

// Optional workers — each one opens ~2 Redis connections (+ Queue producers).
if (ENABLE_REPROCESS) {
  const reprocessWorker = registerReprocessWorker();
  closers.push(() => reprocessWorker.close());
} else {
  log.info("reprocess worker disabled (WORKER_MINIMAL / WORKER_ENABLE_REPROCESS)");
}

if (ENABLE_CONVERSATION_MAINTENANCE) {
  const conversationMaintenanceWorker = startConversationMaintenanceWorker();
  closers.push(() => conversationMaintenanceWorker.close());
  scheduleConversationMaintenance()
    .then(() => log.info("conversation maintenance scheduled"))
    .catch((err) =>
      log.error("could not schedule conversation maintenance", err),
    );
} else {
  log.info(
    "conversation maintenance disabled (WORKER_MINIMAL / WORKER_ENABLE_CONVERSATION_MAINTENANCE)",
  );
}

if (ENABLE_PROSPECTION) {
  const prospectionWorker = startProspectionWorker();
  closers.push(() => prospectionWorker.close());
  scheduleProspection()
    .then(() => log.info("prospection scheduled"))
    .catch((err) => log.error("could not schedule prospection", err));
} else {
  log.info("prospection worker disabled (WORKER_MINIMAL / WORKER_ENABLE_PROSPECTION)");
}

// Graceful shutdown so in-flight jobs finish and connections close cleanly.
async function shutdown(signal: string) {
  log.info("shutdown signal received — closing workers", { signal });
  await Promise.all(closers.map((close) => close()));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log.info("starting workers", {
  minimal: WORKER_MINIMAL,
  ingestion: true,
  consolidation: true,
  reprocess: ENABLE_REPROCESS,
  conversationMaintenance: ENABLE_CONVERSATION_MAINTENANCE,
  prospection: ENABLE_PROSPECTION,
  concurrency: CONCURRENCY,
});
