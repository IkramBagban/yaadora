import { expect, test } from "bun:test";

// This is a real rebuild test: it needs a disposable Postgres database and the
// ingestion-model credentials because replay deliberately uses the production
// extraction path. Keep local unit runs hermetic; CI enables it explicitly.
const runIntegration =
  process.env.RUN_REBUILD_STORY_TEST === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.GROQ_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);

const rebuildTest = runIntegration ? test : test.skip;

rebuildTest("rebuilds all derived records from fixture memories", async () => {
  const {
    db,
    users,
    memories,
    facts,
    entities,
    memoryEntities,
    rules,
    openLoops,
    entityEdges,
    digests,
    eq,
  } = require("@repo/db");
  const { runReprocessJob } = require("../ingestion/reprocess");
  const { runConsolidation } = require("../consolidation");

  const suffix = crypto.randomUUID();
  let userId: string | null = null;
  try {
    const [user] = await db
      .insert(users)
      .values({ email: `rebuild-fixture-${suffix}@example.test`, timezone: "UTC" })
      .returning({ id: users.id });
    userId = user.id;

    await db.insert(memories).values([
      {
        userId,
        rawText:
          "When I am about to publish on social media, make me check whether the post is useful and genuinely mine.",
        source: "manual",
      },
      {
        userId,
        rawText:
          "Rahul's equity split with Acme is still unresolved, and Rahul works at Acme.",
        source: "manual",
      },
      {
        userId,
        rawText: "We finally settled the equity split with Rahul at Acme.",
        source: "manual",
      },
    ]);

    async function replay(): Promise<void> {
      let afterId: string | undefined;
      do {
        afterId = (await runReprocessJob({ userId: userId!, afterId })) ?? undefined;
      } while (afterId);
      await runConsolidation({ userId: userId!, since: new Date(0) });
    }
    async function counts() {
      const count = async (table: unknown) =>
        (await db.select().from(table).where(eq(table.userId, userId!))).length;
      return {
        facts: await count(facts),
        entities: await count(entities),
        memoryEntities: await count(memoryEntities),
        rules: await count(rules),
        loops: await count(openLoops),
        edges: await count(entityEdges),
        digests: await count(digests),
      };
    }

    await replay();
    const before = await counts();
    for (const value of Object.values(before)) expect(value).toBeGreaterThan(0);

    // Preserve immutable memories and historical tables. Delete only the derived
    // rows called out in spec 02 §9, in FK-safe order.
    await db.delete(entityEdges).where(eq(entityEdges.userId, userId));
    await db.delete(memoryEntities).where(eq(memoryEntities.userId, userId));
    await db.delete(rules).where(eq(rules.userId, userId));
    await db.delete(openLoops).where(eq(openLoops.userId, userId));
    await db.delete(facts).where(eq(facts.userId, userId));
    await db.delete(digests).where(eq(digests.userId, userId));
    await db.delete(entities).where(eq(entities.userId, userId));

    await replay();
    const after = await counts();
    for (const [kind, value] of Object.entries(after)) {
      expect(value, `${kind} should be reproduced`).toBeGreaterThan(0);
    }
  } finally {
    if (userId) {
      await db.delete(entityEdges).where(eq(entityEdges.userId, userId));
      await db.delete(memoryEntities).where(eq(memoryEntities.userId, userId));
      await db.delete(rules).where(eq(rules.userId, userId));
      await db.delete(openLoops).where(eq(openLoops.userId, userId));
      await db.delete(facts).where(eq(facts.userId, userId));
      await db.delete(digests).where(eq(digests.userId, userId));
      await db.delete(entities).where(eq(entities.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});
