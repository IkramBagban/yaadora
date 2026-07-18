import { test, expect, describe } from "bun:test";
import {
  scoreDossier,
  loopRipeness,
  absenceSummary,
  type RankSignals,
} from "./follow-ups";
import {
  meetsAbsenceFloors,
  ABSENCE_MIN_LIFETIME_MENTIONS,
  ABSENCE_MIN_MONTHS_SILENT,
  ABSENCE_MIN_DROP_RATIO,
  type FollowUpLoopRow,
  type AbsenceCandidateRow,
} from "@repo/db";
import { buildContextPackText, type ContextPackSlots } from "./context-pack";

/**
 * Follow-up threads & absence — the deterministic guarantees (spec 04 §3.8).
 * Per the CI policy (spec 03) a SUPPRESSION regression blocks release, so the
 * floors and "ranks low but not excluded" semantics are the load-bearing cases.
 * These are pure (no DB); the SQL-level dismissal/never-again suppression is
 * covered by the DB-backed eval (eval/follow-ups.eval.test.ts).
 */

const NOW = new Date("2026-07-18T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function loop(over: Partial<FollowUpLoopRow> = {}): FollowUpLoopRow {
  return {
    id: "l1",
    kind: "thread",
    title: "chacha's condition isn't good",
    dueAt: null,
    entityId: null,
    sourceMemory: "m1",
    createdAt: new Date(NOW.getTime() - 4 * DAY_MS),
    lastSurfacedAt: null,
    distance: 0.3,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Ripeness bands (spec 04 §3.3): dated-and-passed always outranks an undated
// thread of equal relevance; both decay as they age.
// ---------------------------------------------------------------------------

describe("loopRipeness", () => {
  test("dated-and-passed sits in the high band [0.6, 1]", () => {
    const freshlyPassed = loopRipeness(
      loop({ dueAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) }),
      NOW,
    );
    expect(freshlyPassed).toBeGreaterThan(0.9);
    expect(freshlyPassed).toBeLessThanOrEqual(1);

    const longPassed = loopRipeness(
      loop({ dueAt: new Date(NOW.getTime() - 13 * DAY_MS) }),
      NOW,
    );
    expect(longPassed).toBeGreaterThanOrEqual(0.6); // never drops below the band
    expect(longPassed).toBeLessThan(freshlyPassed); // but decays with age
  });

  test("undated thread sits in the low band [0.1, 0.55], below any dated one", () => {
    const undated = loopRipeness(loop({ dueAt: null }), NOW);
    expect(undated).toBeLessThanOrEqual(0.55);
    const anyDated = loopRipeness(
      loop({ dueAt: new Date(NOW.getTime() - 13 * DAY_MS) }),
      NOW,
    );
    expect(anyDated).toBeGreaterThan(undated);
  });

  test("undated decays as it ages unraised", () => {
    const young = loopRipeness(
      loop({ dueAt: null, createdAt: new Date(NOW.getTime() - 2 * DAY_MS) }),
      NOW,
    );
    const old = loopRipeness(
      loop({ dueAt: null, createdAt: new Date(NOW.getTime() - 40 * DAY_MS) }),
      NOW,
    );
    expect(old).toBeLessThan(young);
  });
});

// ---------------------------------------------------------------------------
// scoreDossier — first-turn ripeness bias, recently-raised demotion (NOT
// exclusion), absence down-weight (spec 04 §3.3).
// ---------------------------------------------------------------------------

describe("scoreDossier", () => {
  const ripe: RankSignals = {
    ripeness: 1,
    relevance: 0.1,
    recentlyRaised: false,
    isAbsence: false,
  };
  const relevant: RankSignals = {
    ripeness: 0.6,
    relevance: 1,
    recentlyRaised: false,
    isAbsence: false,
  };

  test("first turn: ripeness outranks relevance (the 'how was the exam?' opener)", () => {
    expect(scoreDossier(ripe, true)).toBeGreaterThan(scoreDossier(relevant, true));
  });

  test("mid-conversation: relevance leads (a related turn pulls its thread up)", () => {
    expect(scoreDossier(relevant, false)).toBeGreaterThan(scoreDossier(ripe, false));
  });

  test("recently-raised ranks LOW but is never zeroed (no cadence rule)", () => {
    const base = scoreDossier(ripe, true);
    const demoted = scoreDossier({ ...ripe, recentlyRaised: true }, true);
    expect(demoted).toBeLessThan(base);
    expect(demoted).toBeGreaterThan(0); // still offered — the model judges
  });

  test("absence is down-weighted vs an otherwise-identical thread", () => {
    const thread = scoreDossier({ ...ripe, isAbsence: false }, true);
    const absence = scoreDossier({ ...ripe, isAbsence: true }, true);
    expect(absence).toBeLessThan(thread);
  });
});

// ---------------------------------------------------------------------------
// Absence numeric floors — the boundary trio (spec 04 §3.8). Strict '>' on the
// rate/time floors: a signal exactly at the floor does NOT qualify (silence-
// preferring). Pure predicate = one source of truth shared with the SQL path.
// ---------------------------------------------------------------------------

describe("meetsAbsenceFloors — 10-vs-9, 6-vs-5mo, 90-vs-89%", () => {
  const ok = { lifetimeMentions: 20, monthsSinceLast: 8, dropRatio: 0.95 };

  test("a clearly-absent entity qualifies", () => {
    expect(meetsAbsenceFloors(ok)).toBe(true);
  });

  test("lifetime mentions: 10 qualifies, 9 does not", () => {
    expect(meetsAbsenceFloors({ ...ok, lifetimeMentions: ABSENCE_MIN_LIFETIME_MENTIONS })).toBe(true);
    expect(meetsAbsenceFloors({ ...ok, lifetimeMentions: ABSENCE_MIN_LIFETIME_MENTIONS - 1 })).toBe(false);
  });

  test("months silent: just over 6 qualifies, 5 (and exactly 6) do not", () => {
    expect(meetsAbsenceFloors({ ...ok, monthsSinceLast: ABSENCE_MIN_MONTHS_SILENT + 0.1 })).toBe(true);
    expect(meetsAbsenceFloors({ ...ok, monthsSinceLast: ABSENCE_MIN_MONTHS_SILENT })).toBe(false);
    expect(meetsAbsenceFloors({ ...ok, monthsSinceLast: 5 })).toBe(false);
  });

  test("drop ratio: 0.91 qualifies, exactly 0.90 and 0.89 do not", () => {
    expect(meetsAbsenceFloors({ ...ok, dropRatio: 0.91 })).toBe(true);
    expect(meetsAbsenceFloors({ ...ok, dropRatio: ABSENCE_MIN_DROP_RATIO })).toBe(false);
    expect(meetsAbsenceFloors({ ...ok, dropRatio: 0.89 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// absenceSummary — never a stored template, but a stable, faithful summary line.
// ---------------------------------------------------------------------------

describe("absenceSummary", () => {
  test("formats 'X hasn't come up since <Month Year>'", () => {
    const a: AbsenceCandidateRow = {
      entityId: "e1",
      name: "Ankit",
      type: "person",
      lifetimeMentions: 42,
      lastMentionAt: new Date("2025-11-03T00:00:00.000Z"),
      monthsSinceLast: 8,
      dropRatio: 1,
    };
    expect(absenceSummary(a)).toContain("Ankit hasn't come up since");
    expect(absenceSummary(a)).toContain("2025");
  });
});

// ---------------------------------------------------------------------------
// onYourMind pack rendering + budget invariant (spec 04 §3.4 / §3.8).
// ---------------------------------------------------------------------------

describe("context pack — onYourMind section", () => {
  const base: ContextPackSlots = {
    profile: null,
    weekDigest: null,
    loops: [],
    rules: [],
    nudge: null,
  };

  test("renders history-first guidance + note_surfaced, and the due date for a dated thread", () => {
    const { text } = buildContextPackText({
      ...base,
      onYourMind: [
        {
          kind: "followup",
          id: "l1",
          summary: "the exam",
          receipts: ["m1"],
          dueAt: new Date("2026-07-24T00:00:00.000Z"),
          sinceThen: [],
          raisingHistory: [],
        },
      ],
    });
    expect(text).toContain("the exam");
    expect(text).toContain("was due 2026-07-24");
    expect(text).toContain("never raised before");
    expect(text).toContain("note_surfaced");
    expect(text.toLowerCase()).toContain("check the history first");
  });

  test("shows prior raises with their reactions (the no-cadence-rule signal)", () => {
    const { text } = buildContextPackText({
      ...base,
      onYourMind: [
        {
          kind: "followup",
          id: "l1",
          summary: "chacha's health",
          receipts: ["m1"],
          raisingHistory: [
            { shownAt: new Date("2026-07-16T00:00:00.000Z"), channel: "conversation", reaction: "ignored" },
          ],
        },
      ],
    });
    expect(text).toContain("you've raised this before");
    expect(text).toContain("ignored");
  });

  test("pack budget invariant holds with a full onYourMind section", () => {
    const dossiers = Array.from({ length: 3 }, (_, i) => ({
      kind: "followup" as const,
      id: `l${i}`,
      summary: "x".repeat(400),
      receipts: ["m1", "m2"],
      sinceThen: [{ id: "s1", snippet: "y".repeat(300) }],
      raisingHistory: [],
    }));
    const { text, estimatedTokens } = buildContextPackText({ ...base, onYourMind: dossiers }, 2000);
    expect(estimatedTokens).toBeLessThanOrEqual(2000);
    expect(text.length).toBeLessThanOrEqual(2000 * 4);
  });
});
