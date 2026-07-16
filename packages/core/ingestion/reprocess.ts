import { and, asc, db, eq, gt, memories } from "@repo/db";
import { runIngestion } from "./pipeline";

/** A cursor makes replay resumable without putting raw memory text in Redis. */
export interface ReprocessJobData {
  /** Last replayed memory id; omitted for the first memory. */
  afterId?: string;
  /** Optional fixture/operator scope; omitted replays every user's memories. */
  userId?: string;
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
  const conditions = [];
  if (data.userId) conditions.push(eq(memories.userId, data.userId));
  if (data.afterId) conditions.push(gt(memories.id, data.afterId));
  const query = db
    .select({ id: memories.id })
    .from(memories)
    .orderBy(asc(memories.id))
    .limit(1);
  const [memory] = conditions.length ? await query.where(and(...conditions)) : await query;
  if (!memory) return null;

  // runIngestion derives rows and metadata only; memories.rawText stays immutable.
  await runIngestion(memory.id);
  return memory.id;
}
