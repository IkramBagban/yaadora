/**
 * P5 pattern surfacing — DB-backed suppression evals (spec 03 P5).
 *
 * The pure threshold logic (≥5 receipts, ≥0.8 confidence, relevance) is covered
 * in retrieval/observations.test.ts. This file exercises the parts that only a
 * real database can prove — the `NOT EXISTS` suppression clause in
 * getSurfaceablePatternInsights:
 *   - a DISMISSED pattern never surfaces again (spec 01 D5 / P2 gate 1)
 *   - a pattern surfaced within the recent window is not repeated
 *   - an eligible, relevant, well-supported pattern DOES surface
 *   - the 5-vs-4 receipt golden holds end-to-end
 *
 * Requires DATABASE_URL; skipped otherwise.
 */
import { describe, expect, test } from "bun:test";
import { getSurfaceablePatternInsights } from "@repo/db";
import {
  pickBestObservation,
  PATTERN_MIN_CONFIDENCE,
  PATTERN_RECENT_DAYS,
} from "@repo/core";

const hasDb = Boolean(process.env.DATABASE_URL);
const dbTest = hasDb ? test : test.skip;

/** A deterministic unit vector so cosine distance to an identical query is ~0. */
function unitVec(): number[] {
  const v = new Array(1536).fill(0);
  v[0] = 1;
  return v;
}

/** Insert a consolidation pattern fact with N receipts. Returns its id. */
async function seedPattern(params: {
  db: any;
  facts: any;
  userId: string;
  sourceMemory: string;
  receiptIds: string[];
  confidence: number;
  factText?: string;
}): Promise<string> {
  const { db, facts, userId, sourceMemory, receiptIds, confidence } = params;
  const [row] = await db
    .insert(facts)
    .values({
      userId,
      subjectId: null,
      predicate: "pattern",
      objectText: `supported_by: ${receiptIds.join(", ")}`,
      factText: params.factText ?? "Your last projects go quiet around week three.",
      embedding: unitVec(),
      validFrom: new Date(),
      factType: "reflection",
      origin: "consolidation",
      confidence,
      sourceMemory,
    })
    .returning({ id: facts.id });
  return row.id;
}

describe("P5 surfaceable-pattern query — suppression is code+state", () => {
  dbTest("dismissed → never surfaces; recent → suppressed; eligible → surfaces", async () => {
    const { db, users, memories, facts, surfacings, eq } = require("@repo/db");
    const suffix = crypto.randomUUID();
    let userId: string | null = null;
    try {
      const [user] = await db
        .insert(users)
        .values({ email: `p5-${suffix}@example.test`, timezone: "UTC" })
        .returning({ id: users.id });
      userId = user.id;

      // Six memories to serve as receipts.
      const mems: string[] = [];
      for (let i = 0; i < 6; i++) {
        const [m] = await db
          .insert(memories)
          .values({ userId, rawText: `project ${i} update`, source: "manual" })
          .returning({ id: memories.id });
        mems.push(m.id);
      }

      // Three eligible patterns (5 receipts, conf 0.85). We'll dismiss one,
      // recently-surface another, and leave the third clean.
      const dismissedId = await seedPattern({
        db, facts, userId, sourceMemory: mems[0], receiptIds: mems.slice(0, 5),
        confidence: 0.85, factText: "Dismissed pattern.",
      });
      const recentId = await seedPattern({
        db, facts, userId, sourceMemory: mems[0], receiptIds: mems.slice(0, 5),
        confidence: 0.85, factText: "Recently surfaced pattern.",
      });
      const cleanId = await seedPattern({
        db, facts, userId, sourceMemory: mems[0], receiptIds: mems.slice(0, 5),
        confidence: 0.85, factText: "Clean eligible pattern.",
      });

      // Dismissed ledger row for the first.
      await db.insert(surfacings).values({
        userId, kind: "pattern_nudge", subjectType: "pattern_fact",
        subjectId: dismissedId, channel: "conversation", evidence: [mems[0]],
        reaction: "dismissed",
      });
      // A recent (pending) surfacing for the second — shown just now.
      await db.insert(surfacings).values({
        userId, kind: "pattern_nudge", subjectType: "pattern_fact",
        subjectId: recentId, channel: "conversation", evidence: [mems[0]],
      });

      const rows = await getSurfaceablePatternInsights({
        userId,
        turnEmbedding: unitVec(),
        minConfidence: PATTERN_MIN_CONFIDENCE,
        recentDays: PATTERN_RECENT_DAYS,
      });
      const ids = rows.map((r) => r.id);

      expect(ids).not.toContain(dismissedId); // dismissed → gone forever
      expect(ids).not.toContain(recentId); // surfaced recently → suppressed
      expect(ids).toContain(cleanId); // eligible → available

      const picked = pickBestObservation(rows);
      expect(picked).not.toBeNull();
      expect(picked!.id).toBe(cleanId);
      expect(picked!.receipts).toHaveLength(5);
    } finally {
      if (userId) {
        await db.delete(surfacings).where(eq(surfacings.userId, userId));
        await db.delete(facts).where(eq(facts.userId, userId));
        await db.delete(memories).where(eq(memories.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
    }
  });

  dbTest("5-receipt golden surfaces; 4-receipt sibling stays silent", async () => {
    const { db, users, memories, facts, surfacings, eq } = require("@repo/db");
    const suffix = crypto.randomUUID();
    let userId: string | null = null;
    try {
      const [user] = await db
        .insert(users)
        .values({ email: `p5g-${suffix}@example.test`, timezone: "UTC" })
        .returning({ id: users.id });
      userId = user.id;

      const mems: string[] = [];
      for (let i = 0; i < 5; i++) {
        const [m] = await db
          .insert(memories)
          .values({ userId, rawText: `project ${i}`, source: "manual" })
          .returning({ id: memories.id });
        mems.push(m.id);
      }

      const fiveId = await seedPattern({
        db, facts, userId, sourceMemory: mems[0], receiptIds: mems.slice(0, 5),
        confidence: 0.9, factText: "Five projects went quiet at week three.",
      });
      await seedPattern({
        db, facts, userId, sourceMemory: mems[0], receiptIds: mems.slice(0, 4),
        confidence: 0.9, factText: "Only four projects — too thin.",
      });

      const rows = await getSurfaceablePatternInsights({
        userId, turnEmbedding: unitVec(),
        minConfidence: PATTERN_MIN_CONFIDENCE, recentDays: PATTERN_RECENT_DAYS,
      });
      const picked = pickBestObservation(rows);
      expect(picked).not.toBeNull();
      expect(picked!.id).toBe(fiveId); // the 4-receipt one is filtered out
      expect(picked!.receipts).toHaveLength(5);
    } finally {
      if (userId) {
        await db.delete(surfacings).where(eq(surfacings.userId, userId));
        await db.delete(facts).where(eq(facts.userId, userId));
        await db.delete(memories).where(eq(memories.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
    }
  });
});
