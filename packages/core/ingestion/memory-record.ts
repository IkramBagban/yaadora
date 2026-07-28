import { db, memories, users, eq, and, sql } from "@repo/db";
import type { Memory } from "@repo/db";

/**
 * The memories-row lifecycle: the writes ingestion makes to the memory itself,
 * as opposed to the rows it derives. One memory walks
 * pending → processing → processed, or → failed once BullMQ gives up.
 *
 * Every write here is idempotent, because a retried job re-enters at the top.
 * `rawText` is never touched by any of them — nothing the user captured is ever
 * lost, whatever happens downstream (spec 02 §2.6).
 */

/**
 * The memory columns ingestion actually reads.
 *
 * Narrowed on purpose. The full row also carries `embedding` (1536-d vector) and
 * `fts` (a generated tsvector over raw_text); ingestion uses neither, and step 7
 * overwrites the embedding anyway. Selecting them would drag ~15-20KB per row
 * across the wire for nothing — invisible on a first ingest (the column is still
 * null) but real on the reprocess/rebuild paths, which replay already-processed
 * memories in bulk.
 *
 * Keeping this a `Pick` of `Memory` means it stays in sync with the schema, and
 * a stage that starts needing another column has to widen it here first.
 */
export type IngestedMemory = Pick<
  Memory,
  "id" | "userId" | "rawText" | "createdAt" | "occurredAt"
>;

/** Everything the pipeline needs from the database before extraction can run. */
export interface IngestionContext {
  memory: IngestedMemory;
  /** The owner's timezone, or "UTC" when the user row is missing. */
  timezone: string;
}

/**
 * Step 1 — load the memory and its owner, then mark the row `processing`.
 *
 * Returns null when the memory no longer exists (deleted mid-flight): nothing
 * to do, and not an error worth retrying. The status write is idempotent, so a
 * BullMQ retry re-enters here safely.
 */
export async function loadIngestionContext(
  memoryId: string,
): Promise<IngestionContext | null> {
  const [memory] = await db
    .select({
      id: memories.id,
      userId: memories.userId,
      rawText: memories.rawText,
      createdAt: memories.createdAt,
      occurredAt: memories.occurredAt,
    })
    .from(memories)
    .where(eq(memories.id, memoryId))
    .limit(1);
  if (!memory) return null;

  const [user] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, memory.userId))
    .limit(1);

  await db
    .update(memories)
    .set({ status: "processing" })
    .where(eq(memories.id, memoryId));

  return { memory, timezone: user?.timezone ?? "UTC" };
}

/**
 * Step 7 — finalize: the memory's own embedding, its resolved event time, and
 * the terminal `processed` status.
 */
export async function finalizeMemory(params: {
  memoryId: string;
  embedding: number[] | undefined;
  occurredAt: Date | null;
}): Promise<void> {
  const { memoryId, embedding, occurredAt } = params;
  await db
    .update(memories)
    .set({
      embedding: embedding ?? null,
      occurredAt,
      status: "processed",
    })
    .where(eq(memories.id, memoryId));
}

/** Best-effort: mark a memory failed after BullMQ exhausts retries (§2.6).
 * Raw text is untouched — nothing is ever lost. */
export async function markMemoryFailed(memoryId: string): Promise<void> {
  await db
    .update(memories)
    .set({ status: "failed" })
    .where(
      and(eq(memories.id, memoryId), sql`${memories.status} <> 'processed'`),
    );
}
