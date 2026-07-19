import { db, memories, eq } from "@repo/db";
import { ingestionQueue } from "@repo/core/queues/index";

async function requeueFailed() {
  const failed = await db.select({ id: memories.id }).from(memories).where(eq(memories.status, 'failed'));
  console.log(`Found ${failed.length} failed memories.`);
  for (const m of failed) {
    await db.update(memories).set({ status: 'pending' }).where(eq(memories.id, m.id));
    await ingestionQueue.add("ingest", { memoryId: m.id }, { jobId: m.id, removeOnComplete: true, removeOnFail: 3 });
    console.log(`Requeued ${m.id}`);
  }
  console.log("Done.");
  process.exit(0);
}
requeueFailed().catch(console.error);
