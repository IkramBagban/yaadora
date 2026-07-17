const { db, users, eq } = require("./packages/db");
const { enqueueReprocess } = require("./packages/core/queues");

async function run() {
  const [user] = await db.select().from(users).where(eq(users.email, "ikrambagban.dev@gmail.com")).limit(1);
  if (!user) {
    console.error("No user found!");
    process.exit(1);
  }
  console.log("Found user:", user.id);
  console.log("Enqueuing reprocess...");
  await enqueueReprocess({ userId: user.id });
  console.log("Done enqueuing reprocess job!");
  process.exit(0);
}
run().catch(console.error);
