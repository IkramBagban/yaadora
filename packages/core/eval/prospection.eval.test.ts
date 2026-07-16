/**
 * P2 prospection + gates evals (spec 03 P2).
 *
 * Deterministic scenarios:
 *  - interview T-3 → candidate produced
 *  - birthday T-1 → candidate produced
 *  - already-known → silence
 *  - dismissed → never again
 *  - mid_task (stack trace) → hold
 *  - budget exhaustion
 *  - quiet hours block push only
 *
 * Requires DATABASE_URL for DB-backed cases. Pure gate cases always run.
 */
import { describe, expect, test } from "bun:test";
import {
  hardBlockMidTask,
  isInQuietHours,
  isPrepTypeTitle,
  localDaysUntil,
  runGates,
  type GateInput,
  type NudgeCandidate,
} from "../proactive/gates";

const hasDb = Boolean(process.env.DATABASE_URL);
const dbTest = hasDb ? test : test.skip;

const NOW = new Date("2026-07-16T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function cand(over: Partial<NudgeCandidate> = {}): NudgeCandidate {
  return {
    kind: "loop_nudge",
    subjectType: "open_loop",
    subjectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    oneLineNudge: "Your interview is in 3 days — want a prep plan?",
    evidence: ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],
    confidence: 0.95,
    ...over,
  };
}

function base(over: Partial<GateInput> = {}): GateInput {
  return {
    candidate: cand(),
    subjectLedger: [],
    alreadyKnown: false,
    seam: "open",
    channel: "conversation",
    conversationNudgeCount: 0,
    dailySurfacingCount: 0,
    maxDailySurfacings: 3,
    inQuietHours: false,
    now: NOW,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Interview T-3 / birthday T-1 classification (pure)
// ---------------------------------------------------------------------------

describe("P2 interview T-3 + birthday windows", () => {
  test("prep-type interview title classifies for T-3", () => {
    expect(
      isPrepTypeTitle("Interview at Acme — JavaScript, backend"),
    ).toBe(true);
    // T-3 from "now"
    const due = new Date(NOW.getTime() + 3 * DAY_MS);
    expect(localDaysUntil(due, NOW, "UTC")).toBe(3);
  });

  test("plain meeting is T-1 not T-3", () => {
    expect(isPrepTypeTitle("Meeting with design team")).toBe(false);
    const due = new Date(NOW.getTime() + 1 * DAY_MS);
    expect(localDaysUntil(due, NOW, "UTC")).toBe(1);
  });

  test("interview at T-3 is approved when gates clear", () => {
    const due = new Date(NOW.getTime() + 3 * DAY_MS);
    expect(localDaysUntil(due, NOW, "UTC")).toBe(3);
    expect(runGates(base())).toEqual({ decision: "approve" });
  });
});

// ---------------------------------------------------------------------------
// Anti-scenarios (pure, assertion-judged)
// ---------------------------------------------------------------------------

describe("P2 anti-scenarios (gates)", () => {
  test("already known → silence", () => {
    expect(runGates(base({ alreadyKnown: true }))).toEqual({
      decision: "suppress",
      reason: "already_known",
    });
  });

  test("dismissed → never again", () => {
    expect(
      runGates(
        base({
          subjectLedger: [
            {
              reaction: "dismissed",
              shownAt: new Date(NOW.getTime() - 200 * DAY_MS),
              evidence: ["old"],
            },
          ],
        }),
      ),
    ).toEqual({ decision: "suppress", reason: "ledger_dismissed" });
  });

  test("mid-task stack trace → hold (not drop)", () => {
    const turn = `TypeError: Cannot read properties of undefined
    at Object.render (/app/src/App.tsx:42:11)
    at finishClassComponent`;
    expect(hardBlockMidTask(turn)).toBe(true);
    expect(runGates(base({ seam: "mid_task" }))).toEqual({
      decision: "hold",
      reason: "mid_task",
    });
  });

  test("budget exhaustion → silence", () => {
    expect(
      runGates(base({ dailySurfacingCount: 3, maxDailySurfacings: 3 })),
    ).toEqual({ decision: "suppress", reason: "budget_daily" });
    expect(
      runGates(base({ conversationNudgeCount: 1 })),
    ).toEqual({ decision: "suppress", reason: "budget_conversation" });
  });

  test("quiet hours block push only", () => {
    // 03:00 UTC = 23:00 America/New_York (EDT)
    const late = new Date("2026-07-16T03:00:00.000Z");
    expect(
      isInQuietHours(late, "America/New_York", "22:00:00", "08:00:00"),
    ).toBe(true);

    expect(
      runGates(
        base({
          channel: "push",
          inQuietHours: true,
          now: late,
        }),
      ),
    ).toEqual({ decision: "suppress", reason: "quiet_hours" });

    expect(
      runGates(
        base({
          channel: "conversation",
          inQuietHours: true,
          now: late,
        }),
      ),
    ).toEqual({ decision: "approve" });
  });
});

// ---------------------------------------------------------------------------
// DB-backed end-to-end: seed interview loop, scan prospection
// ---------------------------------------------------------------------------

dbTest("interview T-3: scanProspectionCandidates yields loop_nudge", async () => {
  const {
    db,
    users,
    memories,
    openLoops,
    eq,
  } = require("@repo/db");
  const { scanProspectionCandidates } = require("../proactive/candidates");

  const suffix = crypto.randomUUID();
  let userId: string | null = null;
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `p2-interview-${suffix}@example.test`,
        timezone: "UTC",
      })
      .returning({ id: users.id });
    userId = user.id;

    const [mem] = await db
      .insert(memories)
      .values({
        userId,
        rawText:
          "I have an interview on the 19th for a JavaScript backend role.",
        source: "manual",
      })
      .returning({ id: memories.id });

    // "now" is 2026-07-16 → T-3 is 2026-07-19
    const dueAt = new Date("2026-07-19T15:00:00.000Z");
    await db.insert(openLoops).values({
      userId,
      kind: "upcoming_event",
      title: "Interview at Acme — JavaScript, backend",
      dueAt,
      status: "open",
      sourceMemory: mem.id,
    });

    const candidates = await scanProspectionCandidates({
      userId,
      now: NOW,
      timezone: "UTC",
    });

    const hit = candidates.find((c: NudgeCandidate) => c.kind === "loop_nudge");
    expect(hit, "T-3 interview candidate").toBeTruthy();
    expect(hit!.evidence).toContain(mem.id);
    expect(hit!.oneLineNudge.toLowerCase()).toMatch(/interview|prep/);
  } finally {
    if (userId) {
      await db.delete(openLoops).where(eq(openLoops.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});

dbTest("birthday T-1: scanProspectionCandidates yields date_nudge", async () => {
  const {
    db,
    users,
    memories,
    entities,
    memoryEntities,
    eq,
  } = require("@repo/db");
  const { scanProspectionCandidates } = require("../proactive/candidates");

  const suffix = crypto.randomUUID();
  let userId: string | null = null;
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `p2-bday-${suffix}@example.test`,
        timezone: "UTC",
      })
      .returning({ id: users.id });
    userId = user.id;

    const [mem] = await db
      .insert(memories)
      .values({
        userId,
        rawText: "Priya's birthday is March 12 — she loves peonies.",
        source: "manual",
      })
      .returning({ id: memories.id });

    // tomorrow from NOW (2026-07-16) = 2026-07-17
    const [ent] = await db
      .insert(entities)
      .values({
        userId,
        type: "person",
        canonicalName: "Priya",
        attributes: { birthday: "1998-07-17" },
      })
      .returning({ id: entities.id });

    await db.insert(memoryEntities).values({
      memoryId: mem.id,
      entityId: ent.id,
    });

    const candidates = await scanProspectionCandidates({
      userId,
      now: NOW,
      timezone: "UTC",
    });

    const hit = candidates.find(
      (c: NudgeCandidate) =>
        c.kind === "date_nudge" && c.subjectId === ent.id,
    );
    expect(hit, "birthday T-1 candidate").toBeTruthy();
    expect(hit!.evidence.length).toBeGreaterThanOrEqual(1);
    expect(hit!.oneLineNudge.toLowerCase()).toMatch(/birthday|priya/);
  } finally {
    if (userId) {
      const mems = await db
        .select({ id: memories.id })
        .from(memories)
        .where(eq(memories.userId, userId));
      for (const m of mems) {
        await db
          .delete(memoryEntities)
          .where(eq(memoryEntities.memoryId, m.id));
      }
      await db.delete(entities).where(eq(entities.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});

dbTest("dismissed subject never surfaces again via evaluateAndRecord", async () => {
  const { db, users, memories, openLoops, surfacings, eq } = require("@repo/db");
  const { evaluateAndRecord } = require("../proactive/candidates");

  const suffix = crypto.randomUUID();
  let userId: string | null = null;
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `p2-dismiss-${suffix}@example.test`,
        timezone: "UTC",
      })
      .returning({ id: users.id });
    userId = user.id;

    const [mem] = await db
      .insert(memories)
      .values({
        userId,
        rawText: "Interview on the 19th for backend.",
        source: "manual",
      })
      .returning({ id: memories.id });

    const [loop] = await db
      .insert(openLoops)
      .values({
        userId,
        kind: "upcoming_event",
        title: "Interview at Acme",
        dueAt: new Date("2026-07-19T15:00:00.000Z"),
        status: "open",
        sourceMemory: mem.id,
      })
      .returning({ id: openLoops.id });

    // Prior dismissed surfacing
    await db.insert(surfacings).values({
      userId,
      kind: "loop_nudge",
      subjectType: "open_loop",
      subjectId: loop.id,
      channel: "conversation",
      evidence: [mem.id],
      reaction: "dismissed",
      reactionAt: new Date(NOW.getTime() - 5 * DAY_MS),
      shownAt: new Date(NOW.getTime() - 5 * DAY_MS),
    });

    const result = await evaluateAndRecord({
      userId,
      candidate: {
        kind: "loop_nudge",
        subjectType: "open_loop",
        subjectId: loop.id,
        oneLineNudge: "Interview is soon — prep?",
        evidence: [mem.id],
        confidence: 0.9,
      },
      seam: "open",
      channel: "conversation",
      now: NOW,
    });

    expect(result.approved).toBe(false);
    expect(result.outcome).toEqual({
      decision: "suppress",
      reason: "ledger_dismissed",
    });
  } finally {
    if (userId) {
      await db.delete(surfacings).where(eq(surfacings.userId, userId));
      await db.delete(openLoops).where(eq(openLoops.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});
