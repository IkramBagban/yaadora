/**
 * One-shot: delete the local/eval bootstrap user (and ALL their data), then
 * FLUSHDB Redis so clientId idempotency + queues are clean for a fresh eval.
 *
 *   DATABASE_URL=... REDIS_URL=... bun run scripts/clear-eval-user.ts
 *
 * Defaults SEED_USER_EMAIL=owner@yaadora.local
 */
// Resolve workspace deps (script lives at repo root; packages aren't hoisted to root).
import postgres from "../packages/db/node_modules/postgres/src/index.js";
import Redis from "../packages/core/node_modules/ioredis";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const EMAIL = process.env.SEED_USER_EMAIL ?? "owner@yaadora.local";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
if (!REDIS_URL) {
  console.error("REDIS_URL is required");
  process.exit(2);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

console.log("==> Looking up eval/local user:", EMAIL);
const users = await sql`
  SELECT id, email, created_at FROM users WHERE email = ${EMAIL}
`;

if (users.length === 0) {
  console.log("No user row for", EMAIL, "— nothing to delete in DB.");
} else {
  const userId = users[0]!.id as string;
  console.log("Found user", userId);

  // Child → parent (no ON DELETE CASCADE from users on most tables).
  const steps: Array<[string, () => Promise<unknown>]> = [
    [
      "conversation_turns",
      () => sql`DELETE FROM conversation_turns WHERE user_id = ${userId}`,
    ],
    ["surfacings", () => sql`DELETE FROM surfacings WHERE user_id = ${userId}`],
    ["open_loops", () => sql`DELETE FROM open_loops WHERE user_id = ${userId}`],
    [
      "entity_edges",
      () => sql`DELETE FROM entity_edges WHERE user_id = ${userId}`,
    ],
    [
      "memory_entities",
      () => sql`
        DELETE FROM memory_entities me
        USING memories m
        WHERE me.memory_id = m.id AND m.user_id = ${userId}
      `,
    ],
    ["facts", () => sql`DELETE FROM facts WHERE user_id = ${userId}`],
    ["rules", () => sql`DELETE FROM rules WHERE user_id = ${userId}`],
    ["reminders", () => sql`DELETE FROM reminders WHERE user_id = ${userId}`],
    ["digests", () => sql`DELETE FROM digests WHERE user_id = ${userId}`],
    ["eval_cases", () => sql`DELETE FROM eval_cases WHERE user_id = ${userId}`],
    [
      "push_tokens",
      () => sql`DELETE FROM push_tokens WHERE user_id = ${userId}`,
    ],
    [
      "conversations",
      () => sql`DELETE FROM conversations WHERE user_id = ${userId}`,
    ],
    ["memories", () => sql`DELETE FROM memories WHERE user_id = ${userId}`],
    ["entities", () => sql`DELETE FROM entities WHERE user_id = ${userId}`],
    ["users", () => sql`DELETE FROM users WHERE id = ${userId}`],
  ];

  for (const [name, fn] of steps) {
    try {
      const res = await fn();
      const count = Array.isArray(res) ? res.count : (res as any)?.count;
      console.log(`  cleared ${name}${count != null ? ` (${count})` : ""}`);
    } catch (err) {
      console.error(
        `  FAILED ${name}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  const check = await sql`SELECT id FROM users WHERE email = ${EMAIL}`;
  console.log("User remaining rows:", check.length);
}

await sql.end({ timeout: 5 });

console.log("==> Flushing Redis (FLUSHDB)...");
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 2,
  connectTimeout: 20000,
  family: 4,
});
try {
  console.log("  Redis PING:", await redis.ping());
  console.log("  keys before:", await redis.dbsize());
  await redis.flushdb();
  console.log("  keys after FLUSHDB:", await redis.dbsize());
} finally {
  await redis.quit();
}

console.log("==> Done. Restart server/worker, then: bun run eval:ingest");
