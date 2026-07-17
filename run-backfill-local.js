const { db, users, eq } = require("./packages/db");
const { runReprocessJob } = require("./packages/core/ingestion/reprocess");

async function run() {
  console.log("Running reprocess locally over all users...");
  let afterId = undefined;
  let count = 0;
  do {
    const nextId = await runReprocessJob({ afterId });
    if (nextId) count++;
    afterId = nextId;
  } while (afterId);
  console.log(`Done reprocessing ${count} memories!`);
  process.exit(0);
}
run().catch(console.error);
