import { db, memories, eq } from "@repo/db";
import { enqueueIngestion } from "./queues";

async function requeueFailed() {
  const failed = await db.select({ id: memories.id }).from(memories).where(eq(memories.status, 'failed'));
  console.log(`Found ${failed.length} failed memories.`);
  for (const m of failed) {
    await db.update(memories).set({ status: 'pending' }).where(eq(memories.id, m.id));
    await enqueueIngestion(m.id);
    console.log(`Requeued ${m.id}`);
  }
  console.log("Done.");
  process.exit(0);
}
requeueFailed().catch(console.error);
