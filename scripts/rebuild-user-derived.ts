/**
 * Wipe derived graph/facts/rules/reminders for ONE user, then re-run ingestion
 * over all their memories (manual + conversation). Raw memories + conversation
 * turns are preserved. Embedding provider is left as configured in env.
 *
 *   bun run scripts/rebuild-user-derived.ts
 *   EMAIL=ikrambagban.dev@gmail.com bun run scripts/rebuild-user-derived.ts
 */
import {
  db,
  sql,
  eq,
  users,
  memories,
  facts,
  entities,
  entityEdges,
  openLoops,
  rules,
  digests,
  reminders,
  surfacings,
  conversations,
} from "../packages/db/index.ts";
import { runReprocessJob } from "../packages/core/ingestion/reprocess.ts";
import { runConsolidation } from "../packages/core/consolidation/index.ts";

const EMAIL = process.env.EMAIL ?? "ikrambagban.dev@gmail.com";

function assertProvider() {
  const p = (process.env.AI_PROVIDER ?? "").toLowerCase();
  const emb = (process.env.EMBEDDING_PROVIDER ?? "").toLowerCase();
  console.log("AI_PROVIDER=", p);
  console.log("OPENAI_BASE_URL=", process.env.OPENAI_BASE_URL);
  console.log("EMBEDDING_PROVIDER=", emb);
  if (p !== "openai" && p !== "antigravity") {
    throw new Error(
      `Expected AI_PROVIDER=openai|antigravity for subsidized rebuild, got ${p}`,
    );
  }
}

async function counts(userId: string) {
  const one = async (q: string) => {
    const r: any = await db.execute(sql.raw(q));
    return r.rows?.[0] ?? r[0] ?? r;
  };
  return {
    memories: await one(`select count(*)::int as n,
      count(*) filter (where source='manual')::int as manual,
      count(*) filter (where source='conversation')::int as conversation,
      count(*) filter (where status='processed')::int as processed,
      count(*) filter (where status='pending')::int as pending,
      count(*) filter (where status='failed')::int as failed
      from memories where user_id='${userId}'`),
    facts: await one(
      `select count(*)::int as n from facts where user_id='${userId}'`,
    ),
    entities: await one(
      `select count(*)::int as n from entities where user_id='${userId}'`,
    ),
    memory_entities: await one(`select count(*)::int as n from memory_entities me
      join memories m on m.id=me.memory_id where m.user_id='${userId}'`),
    entity_edges: await one(
      `select count(*)::int as n from entity_edges where user_id='${userId}'`,
    ),
    open_loops: await one(
      `select count(*)::int as n from open_loops where user_id='${userId}'`,
    ),
    rules: await one(
      `select count(*)::int as n from rules where user_id='${userId}'`,
    ),
    digests: await one(
      `select count(*)::int as n from digests where user_id='${userId}'`,
    ),
    reminders: await one(
      `select count(*)::int as n from reminders where user_id='${userId}'`,
    ),
    surfacings: await one(
      `select count(*)::int as n from surfacings where user_id='${userId}'`,
    ),
    conversations: await one(
      `select count(*)::int as n from conversations where user_id='${userId}'`,
    ),
    turns: await one(
      `select count(*)::int as n from conversation_turns where user_id='${userId}'`,
    ),
  };
}

async function main() {
  assertProvider();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, EMAIL))
    .limit(1);
  if (!user) {
    console.error("User not found:", EMAIL);
    process.exit(1);
  }
  console.log("User:", user.id, user.email);

  const before = await counts(user.id);
  console.log("BEFORE:", JSON.stringify(before, null, 2));

  const skipWipe =
    process.env.SKIP_WIPE === "1" || process.env.SKIP_WIPE === "true";

  if (skipWipe) {
    console.log("SKIP_WIPE set — keeping existing derived rows, resuming only.");
  } else {
    console.log(
      "Wiping derived rows (keeping memories + conversation turns)...",
    );

    await db.delete(surfacings).where(eq(surfacings.userId, user.id));
    await db.delete(digests).where(eq(digests.userId, user.id));
    await db.delete(entityEdges).where(eq(entityEdges.userId, user.id));
    await db.delete(openLoops).where(eq(openLoops.userId, user.id));
    await db.delete(rules).where(eq(rules.userId, user.id));
    await db.delete(reminders).where(eq(reminders.userId, user.id));
    await db.delete(facts).where(eq(facts.userId, user.id));

    await db.execute(sql.raw(`
    DELETE FROM memory_entities
    WHERE memory_id IN (SELECT id FROM memories WHERE user_id = '${user.id}')
  `));

    await db.delete(entities).where(eq(entities.userId, user.id));

    await db
      .update(conversations)
      .set({ summary: null })
      .where(eq(conversations.userId, user.id));

    await db
      .update(memories)
      .set({ status: "pending" })
      .where(eq(memories.userId, user.id));

    const mid = await counts(user.id);
    console.log(
      "AFTER WIPE (memories/turns should remain):",
      JSON.stringify(mid, null, 2),
    );
  }

  // PENDING_ONLY=1 (default when SKIP_WIPE=1) only re-runs pending/failed rows —
  // useful to resume after a partial rebuild without redoing already-processed ones.
  const pendingOnly =
    process.env.PENDING_ONLY === "1" ||
    process.env.PENDING_ONLY === "true" ||
    process.env.SKIP_WIPE === "1";

  if (pendingOnly) {
    console.log(
      "Reprocessing PENDING/FAILED memories only (resume mode, no full scan of processed)...",
    );
    const { runIngestion } = await import(
      "../packages/core/ingestion/pipeline.ts"
    );
    const pending = await db
      .select({ id: memories.id, status: memories.status })
      .from(memories)
      .where(eq(memories.userId, user.id));
    const todo = pending.filter((m) => m.status !== "processed");
    // Limited parallelism: speeds Grok waits without hammering rate limits / Neon.
    // CONCURRENCY=1 sequential; default 2; cap at 4.
    const concurrency = Math.min(
      4,
      Math.max(1, Number(process.env.CONCURRENCY ?? "2") || 2),
    );
    console.log(
      `  ${todo.length} to process of ${pending.length} total (concurrency=${concurrency})`,
    );
    let completed = 0;
    let failed = 0;
    const started = Date.now();
    let nextIndex = 0;

    async function worker(workerId: number): Promise<void> {
      while (true) {
        const i = nextIndex++;
        if (i >= todo.length) return;
        const m = todo[i]!;
        const label = `[${i + 1}/${todo.length} w${workerId}]`;
        console.log(`  ${label} ${m.status} → ${m.id}`);
        try {
          await runIngestion(m.id);
          completed += 1;
          console.log(`  ${label} ok`);
        } catch (err) {
          failed += 1;
          console.error(
            `  ${label} FAILED ${m.id}:`,
            err instanceof Error ? err.message : err,
          );
          try {
            await db
              .update(memories)
              .set({ status: "failed" })
              .where(eq(memories.id, m.id));
          } catch {
            /* ignore */
          }
        }
      }
    }

    await Promise.all(
      Array.from({ length: concurrency }, (_, w) => worker(w + 1)),
    );
    if (failed) console.warn(`  ${failed} memories failed (status=failed)`);
    console.log(
      `Reprocess done: ${completed} ok, ${failed} failed, ${todo.length} attempted in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  } else {
    console.log(
      "Reprocessing all memories (manual + conversation) via ingestion pipeline...",
    );
    let afterId: string | undefined;
    let n = 0;
    const started = Date.now();
    while (true) {
      const next = await runReprocessJob({ userId: user.id, afterId });
      if (!next) break;
      afterId = next;
      n += 1;
      console.log(`  [${n}] memory ${next}`);
    }
    console.log(
      `Reprocess done: ${n} memories in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }

  console.log("Running consolidation (profiles, edges, digests)...");
  const cons = await runConsolidation({ userId: user.id, since: new Date(0) });
  console.log("Consolidation result:", cons);

  const after = await counts(user.id);
  console.log("AFTER REBUILD:", JSON.stringify(after, null, 2));
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
