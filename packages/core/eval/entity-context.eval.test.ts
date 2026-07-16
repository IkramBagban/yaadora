/**
 * P3 graph-doorway evals (spec 03 P3): entity linking, context assembly, edge
 * status derivation, flagged-edge exclusion, and the awareness candidates that
 * feed edge/loop nudges.
 *
 * These are ASSERTION-judged (no LLM): they seed a graph directly and check the
 * data the reasoning model would be handed — the parts that must be right for
 * scenarios 1/2/3/7 to be possible. Answer-prose quality is left to the
 * LLM-judged golden suite. DB-backed; skipped without DATABASE_URL.
 */
import { describe, expect, test } from "bun:test";

const hasDb = Boolean(process.env.DATABASE_URL);
const dbTest = hasDb ? test : test.skip;

const NOW = new Date("2026-07-16T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

async function seedUser(suffix: string): Promise<string> {
  const { db, users } = require("@repo/db");
  const [u] = await db
    .insert(users)
    .values({ email: `p3-${suffix}@example.test`, timezone: "UTC" })
    .returning({ id: users.id });
  return u.id;
}

async function cleanup(userId: string): Promise<void> {
  const {
    db,
    users,
    memories,
    facts,
    entities,
    openLoops,
    entityEdges,
    surfacings,
    eq,
  } = require("@repo/db");
  // memory_entities has ON DELETE CASCADE from both memories and entities.
  await db.delete(surfacings).where(eq(surfacings.userId, userId));
  await db.delete(entityEdges).where(eq(entityEdges.userId, userId));
  await db.delete(openLoops).where(eq(openLoops.userId, userId));
  await db.delete(facts).where(eq(facts.userId, userId));
  await db.delete(entities).where(eq(entities.userId, userId));
  await db.delete(memories).where(eq(memories.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

async function seedMemory(userId: string, rawText: string): Promise<string> {
  const { db, memories } = require("@repo/db");
  const [m] = await db
    .insert(memories)
    .values({ userId, rawText, source: "manual", status: "processed" })
    .returning({ id: memories.id });
  return m.id;
}

async function seedEntity(
  userId: string,
  canonicalName: string,
  type = "person",
): Promise<string> {
  const { db, entities } = require("@repo/db");
  const [e] = await db
    .insert(entities)
    .values({ userId, type, canonicalName, mentionCount: 1 })
    .returning({ id: entities.id });
  return e.id;
}

async function seedFact(params: {
  userId: string;
  subjectId: string | null;
  objectId: string | null;
  predicate: string | null;
  factText: string;
  sourceMemory: string;
  validTo?: Date | null;
  salience?: number;
}): Promise<string> {
  const { db, facts } = require("@repo/db");
  const [f] = await db
    .insert(facts)
    .values({
      userId: params.userId,
      subjectId: params.subjectId,
      objectId: params.objectId,
      predicate: params.predicate,
      objectText: null,
      factText: params.factText,
      validFrom: new Date(NOW.getTime() - 30 * DAY_MS),
      validTo: params.validTo ?? null,
      factType: "semantic",
      origin: "extraction",
      confidence: 0.9,
      sourceMemory: params.sourceMemory,
      salience: params.salience ?? 0.5,
    })
    .returning({ id: facts.id });
  return f.id;
}

// ---------------------------------------------------------------------------
// Scenario 1 — Rahul visit: equity loop + edge status + no-repeat ledger
// ---------------------------------------------------------------------------

dbTest("scenario 1: equity loop assembled with receipts; nudge doesn't repeat", async () => {
  const { db, openLoops, materializeEntityEdges } = require("@repo/db");
  const { assembleEntityContext } = require("@repo/core");
  const {
    loadAwarenessCandidates,
    evaluateAndRecord,
  } = require("@repo/core");

  const userId = await seedUser(`s1-${crypto.randomUUID()}`);
  try {
    const mem = await seedMemory(
      userId,
      "Rahul is my co-founder at Acme; the equity split was never resolved. He's job-hunting now.",
    );
    const rahul = await seedEntity(userId, "Rahul");
    const acme = await seedEntity(userId, "Acme", "org");
    await seedEntity(userId, "Aditya");
    const adityaMem = await seedMemory(userId, "Aditya is hiring backend engineers.");

    await seedFact({
      userId,
      subjectId: rahul,
      objectId: acme,
      predicate: "co-founded with",
      factText: "Rahul co-founded Acme with me.",
      sourceMemory: mem,
      salience: 0.9,
    });
    await seedFact({
      userId,
      subjectId: rahul,
      objectId: null,
      predicate: "is",
      factText: "Rahul is job-hunting.",
      sourceMemory: mem,
      salience: 0.8,
    });
    await seedFact({
      userId,
      subjectId: null,
      objectId: null,
      predicate: "is",
      factText: "Aditya is hiring backend engineers.",
      sourceMemory: adityaMem,
      salience: 0.7,
    });

    const [loop] = await db
      .insert(openLoops)
      .values({
        userId,
        kind: "unresolved_conflict",
        title: "Equity split with Rahul never resolved",
        entityId: rahul,
        status: "open",
        sourceMemory: mem,
      })
      .returning({ id: openLoops.id });

    await materializeEntityEdges(userId);

    // Assembly surfaces the equity loop with its provenance receipt.
    const ctx = await assembleEntityContext(userId, rahul);
    expect(ctx).not.toBeNull();
    const equity = ctx.openLoops.find((l: { id: string }) => l.id === loop.id);
    expect(equity, "equity loop present").toBeTruthy();
    expect(equity.sourceMemory).toBe(mem);
    expect(ctx.receipts).toContain(mem);

    // The Rahul–Acme edge is derived 'unresolved' (conflict loop on an endpoint).
    const acmeEdge = ctx.edges.find(
      (e: { otherId: string }) => e.otherId === acme,
    );
    expect(acmeEdge, "Rahul–Acme edge present").toBeTruthy();
    expect(acmeEdge.status).toBe("unresolved");

    // Awareness offers a candidate for the linked entity (loop or edge).
    const candidates = await loadAwarenessCandidates({
      userId,
      now: NOW,
      linkedEntityIds: [rahul],
    });
    expect(
      candidates.some(
        (c: { subjectId: string }) =>
          c.subjectId === loop.id || c.subjectId === acmeEdge.id,
      ),
      "an equity/edge candidate is offered",
    ).toBe(true);

    // No-repeat: approve once, mark ignored, then the same subject is gated off.
    const first = await evaluateAndRecord({
      userId,
      conversationId: null,
      candidate: {
        kind: "loop_nudge",
        subjectType: "open_loop",
        subjectId: loop.id,
        oneLineNudge: "You never settled the equity split with Rahul — worth raising?",
        evidence: [mem],
        confidence: 0.9,
      },
      seam: "open",
      channel: "conversation",
      now: NOW,
    });
    expect(first.approved).toBe(true);

    // Mark it ignored (as the idle sweep would), then re-evaluate next day.
    const { surfacings, eq } = require("@repo/db");
    await db
      .update(surfacings)
      .set({ reaction: "ignored" })
      .where(eq(surfacings.id, first.surfacingId));

    const second = await evaluateAndRecord({
      userId,
      conversationId: null,
      candidate: {
        kind: "loop_nudge",
        subjectType: "open_loop",
        subjectId: loop.id,
        oneLineNudge: "Equity split with Rahul?",
        evidence: [mem],
        confidence: 0.9,
      },
      seam: "open",
      channel: "conversation",
      now: new Date(NOW.getTime() + DAY_MS),
    });
    expect(second.approved).toBe(false);
    expect(second.outcome.reason).toBe("ledger_ignored_cooldown");
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// Scenario 3 — Rahul × Vikram: an ENDED edge is visible in Rahul's context
// ---------------------------------------------------------------------------

dbTest("scenario 3: ended co-founding edge appears in assembled context", async () => {
  const { materializeEntityEdges } = require("@repo/db");
  const { assembleEntityContext } = require("@repo/core");

  const userId = await seedUser(`s3-${crypto.randomUUID()}`);
  try {
    const mem = await seedMemory(
      userId,
      "Rahul and Vikram co-founded a startup that later wound down.",
    );
    const rahul = await seedEntity(userId, "Rahul");
    const vikram = await seedEntity(userId, "Vikram");
    // Closed relationship fact → the edge must derive as 'ended'.
    await seedFact({
      userId,
      subjectId: rahul,
      objectId: vikram,
      predicate: "co-founded with",
      factText: "Rahul co-founded a startup with Vikram.",
      sourceMemory: mem,
      validTo: new Date(NOW.getTime() - 60 * DAY_MS),
    });

    await materializeEntityEdges(userId);
    const ctx = await assembleEntityContext(userId, rahul);
    const edge = ctx.edges.find((e: { otherId: string }) => e.otherId === vikram);
    expect(edge, "Rahul–Vikram edge present").toBeTruthy();
    expect(edge.status).toBe("ended");
    expect(edge.otherName).toBe("Vikram");
    expect(edge.otherIsKnownEntity).toBe(true);
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// Scenario 2 & 7 — linking: single-mention findable by name; multi-entity cap
// ---------------------------------------------------------------------------

dbTest("scenario 2: single-mention entity is linkable by name and assembles", async () => {
  const { db, memoryEntities } = require("@repo/db");
  const { linkTurnEntities, assembleEntityContext } = require("@repo/core");

  const userId = await seedUser(`s2-${crypto.randomUUID()}`);
  try {
    const mem = await seedMemory(
      userId,
      "Met Priya once at a meetup — she's done B2B sales for a dev tool.",
    );
    const priya = await seedEntity(userId, "Priya");
    await db.insert(memoryEntities).values({ memoryId: mem, entityId: priya });
    await seedFact({
      userId,
      subjectId: priya,
      objectId: null,
      predicate: "did",
      factText: "Priya has done B2B sales for a dev tool.",
      sourceMemory: mem,
    });

    // The agent, having found her in search, resolves her by name (tool mode).
    const links = await linkTurnEntities({ userId, userTurn: "Priya" });
    expect(links.map((l: { entityId: string }) => l.entityId)).toContain(priya);

    const ctx = await assembleEntityContext(userId, priya);
    expect(ctx.facts.some((f: { factText: string }) => /B2B sales/i.test(f.factText))).toBe(
      true,
    );
  } finally {
    await cleanup(userId);
  }
});

dbTest("scenario 7: a multi-entity decision turn links both, within the 2-cap", async () => {
  const { linkTurnEntities, assembleEntityContext } = require("@repo/core");

  const userId = await seedUser(`s7-${crypto.randomUUID()}`);
  try {
    await seedEntity(userId, "Aditya");
    await seedEntity(userId, "Meera");
    await seedEntity(userId, "Bangalore", "place");

    const links = await linkTurnEntities({
      userId,
      userTurn:
        "Thinking about the Bangalore move — I should talk it through with Meera and Aditya.",
    });
    expect(links.length).toBeLessThanOrEqual(2);
    const names = links.map((l: { canonicalName: string }) => l.canonicalName);
    // Both people are linked (place may or may not make the 2-cap).
    expect(names).toContain("Meera");
    expect(names).toContain("Aditya");

    for (const l of links) {
      const ctx = await assembleEntityContext(userId, l.entityId);
      expect(ctx).not.toBeNull();
    }
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// Linker precision — two "Urhan"s stay distinct; unknown links to nothing
// ---------------------------------------------------------------------------

dbTest("linker precision: two same-name entities stay distinct; unknown → nothing", async () => {
  const { linkTurnEntities } = require("@repo/core");

  const userId = await seedUser(`prec-${crypto.randomUUID()}`);
  try {
    // Two "Urhan"s with NO profile embedding → the ambiguity can't be broken.
    await seedEntity(userId, "Urhan", "person");
    await seedEntity(userId, "Urhan", "project");

    const ambiguous = await linkTurnEntities({
      userId,
      userTurn: "Had a call with Urhan about it",
    });
    // Prefer no link over a wrong one.
    expect(ambiguous).toEqual([]);

    const unknown = await linkTurnEntities({
      userId,
      userTurn: "Zephyrina never showed up",
    });
    expect(unknown).toEqual([]);
  } finally {
    await cleanup(userId);
  }
});

// ---------------------------------------------------------------------------
// Edge status derivation + flagged-edge exclusion + flag survives rebuild
// ---------------------------------------------------------------------------

dbTest("edge status: active/unresolved/ended derived; flagged edges excluded + survive rebuild", async () => {
  const {
    db,
    entityEdges,
    openLoops,
    materializeEntityEdges,
    flagEntityEdge,
    getOneHopEdges,
    eq,
    and,
  } = require("@repo/db");

  const userId = await seedUser(`edge-${crypto.randomUUID()}`);
  try {
    const mem = await seedMemory(userId, "Graph fixtures.");
    const a = await seedEntity(userId, "Alpha");
    const b = await seedEntity(userId, "Beta");
    const c = await seedEntity(userId, "Gamma");
    const d = await seedEntity(userId, "Delta");

    // active: a plain current relationship.
    await seedFact({
      userId, subjectId: a, objectId: b, predicate: "works with",
      factText: "Alpha works with Beta.", sourceMemory: mem,
    });
    // ended: a fully-closed relationship.
    await seedFact({
      userId, subjectId: a, objectId: c, predicate: "co-founded with",
      factText: "Alpha co-founded with Gamma.", sourceMemory: mem,
      validTo: new Date(NOW.getTime() - 40 * DAY_MS),
    });
    // unresolved (predicate signal): a current dispute.
    await seedFact({
      userId, subjectId: a, objectId: d, predicate: "in a dispute with",
      factText: "Alpha is in a dispute with Delta.", sourceMemory: mem,
    });

    await materializeEntityEdges(userId);
    let edges = await getOneHopEdges(userId, a, 6);
    const byOther = (id: string) =>
      edges.find((e: { otherId: string }) => e.otherId === id);
    expect(byOther(b).status).toBe("active");
    expect(byOther(c).status).toBe("ended");
    expect(byOther(d).status).toBe("unresolved");

    // Flag the Alpha–Delta edge as a bad link → excluded from assembly.
    const deltaEdge = byOther(d);
    const flagged = await flagEntityEdge(userId, deltaEdge.id);
    expect(flagged).not.toBeNull();
    edges = await getOneHopEdges(userId, a, 6);
    expect(edges.find((e: { otherId: string }) => e.otherId === d)).toBeUndefined();

    // The flag SURVIVES a nightly rebuild (materialize preserves it by natural
    // key even though row ids are regenerated).
    await materializeEntityEdges(userId);
    const flaggedRows = await db
      .select({ status: entityEdges.status })
      .from(entityEdges)
      .where(and(eq(entityEdges.userId, userId), eq(entityEdges.status, "flagged")));
    expect(flaggedRows.length).toBe(1);
    // Still excluded from assembly, and derived statuses are reproduced.
    edges = await getOneHopEdges(userId, a, 6);
    expect(edges.find((e: { otherId: string }) => e.otherId === d)).toBeUndefined();
    expect(edges.find((e: { otherId: string }) => e.otherId === b).status).toBe("active");
    expect(edges.find((e: { otherId: string }) => e.otherId === c).status).toBe("ended");
    void openLoops;
  } finally {
    await cleanup(userId);
  }
});

describe("harness", () => {
  test("p3 eval file loads", () => {
    expect(typeof dbTest).toBe("function");
  });
});
