import { db, memories, eq } from "@repo/db";
// Root export only — @repo/core's exports map deliberately exposes no
// ./queues subpath, so deep imports break check-types.
import { getIngestionQueue } from "@repo/core";

async function requeueFailed() {
  const failed = await db.select({ id: memories.id }).from(memories).where(eq(memories.status, 'failed'));
  console.log(`Found ${failed.length} failed memories.`);
  for (const m of failed) {
    await db.update(memories).set({ status: 'pending' }).where(eq(memories.id, m.id));
    await getIngestionQueue().add("ingest", { memoryId: m.id }, { jobId: m.id, removeOnComplete: true, removeOnFail: 3 });
    console.log(`Requeued ${m.id}`);
  }
  console.log("Done.");
  process.exit(0);
}
requeueFailed().catch(console.error);
