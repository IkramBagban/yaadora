/**
 * Follow-up threads & absence — DB-backed suppression + lifecycle evals
 * (spec 04 §3.8). The pure ranking/floor logic lives in
 * retrieval/follow-ups.test.ts; this file exercises the parts only a real
 * database proves — the SQL suppression clauses, the +2h/+14d boundaries, and
 * end-to-end resolution.
 *
 * Per spec 03's CI asymmetry: a wrongly-raised case is a BLOCKING failure, so
 * the exclusion assertions below are the load-bearing ones. Requires
 * DATABASE_URL; skipped otherwise (copy root .env → packages/core/.env for a
 * local run, then delete it).
 */
import { describe, expect, test } from "bun:test";
import {
  getFollowUpLoopCandidates,
  getAbsenceCandidates,
  expireStaleOpenLoops,
} from "@repo/db";
import { selectFollowUps } from "@repo/core";
import { resolveOpenLoop } from "../ingestion/pipeline";

const hasDb = Boolean(process.env.DATABASE_URL);
const dbTest = hasDb ? test : test.skip;

const NOW = new Date("2026-07-18T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

function unitVec(): number[] {
  const v = new Array(1536).fill(0);
  v[0] = 1;
  return v;
}

async function seedUser(over: Record<string, unknown> = {}): Promise<{ id: string }> {
  const { db, users } = require("@repo/db");
  const [u] = await db
    .insert(users)
    .values({
      email: `fu-${crypto.randomUUID()}@example.test`,
      timezone: "UTC",
      maxDailySurfacings: 3,
      insightsEnabled: true,
      ...over,
    })
    .returning({ id: users.id });
  return u;
}

async function cleanup(userId: string): Promise<void> {
  const { db, users, memories, memoryEntities, entities, openLoops, surfacings, eq } =
    require("@repo/db");
  await db.delete(surfacings).where(eq(surfacings.userId, userId));
  await db.delete(openLoops).where(eq(openLoops.userId, userId));
  const mems = await db
    .select({ id: memories.id })
    .from(memories)
    .where(eq(memories.userId, userId));
  for (const m of mems) {
    await db.delete(memoryEntities).where(eq(memoryEntities.memoryId, m.id));
  }
  await db.delete(entities).where(eq(entities.userId, userId));
  await db.delete(memories).where(eq(memories.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

async function seedMemory(userId: string, text: string): Promise<string> {
  const { db, memories } = require("@repo/db");
  const [m] = await db
    .insert(memories)
    .values({ userId, rawText: text, source: "manual" })
    .returning({ id: memories.id });
  return m.id;
}

// ---------------------------------------------------------------------------
// §3.1 lifecycle — dated check-in at +2h; expiry at +14d unengaged.
// ---------------------------------------------------------------------------

describe("follow-up loop candidates — the +2h check-in window", () => {
  dbTest("a dated loop is NOT a candidate until dueAt + 2h, then IS", async () => {
    const user = await seedUser();
    try {
      const mem = await seedMemory(user.id, "exam on the 18th");
      const { db, openLoops } = require("@repo/db");
      // due 1h ago → still inside grace → not yet a check-in candidate.
      const [tooFresh] = await db
        .insert(openLoops)
        .values({
          userId: user.id,
          kind: "upcoming_event",
          title: "the exam",
          dueAt: new Date(NOW.getTime() - 1 * 60 * 60 * 1000),
          status: "open",
          sourceMemory: mem,
        })
        .returning({ id: openLoops.id });

      let rows = await getFollowUpLoopCandidates({ userId: user.id, now: NOW });
      expect(rows.map((r) => r.id)).not.toContain(tooFresh.id);

      // Move it to 3h ago → now a check-in candidate.
      const { eq } = require("@repo/db");
      await db
        .update(openLoops)
        .set({ dueAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) })
        .where(eq(openLoops.id, tooFresh.id));
      rows = await getFollowUpLoopCandidates({ userId: user.id, now: NOW });
      expect(rows.map((r) => r.id)).toContain(tooFresh.id);
    } finally {
      await cleanup(user.id);
    }
  });
});

describe("expireStaleOpenLoops — dueAt + 14d, never-engaged only", () => {
  dbTest("expires an unengaged loop past +14d; keeps <14d and engaged ones", async () => {
    const user = await seedUser();
    try {
      const mem = await seedMemory(user.id, "some dated thing");
      const { db, openLoops, surfacings, eq } = require("@repo/db");
      const mk = async (dueOffsetDays: number) => {
        const [l] = await db
          .insert(openLoops)
          .values({
            userId: user.id,
            kind: "upcoming_event",
            title: `loop-${dueOffsetDays}`,
            dueAt: new Date(NOW.getTime() - dueOffsetDays * DAY_MS),
            status: "open",
            sourceMemory: mem,
          })
          .returning({ id: openLoops.id });
        return l.id;
      };
      const stale = await mk(15); // past +14d, unengaged → expire
      const recent = await mk(10); // within window → keep
      const staleButEngaged = await mk(20); // past +14d BUT engaged → keep
      await db.insert(surfacings).values({
        userId: user.id,
        kind: "loop_nudge",
        subjectType: "open_loop",
        subjectId: staleButEngaged,
        channel: "conversation",
        evidence: [mem],
        reaction: "engaged",
      });

      const expired = await expireStaleOpenLoops(user.id, NOW);
      expect(expired).toBe(1);

      const statusOf = async (id: string) => {
        const [r] = await db
          .select({ status: openLoops.status })
          .from(openLoops)
          .where(eq(openLoops.id, id));
        return r.status;
      };
      expect(await statusOf(stale)).toBe("expired");
      expect(await statusOf(recent)).toBe("open");
      expect(await statusOf(staleButEngaged)).toBe("open");
    } finally {
      await cleanup(user.id);
    }
  });
});

// ---------------------------------------------------------------------------
// resolvesLoop still closes threads end-to-end (spec 04 §3.1).
// ---------------------------------------------------------------------------

describe("resolveOpenLoop closes a self-scoped thread", () => {
  dbTest("a matching resolvesLoop memory resolves an entity-less thread", async () => {
    const user = await seedUser();
    try {
      const src = await seedMemory(user.id, "exam on the 18th, nervous");
      const closer = await seedMemory(user.id, "exam went well, done with it");
      const { db, openLoops, eq } = require("@repo/db");
      const [loop] = await db
        .insert(openLoops)
        .values({
          userId: user.id,
          kind: "thread",
          title: "the exam",
          dueAt: null,
          status: "open",
          sourceMemory: src,
          embedding: unitVec(),
        })
        .returning({ id: openLoops.id });

      const resolvedId = await resolveOpenLoop({
        userId: user.id,
        memoryId: closer,
        resolvesLoop: "the exam is over, went well",
        resolution: new Map(),
        extractedEntities: [],
        embedding: unitVec(), // distance 0 to the loop → resolves
      });
      expect(resolvedId).toBe(loop.id);

      const [after] = await db
        .select({ status: openLoops.status, resolvedBy: openLoops.resolvedBy })
        .from(openLoops)
        .where(eq(openLoops.id, loop.id));
      expect(after.status).toBe("resolved");
      expect(after.resolvedBy).toBe(closer);

      // A resolved thread is no longer a follow-up candidate.
      const rows = await getFollowUpLoopCandidates({ userId: user.id, now: NOW });
      expect(rows.map((r) => r.id)).not.toContain(loop.id);
    } finally {
      await cleanup(user.id);
    }
  });
});

// ---------------------------------------------------------------------------
// §3.3 selectFollowUps hard filters — dismissal, budget, toggle, caps.
// ---------------------------------------------------------------------------

describe("selectFollowUps hard filters (the 'may NOT be raised' side)", () => {
  dbTest("a dismissed thread NEVER appears again", async () => {
    const user = await seedUser();
    try {
      const mem = await seedMemory(user.id, "chacha in hospital");
      const { db, openLoops, surfacings } = require("@repo/db");
      const [loop] = await db
        .insert(openLoops)
        .values({
          userId: user.id,
          kind: "thread",
          title: "chacha's condition",
          dueAt: null,
          status: "open",
          sourceMemory: mem,
          createdAt: new Date(NOW.getTime() - 4 * DAY_MS),
        })
        .returning({ id: openLoops.id });
      await db.insert(surfacings).values({
        userId: user.id,
        kind: "followup_nudge",
        subjectType: "open_loop",
        subjectId: loop.id,
        channel: "conversation",
        evidence: [mem],
        reaction: "dismissed",
      });

      const dossiers = await selectFollowUps({
        userId: user.id,
        userTurn: "how's it going",
        now: NOW,
      });
      expect(dossiers.map((d) => d.subjectId)).not.toContain(loop.id);
    } finally {
      await cleanup(user.id);
    }
  });

  dbTest("budget spent → empty result", async () => {
    const user = await seedUser({ maxDailySurfacings: 1 });
    try {
      const mem = await seedMemory(user.id, "big pitch coming");
      const { db, openLoops, surfacings } = require("@repo/db");
      await db.insert(openLoops).values({
        userId: user.id,
        kind: "thread",
        title: "the investor pitch",
        dueAt: null,
        status: "open",
        sourceMemory: mem,
        createdAt: new Date(NOW.getTime() - 4 * DAY_MS),
      });
      // One non-suppressed surfacing today already spends the budget of 1.
      await db.insert(surfacings).values({
        userId: user.id,
        kind: "loop_nudge",
        subjectType: "open_loop",
        subjectId: crypto.randomUUID(),
        channel: "conversation",
        evidence: [mem],
        shownAt: NOW,
      });

      const dossiers = await selectFollowUps({
        userId: user.id,
        userTurn: "anything on my mind?",
        now: NOW,
      });
      expect(dossiers).toHaveLength(0);
    } finally {
      await cleanup(user.id);
    }
  });

  dbTest("Insights toggle OFF excludes absence ONLY — threads remain", async () => {
    const user = await seedUser({ insightsEnabled: false });
    try {
      const mem = await seedMemory(user.id, "hard conversation with dad");
      const { db, openLoops, entities, memoryEntities } = require("@repo/db");
      const [loop] = await db
        .insert(openLoops)
        .values({
          userId: user.id,
          kind: "thread",
          title: "the hard conversation",
          dueAt: null,
          status: "open",
          sourceMemory: mem,
          createdAt: new Date(NOW.getTime() - 4 * DAY_MS),
        })
        .returning({ id: openLoops.id });

      // An absence-qualifying entity (12 mentions, all ~2y ago).
      const [ent] = await db
        .insert(entities)
        .values({ userId: user.id, type: "person", canonicalName: "Ankit" })
        .returning({ id: entities.id });
      for (let i = 0; i < 12; i++) {
        const m = await seedMemory(user.id, `hung out with Ankit ${i}`);
        await db
          .update(require("@repo/db").memories)
          .set({ occurredAt: new Date(NOW.getTime() - (24 + i) * MONTH_MS) })
          .where(require("@repo/db").eq(require("@repo/db").memories.id, m));
        await db.insert(memoryEntities).values({ memoryId: m, entityId: ent.id });
      }

      const dossiers = await selectFollowUps({
        userId: user.id,
        userTurn: "hey",
        now: NOW,
        isFirstTurn: true,
      });
      const kinds = dossiers.map((d) => d.kind);
      expect(dossiers.map((d) => d.subjectId)).toContain(loop.id); // thread stays
      expect(kinds).not.toContain("absence"); // absence excluded by toggle
    } finally {
      await cleanup(user.id);
    }
  });

  dbTest("caps at 3 dossiers even with 5 eligible threads", async () => {
    const user = await seedUser();
    try {
      const { db, openLoops } = require("@repo/db");
      for (let i = 0; i < 5; i++) {
        const mem = await seedMemory(user.id, `thread ${i}`);
        await db.insert(openLoops).values({
          userId: user.id,
          kind: "thread",
          title: `thread ${i}`,
          dueAt: null,
          status: "open",
          sourceMemory: mem,
          createdAt: new Date(NOW.getTime() - 4 * DAY_MS),
        });
      }
      const dossiers = await selectFollowUps({
        userId: user.id,
        userTurn: "what's up",
        now: NOW,
      });
      expect(dossiers.length).toBeLessThanOrEqual(3);
    } finally {
      await cleanup(user.id);
    }
  });
});

// ---------------------------------------------------------------------------
// §3.6 absence — floors end-to-end + raised-and-not-engaged-never-again.
// ---------------------------------------------------------------------------

describe("getAbsenceCandidates — floors + never-again", () => {
  async function seedAbsentEntity(
    userId: string,
    name: string,
    count: number,
    monthsAgo: number,
  ): Promise<string> {
    const { db, entities, memoryEntities, memories, eq } = require("@repo/db");
    const [ent] = await db
      .insert(entities)
      .values({ userId, type: "person", canonicalName: name })
      .returning({ id: entities.id });
    for (let i = 0; i < count; i++) {
      const m = await seedMemory(userId, `${name} memory ${i}`);
      await db
        .update(memories)
        .set({ occurredAt: new Date(NOW.getTime() - (monthsAgo + i) * MONTH_MS) })
        .where(eq(memories.id, m));
      await db.insert(memoryEntities).values({ memoryId: m, entityId: ent.id });
    }
    return ent.id;
  }

  dbTest("10 lifetime mentions qualifies; 9 does not", async () => {
    const user = await seedUser();
    try {
      const ten = await seedAbsentEntity(user.id, "TenPerson", 10, 24);
      const nine = await seedAbsentEntity(user.id, "NinePerson", 9, 24);
      const rows = await getAbsenceCandidates({ userId: user.id, now: NOW });
      const ids = rows.map((r) => r.entityId);
      expect(ids).toContain(ten);
      expect(ids).not.toContain(nine);
    } finally {
      await cleanup(user.id);
    }
  });

  dbTest("raised-and-not-engaged never re-enters; a later mention resets it", async () => {
    const user = await seedUser();
    try {
      const ent = await seedAbsentEntity(user.id, "Ankit", 12, 24);
      const { db, surfacings, memoryEntities, memories, eq } = require("@repo/db");
      // Absence raised 14 months ago, never engaged, no later mention → gone.
      await db.insert(surfacings).values({
        userId: user.id,
        kind: "absence_nudge",
        subjectType: "entity",
        subjectId: ent,
        channel: "conversation",
        evidence: [],
        shownAt: new Date(NOW.getTime() - 14 * MONTH_MS),
      });
      let rows = await getAbsenceCandidates({ userId: user.id, now: NOW });
      expect(rows.map((r) => r.entityId)).not.toContain(ent);

      // A re-mention AFTER the raise (8 months ago) but still >6mo quiet since →
      // the never-again suppression lifts and it can re-enter.
      const m = await seedMemory(user.id, "ran into Ankit again");
      await db
        .update(memories)
        .set({ occurredAt: new Date(NOW.getTime() - 8 * MONTH_MS) })
        .where(eq(memories.id, m));
      await db.insert(memoryEntities).values({ memoryId: m, entityId: ent });

      rows = await getAbsenceCandidates({ userId: user.id, now: NOW });
      expect(rows.map((r) => r.entityId)).toContain(ent);
    } finally {
      await cleanup(user.id);
    }
  });

  dbTest("an entity mentioned this week is NOT absent (recent conversation guard)", async () => {
    const user = await seedUser();
    try {
      const ent = await seedAbsentEntity(user.id, "Recent", 12, 24);
      const { db, memoryEntities, memories, eq } = require("@repo/db");
      // One fresh mention → recent_count > 0 and lastMention recent → not absent.
      const m = await seedMemory(user.id, "talked to Recent yesterday");
      await db
        .update(memories)
        .set({ occurredAt: new Date(NOW.getTime() - 1 * DAY_MS) })
        .where(eq(memories.id, m));
      await db.insert(memoryEntities).values({ memoryId: m, entityId: ent });

      const rows = await getAbsenceCandidates({ userId: user.id, now: NOW });
      expect(rows.map((r) => r.entityId)).not.toContain(ent);
    } finally {
      await cleanup(user.id);
    }
  });
});
