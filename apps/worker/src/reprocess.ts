import { Worker, type Job } from "bullmq";
import {
  REPROCESS_QUEUE_NAME,
  createRedisConnection,
  enqueueReprocess,
  runReprocessJob,
  type ReprocessJobData,
} from "@repo/core";
import { createLogger } from "@repo/logger";

const log = createLogger("worker:reprocess");

// This is intentionally a separate worker. BullMQ applies the limiter across
// all reprocess workers, preventing a historical replay from consuming the
// ingestion model capacity needed for new captures.
const MAX_PER_MINUTE = Number(process.env.REPROCESS_MAX_PER_MINUTE ?? "12");

export function registerReprocessWorker(): Worker<ReprocessJobData> {
  const worker = new Worker<ReprocessJobData>(
    REPROCESS_QUEUE_NAME,
    async (job: Job<ReprocessJobData>) => {
      const nextAfterId = await runReprocessJob(job.data);
      if (nextAfterId) {
        await enqueueReprocess({ afterId: nextAfterId, userId: job.data.userId });
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
      limiter: { max: MAX_PER_MINUTE, duration: 60_000 },
    },
  );
  worker.on("ready", () =>
    log.info("reprocess worker ready", {
      queue: REPROCESS_QUEUE_NAME,
      maxPerMinute: MAX_PER_MINUTE,
    }),
  );
  worker.on("error", (err) => log.error("reprocess worker error", err));
  return worker;
}
