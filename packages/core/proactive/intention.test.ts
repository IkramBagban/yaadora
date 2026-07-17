/**
 * Held-intentions (P4) tests — spec 03 P4 acceptance.
 *
 * Two layers, matching the eval-suite policy (spec 03 "the eval suite"):
 *  1. Pure, always-run: the QUESTION-framing directive (framing is the feature)
 *     and the proximity/resolution constants. Suppression assertions are hard.
 *  2. DB-gated golden scenario (skips without DATABASE_URL) — the January
 *     commitment vs. July offer, deterministic and LLM-free: it exercises the
 *     proximity query, the gate enablement, fires-once budgeting, the Insights
 *     toggle suppression, and conversational resolution → never fires again.
 *
 * The LLM tension-confirm + the model's own weaving are covered separately as a
 * live integration check (see the runbook); here we pin the deterministic
 * contract around them so a suppression regression is caught in CI.
 */
import { describe, expect, test } from "bun:test";
import { buildContextPackText } from "../retrieval/context-pack";
import { COMMITMENT_PROXIMITY_MAX_DISTANCE } from "./intention";
import { COMMITMENT_RESOLUTION_MAX_DISTANCE } from "../ingestion/pipeline";

const hasDb = Boolean(process.env.DATABASE_URL);
const dbTest = hasDb ? test : test.skip;

const NOW = new Date("2026-07-17T12:00:00.000Z");

// ---------------------------------------------------------------------------
// FRAMING IS THE FEATURE (pure) — the woven directive must force a question,
// acknowledge a possible deliberate update, and forbid judgment.
// ---------------------------------------------------------------------------

describe("intention_nudge weaving directive (spec 03 P4)", () => {
  const janQuestion =
    "Back in January you said you were done with consulting — has that changed, or is this a runway thing?";

  function packWith(kind: string): string {
    return buildContextPackText({
      profile: null,
      weekDigest: null,
      loops: [],
      rules: [],
      nudge: { text: janQuestion, evidence: ["jan-memory-id"], kind },
    }).text;
  }

  test("intention directive frames as a QUESTION, never a judgment", () => {
    const text = packWith("intention_nudge");
    expect(text).toContain(janQuestion);
    expect(text.toLowerCase()).toContain("only as an open question");
    // Explicitly instructs the agent it may be a deliberate update…
    expect(text.toLowerCase()).toContain("deliberate");
    // …and forbids scolding / assuming drift.
    expect(text.toLowerCase()).toContain("do not scold");
    expect(text.toLowerCase()).toContain("drifted");
    // The receipt rides along for the tappable source.
    expect(text).toContain("jan-memory-id");
  });

  test("a lookup-grade nudge does NOT get the intention framing", () => {
    const text = packWith("loop_nudge");
    expect(text.toLowerCase()).not.toContain("only as an open question");
    expect(text.toLowerCase()).not.toContain("do not scold");
  });
});

describe("held-intention constants are conservative", () => {
  test("proximity prefilter is a loose topic filter; resolution is tighter", () => {
    // Prefilter is generous (LLM confirm is the precision gate); the
    // conversational-resolution threshold is tighter than the prefilter.
    expect(COMMITMENT_PROXIMITY_MAX_DISTANCE).toBeGreaterThan(
      COMMITMENT_RESOLUTION_MAX_DISTANCE,
    );
    expect(COMMITMENT_RESOLUTION_MAX_DISTANCE).toBeLessThanOrEqual(0.35);
  });
});

// ---------------------------------------------------------------------------
// DB-gated golden scenario (LLM-free, deterministic).
// ---------------------------------------------------------------------------

/** A 1536-d unit vector with a single hot dimension. distance(v(i),v(i))=0,
 * distance(v(i),v(j≠i))=1 under pgvector cosine. */
function vec(hot: number): number[] {
  const a = new Array(1536).fill(0);
  a[hot] = 1;
  return a;
}

dbTest(
  "golden: Jan commitment vs Jul offer fires once, then resolves and never fires again",
  async () => {
    const { db, users, memories, openLoops, surfacings, eq, findCommitmentLoopCandidates } =
      require("@repo/db");
    const { evaluateAndRecord } = require("./candidates");
    const { resolveOpenLoop } = require("../ingestion/pipeline");

    const suffix = crypto.randomUUID();
    let userId: string | null = null;
    try {
      const [user] = await db
        .insert(users)
        .values({ email: `p4-${suffix}@example.test`, timezone: "UTC" })
        .returning({ id: users.id });
      userId = user.id;

      // January: the commitment memory + its open commitment loop (self-scoped,
      // no entity). The loop embedding stands in for "done with consulting".
      const [janMem] = await db
        .insert(memories)
        .values({
          userId,
          rawText:
            "I'm done with consulting — going full-time on the product from now on.",
          source: "manual",
        })
        .returning({ id: memories.id });

      const commitmentVec = vec(7);
      const [loop] = await db
        .insert(openLoops)
        .values({
          userId,
          kind: "commitment",
          title: "User committed to being done with consulting, full-time on product",
          status: "open",
          sourceMemory: janMem.id,
          embedding: commitmentVec,
        })
        .returning({ id: openLoops.id });

      // 1) PROXIMITY: the July turn ("this consulting client offered 3 months")
      // lands near the commitment. Modelled as the same hot dimension.
      const near = await findCommitmentLoopCandidates(
        userId,
        commitmentVec,
        COMMITMENT_PROXIMITY_MAX_DISTANCE,
      );
      expect(near.map((c: { id: string }) => c.id)).toContain(loop.id);
      expect(near[0].sourceMemory).toBe(janMem.id);

      // 2) FIRES ONCE: the confirmed intention candidate clears the gates and
      // writes a pending ledger row citing the January memory.
      const candidate = {
        kind: "intention_nudge",
        subjectType: "open_loop",
        subjectId: loop.id,
        oneLineNudge:
          "Back in January you said you were done with consulting — has that changed, or is this a runway thing?",
        evidence: [janMem.id],
        confidence: 0.8,
      };
      const conversationId = null;
      const first = await evaluateAndRecord({
        userId,
        conversationId,
        candidate,
        seam: "open",
        channel: "conversation",
        now: NOW,
      });
      expect(first.approved).toBe(true);
      expect(first.surfacingId).toBeTruthy();

      const [row] = await db
        .select({ evidence: surfacings.evidence, kind: surfacings.kind })
        .from(surfacings)
        .where(eq(surfacings.id, first.surfacingId));
      expect(row.kind).toBe("intention_nudge");
      expect(row.evidence).toContain(janMem.id); // receipt present

      // 3) CONVERSATIONAL RESOLUTION: the user's "it's a deliberate call" reply,
      // captured as a memory with resolvesLoop set, closes the commitment via
      // the reused resolveOpenLoop path — no entity link required.
      const [replyMem] = await db
        .insert(memories)
        .values({
          userId,
          rawText:
            "The user made a deliberate decision to take the 3-month consulting client, changing the earlier plan to go full-time on product.",
          source: "conversation",
        })
        .returning({ id: memories.id });

      const resolvedId = await resolveOpenLoop({
        userId,
        memoryId: replyMem.id,
        resolvesLoop:
          "the earlier commitment to be done with consulting and go full-time on product",
        resolution: new Map<string, string>(),
        extractedEntities: [],
        embedding: commitmentVec, // deliberate-change statement ≈ the commitment
      });
      expect(resolvedId).toBe(loop.id);

      const [after] = await db
        .select({ status: openLoops.status, resolvedBy: openLoops.resolvedBy })
        .from(openLoops)
        .where(eq(openLoops.id, loop.id));
      expect(after.status).toBe("resolved");
      expect(after.resolvedBy).toBe(replyMem.id);

      // 4) NEVER AGAIN: a resolved commitment is no longer an open candidate, so
      // the proximity query can never surface it.
      const afterNear = await findCommitmentLoopCandidates(
        userId,
        commitmentVec,
        COMMITMENT_PROXIMITY_MAX_DISTANCE,
      );
      expect(afterNear.map((c: { id: string }) => c.id)).not.toContain(loop.id);
    } finally {
      if (userId) {
        const { db, users, memories, openLoops, surfacings, eq } = require("@repo/db");
        await db.delete(surfacings).where(eq(surfacings.userId, userId));
        await db.delete(openLoops).where(eq(openLoops.userId, userId));
        await db.delete(memories).where(eq(memories.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
    }
  },
);

dbTest(
  "anti: an unrelated consulting mention (far embedding) yields NO candidate → silence",
  async () => {
    const { db, users, memories, openLoops, eq, findCommitmentLoopCandidates } =
      require("@repo/db");

    const suffix = crypto.randomUUID();
    let userId: string | null = null;
    try {
      const [user] = await db
        .insert(users)
        .values({ email: `p4-anti-${suffix}@example.test`, timezone: "UTC" })
        .returning({ id: users.id });
      userId = user.id;

      const [mem] = await db
        .insert(memories)
        .values({ userId, rawText: "done with consulting", source: "manual" })
        .returning({ id: memories.id });

      await db.insert(openLoops).values({
        userId,
        kind: "commitment",
        title: "User committed to being done with consulting",
        status: "open",
        sourceMemory: mem.id,
        embedding: vec(7),
      });

      // A turn about something else entirely (orthogonal embedding, distance 1.0).
      const far = await findCommitmentLoopCandidates(
        userId,
        vec(42),
        COMMITMENT_PROXIMITY_MAX_DISTANCE,
      );
      expect(far).toHaveLength(0);
    } finally {
      if (userId) {
        await db.delete(openLoops).where(eq(openLoops.userId, userId));
        await db.delete(memories).where(eq(memories.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
    }
  },
);

dbTest(
  "anti: Insights toggle OFF suppresses the intention nudge at the gate (insights_disabled)",
  async () => {
    const { db, users, memories, openLoops, surfacings, eq } = require("@repo/db");
    const { evaluateAndRecord } = require("./candidates");

    const suffix = crypto.randomUUID();
    let userId: string | null = null;
    try {
      const [user] = await db
        .insert(users)
        .values({
          email: `p4-off-${suffix}@example.test`,
          timezone: "UTC",
          insightsEnabled: false, // Insights OFF
        })
        .returning({ id: users.id });
      userId = user.id;

      const [mem] = await db
        .insert(memories)
        .values({ userId, rawText: "done with consulting", source: "manual" })
        .returning({ id: memories.id });

      const [loop] = await db
        .insert(openLoops)
        .values({
          userId,
          kind: "commitment",
          title: "User committed to being done with consulting",
          status: "open",
          sourceMemory: mem.id,
          embedding: vec(7),
        })
        .returning({ id: openLoops.id });

      const result = await evaluateAndRecord({
        userId,
        conversationId: null,
        candidate: {
          kind: "intention_nudge",
          subjectType: "open_loop",
          subjectId: loop.id,
          oneLineNudge: "Back in January you said you were done with consulting — has that changed?",
          evidence: [mem.id],
          confidence: 0.9,
        },
        seam: "open",
        channel: "conversation",
        now: NOW,
      });

      // HARD suppression assertion (CI-blocking per spec 03 eval-suite policy).
      expect(result.approved).toBe(false);
      expect(result.outcome).toEqual({
        decision: "suppress",
        reason: "insights_disabled",
      });

      // A lookup-grade nudge on the SAME user (insights off) must still surface —
      // the toggle governs inference-grade only.
      const lookup = await evaluateAndRecord({
        userId,
        conversationId: null,
        candidate: {
          kind: "loop_nudge",
          subjectType: "open_loop",
          subjectId: loop.id,
          oneLineNudge: "Heads up on that thread.",
          evidence: [mem.id],
          confidence: 0.9,
        },
        seam: "open",
        channel: "conversation",
        now: NOW,
      });
      expect(lookup.approved).toBe(true);
    } finally {
      if (userId) {
        await db.delete(surfacings).where(eq(surfacings.userId, userId));
        await db.delete(openLoops).where(eq(openLoops.userId, userId));
        await db.delete(memories).where(eq(memories.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
    }
  },
);
