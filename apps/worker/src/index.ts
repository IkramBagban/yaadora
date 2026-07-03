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
    await runIngestion(job.data.memoryId);
  },
  {
    connection: createRedisConnection(),
    concurrency: CONCURRENCY,
  },
);

worker.on("ready", () => {
  console.log(
    `[worker] ready — consuming "${INGESTION_QUEUE_NAME}" (concurrency ${CONCURRENCY})`,
  );
});

worker.on("completed", (job) => {
  console.log(`[worker] processed memory ${job.data.memoryId}`);
});

// Retries/backoff are configured on the job (INGESTION_JOB_OPTS in @repo/core).
// This fires on EVERY failed attempt; only on the FINAL attempt do we mark the
// memory failed — its raw text is never lost (spec 02 §2.6).
worker.on("failed", async (job, err) => {
  if (!job) {
    console.error("[worker] job failed (no job handle):", err);
    return;
  }
  const attempts = job.opts.attempts ?? 1;
  console.error(
    `[worker] memory ${job.data.memoryId} attempt ${job.attemptsMade}/${attempts} failed:`,
    err?.message ?? err,
  );
  if (job.attemptsMade >= attempts) {
    try {
      await markMemoryFailed(job.data.memoryId);
      console.error(
        `[worker] memory ${job.data.memoryId} marked failed after ${attempts} attempts`,
      );
    } catch (markErr) {
      console.error(
        `[worker] could not mark memory ${job.data.memoryId} failed:`,
        markErr,
      );
    }
  }
});

worker.on("error", (err) => {
  console.error("[worker] error:", err);
});

// --- Consolidation worker (spec 02 §5) — the nightly "sleep" job -----------

const consolidationWorker = new Worker<ConsolidationJobData>(
  CONSOLIDATION_QUEUE_NAME,
  async (job: Job<ConsolidationJobData>) => {
    const reports = await runConsolidation({ userId: job.data.userId });
    console.log(
      `[worker] consolidation done for ${reports.length} user(s):`,
      JSON.stringify(reports),
    );
  },
  { connection: createRedisConnection(), concurrency: 1 },
);

consolidationWorker.on("error", (err) => {
  console.error("[worker] consolidation error:", err);
});

// Register the nightly repeatable job (idempotent — fixed jobId).
scheduleNightlyConsolidation()
  .then(() => console.log("[worker] nightly consolidation scheduled"))
  .catch((err) => console.error("[worker] could not schedule consolidation:", err));

// Graceful shutdown so in-flight jobs finish and connections close cleanly.
async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received — closing…`);
  await Promise.all([worker.close(), consolidationWorker.close()]);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log("[worker] starting ingestion + consolidation workers…");
