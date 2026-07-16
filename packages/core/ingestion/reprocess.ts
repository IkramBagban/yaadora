import { asc, db, gt, memories } from "@repo/db";
import { runIngestion } from "./pipeline";

/** A cursor makes replay resumable without putting raw memory text in Redis. */
export interface ReprocessJobData {
  /** Last replayed memory id; omitted for the first memory. */
  afterId?: string;
}

/**
 * Replay exactly one immutable memory. The worker's BullMQ limiter controls the
 * model-call rate; keeping jobs one-memory-wide also makes retries and resume
 * behavior unambiguous.
 *
 * Returns the cursor for the next job, or null when the historical scan ends.
 */
export async function runReprocessJob(
  data: ReprocessJobData,
): Promise<string | null> {
  const query = db
    .select({ id: memories.id })
    .from(memories)
    .orderBy(asc(memories.id))
    .limit(1);
  const [memory] = data.afterId
    ? await query.where(gt(memories.id, data.afterId))
    : await query;
  if (!memory) return null;

  // runIngestion derives rows and metadata only; memories.rawText stays immutable.
  await runIngestion(memory.id);
  return memory.id;
}
