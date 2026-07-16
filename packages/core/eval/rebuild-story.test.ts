import { expect, test } from "bun:test";

test("rebuilds all derived records from fixture memories", async () => {
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
    inArray,
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
    
    async function getMemoryIds() {
      const rows = await db.select({ id: memories.id }).from(memories).where(eq(memories.userId, userId!));
      return rows.map((r: { id: string }) => r.id);
    }

    async function counts() {
      const count = async (table: any) =>
        (await db.select().from(table).where(eq(table.userId, userId!))).length;
        
      const mIds = await getMemoryIds();
      let memEntitiesCount = 0;
      if (mIds.length > 0) {
        memEntitiesCount = (await db.select().from(memoryEntities).where(inArray(memoryEntities.memoryId, mIds))).length;
      }

      return {
        facts: await count(facts),
        entities: await count(entities),
        memoryEntities: memEntitiesCount,
        rules: await count(rules),
        loops: await count(openLoops),
        edges: await count(entityEdges),
        digests: await count(digests),
      };
    }

    await replay();
    const before = await counts();
    for (const value of Object.values(before)) expect(value).toBeGreaterThan(0);

    const mIds = await getMemoryIds();

    // Preserve immutable memories and historical tables. Delete only the derived
    // rows called out in spec 02 §9, in FK-safe order.
    await db.delete(entityEdges).where(eq(entityEdges.userId, userId));
    if (mIds.length > 0) {
      await db.delete(memoryEntities).where(inArray(memoryEntities.memoryId, mIds));
    }
    await db.delete(rules).where(eq(rules.userId, userId));
    await db.delete(openLoops).where(eq(openLoops.userId, userId));
    await db.delete(facts).where(eq(facts.userId, userId));
    await db.delete(digests).where(eq(digests.userId, userId));
    await db.delete(entities).where(eq(entities.userId, userId));

    await replay();
    const after = await counts();
    console.log("Before:", before);
    console.log("After:", after);
    for (const [kind, value] of Object.entries(after)) {
      // LLMs are non-deterministic and produce varying amounts of derived records (facts, edges, etc.)
      // across runs of the exact same input memory. We assert they are within a reasonable tolerance.
      const prev = (before as Record<string, number>)[kind];
      expect(Math.abs(value - prev)).toBeLessThanOrEqual(3);
      expect(value).toBeGreaterThan(0);
    }
  } finally {
    if (userId) {
      const mIds = await db.select({ id: memories.id }).from(memories).where(eq(memories.userId, userId));
      
      await db.delete(entityEdges).where(eq(entityEdges.userId, userId));
      if (mIds.length > 0) {
        await db.delete(memoryEntities).where(inArray(memoryEntities.memoryId, mIds.map(m => m.id)));
      }
      await db.delete(rules).where(eq(rules.userId, userId));
      await db.delete(openLoops).where(eq(openLoops.userId, userId));
      await db.delete(facts).where(eq(facts.userId, userId));
      await db.delete(digests).where(eq(digests.userId, userId));
      await db.delete(entities).where(eq(entities.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }
}, 120000);
