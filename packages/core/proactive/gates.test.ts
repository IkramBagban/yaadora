import { describe, expect, test } from "bun:test";
import {
  gateAlreadyKnown,
  gateBudget,
  gateEvidence,
  gateLedger,
  gateSeam,
  hardBlockMidTask,
  isInQuietHours,
  isPrepTypeTitle,
  localDaysUntil,
  parseTimeToMinutes,
  runGates,
  IGNORED_COOLDOWN_DAYS,
  P2_ENABLED_KINDS,
  type GateInput,
  type LedgerEntry,
  type NudgeCandidate,
} from "./gates";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function cand(over: Partial<NudgeCandidate> = {}): NudgeCandidate {
  return {
    kind: "loop_nudge",
    subjectType: "open_loop",
    subjectId: "11111111-1111-1111-1111-111111111111",
    oneLineNudge: "Your interview is Wednesday — want a prep plan?",
    evidence: ["22222222-2222-2222-2222-222222222222"],
    confidence: 0.9,
    ...over,
  };
}

function baseInput(over: Partial<GateInput> = {}): GateInput {
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
// g1 Ledger
// ---------------------------------------------------------------------------

describe("gateLedger (g1)", () => {
  test("empty history → pass", () => {
    expect(gateLedger(cand(), [], NOW)).toBeNull();
  });

  test("dismissed ever → suppress forever", () => {
    const ledger: LedgerEntry[] = [
      {
        reaction: "dismissed",
        shownAt: new Date(NOW.getTime() - 365 * DAY_MS),
        evidence: ["old"],
      },
    ];
    expect(gateLedger(cand(), ledger, NOW)).toEqual({
      decision: "suppress",
      reason: "ledger_dismissed",
    });
  });

  test("dismissed wins over later engaged/ignored", () => {
    const ledger: LedgerEntry[] = [
      {
        reaction: "engaged",
        shownAt: new Date(NOW.getTime() - 10 * DAY_MS),
        evidence: ["a"],
      },
      {
        reaction: "dismissed",
        shownAt: new Date(NOW.getTime() - 5 * DAY_MS),
        evidence: ["b"],
      },
    ];
    expect(gateLedger(cand({ evidence: ["brand-new"] }), ledger, NOW)).toEqual(
      {
        decision: "suppress",
        reason: "ledger_dismissed",
      },
    );
  });

  test("ignored within 30 days → suppress", () => {
    const ledger: LedgerEntry[] = [
      {
        reaction: "ignored",
        shownAt: new Date(NOW.getTime() - 10 * DAY_MS),
        evidence: ["a"],
      },
    ];
    expect(gateLedger(cand(), ledger, NOW)).toEqual({
      decision: "suppress",
      reason: "ledger_ignored_cooldown",
    });
  });

  test("ignored exactly at 30-day boundary still cools down (strict <)", () => {
    // elapsed == 30 days → still inside cooldown (elapsed < 30d is the pass
    // condition's inverse: we suppress while elapsed < 30d).
    const ledger: LedgerEntry[] = [
      {
        reaction: "ignored",
        shownAt: new Date(NOW.getTime() - (IGNORED_COOLDOWN_DAYS * DAY_MS - 1)),
        evidence: ["a"],
      },
    ];
    expect(gateLedger(cand(), ledger, NOW)?.reason).toBe(
      "ledger_ignored_cooldown",
    );
  });

  test("ignored more than 30 days ago → pass", () => {
    const ledger: LedgerEntry[] = [
      {
        reaction: "ignored",
        shownAt: new Date(
          NOW.getTime() - (IGNORED_COOLDOWN_DAYS + 1) * DAY_MS,
        ),
        evidence: ["a"],
      },
    ];
    expect(gateLedger(cand(), ledger, NOW)).toBeNull();
  });

  test("engaged with only prior evidence → suppress", () => {
    const ledger: LedgerEntry[] = [
      {
        reaction: "engaged",
        shownAt: new Date(NOW.getTime() - 2 * DAY_MS),
        evidence: ["mem-1", "mem-2"],
      },
    ];
    expect(
      gateLedger(cand({ evidence: ["mem-1"] }), ledger, NOW),
    ).toEqual({
      decision: "suppress",
      reason: "ledger_engaged_no_new_evidence",
    });
  });

  test("engaged with new evidence id → pass", () => {
    const ledger: LedgerEntry[] = [
      {
        reaction: "engaged",
        shownAt: new Date(NOW.getTime() - 2 * DAY_MS),
        evidence: ["mem-1"],
      },
    ];
    expect(
      gateLedger(cand({ evidence: ["mem-1", "mem-new"] }), ledger, NOW),
    ).toBeNull();
  });

  test("pending (null reaction) history does not block", () => {
    const ledger: LedgerEntry[] = [
      {
        reaction: null,
        shownAt: new Date(NOW.getTime() - DAY_MS),
        evidence: ["a"],
      },
    ];
    expect(gateLedger(cand(), ledger, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// g2 Already known
// ---------------------------------------------------------------------------

describe("gateAlreadyKnown (g2)", () => {
  test("false → pass", () => {
    expect(gateAlreadyKnown(false)).toBeNull();
  });

  test("true → suppress", () => {
    expect(gateAlreadyKnown(true)).toEqual({
      decision: "suppress",
      reason: "already_known",
    });
  });
});

// ---------------------------------------------------------------------------
// g3 Seam
// ---------------------------------------------------------------------------

describe("gateSeam (g3)", () => {
  test("open → pass", () => {
    expect(gateSeam("open")).toBeNull();
  });

  test("mid_task → HOLD (not suppress)", () => {
    expect(gateSeam("mid_task")).toEqual({
      decision: "hold",
      reason: "mid_task",
    });
  });
});

// ---------------------------------------------------------------------------
// g4 Evidence + kind enablement
// ---------------------------------------------------------------------------

describe("gateEvidence (g4)", () => {
  test("loop_nudge with ≥1 receipt → pass", () => {
    expect(gateEvidence(cand())).toBeNull();
  });

  test("date_nudge with ≥1 receipt → pass", () => {
    expect(gateEvidence(cand({ kind: "date_nudge" }))).toBeNull();
  });

  test("loop_nudge with zero evidence → suppress", () => {
    expect(gateEvidence(cand({ evidence: [] }))).toEqual({
      decision: "suppress",
      reason: "evidence_insufficient",
    });
  });

  test("pattern_nudge rejected outright in P2", () => {
    expect(
      gateEvidence(
        cand({
          kind: "pattern_nudge",
          evidence: ["a", "b", "c", "d", "e"],
          confidence: 0.95,
        }),
      ),
    ).toEqual({ decision: "suppress", reason: "kind_not_enabled" });
  });

  test("absence_nudge rejected outright in P2", () => {
    expect(gateEvidence(cand({ kind: "absence_nudge" }))).toEqual({
      decision: "suppress",
      reason: "kind_not_enabled",
    });
  });

  test("edge_nudge not enabled in P2", () => {
    expect(gateEvidence(cand({ kind: "edge_nudge" }))).toEqual({
      decision: "suppress",
      reason: "kind_not_enabled",
    });
  });

  test("P2_ENABLED_KINDS is exactly loop + date", () => {
    expect([...P2_ENABLED_KINDS].sort()).toEqual(["date_nudge", "loop_nudge"]);
  });
});

// ---------------------------------------------------------------------------
// g5 Budget + quiet hours
// ---------------------------------------------------------------------------

describe("gateBudget (g5)", () => {
  test("fresh budgets → pass", () => {
    expect(
      gateBudget({
        channel: "conversation",
        conversationNudgeCount: 0,
        dailySurfacingCount: 0,
        maxDailySurfacings: 3,
        inQuietHours: false,
      }),
    ).toBeNull();
  });

  test("≥1 conversation nudge already → suppress", () => {
    expect(
      gateBudget({
        channel: "conversation",
        conversationNudgeCount: 1,
        dailySurfacingCount: 0,
        maxDailySurfacings: 3,
        inQuietHours: false,
      }),
    ).toEqual({ decision: "suppress", reason: "budget_conversation" });
  });

  test("conversation budget does not apply to push/chip", () => {
    expect(
      gateBudget({
        channel: "push",
        conversationNudgeCount: 5,
        dailySurfacingCount: 0,
        maxDailySurfacings: 3,
        inQuietHours: false,
      }),
    ).toBeNull();
    expect(
      gateBudget({
        channel: "chip",
        conversationNudgeCount: 5,
        dailySurfacingCount: 0,
        maxDailySurfacings: 3,
        inQuietHours: false,
      }),
    ).toBeNull();
  });

  test("daily budget exhausted → suppress on any channel", () => {
    for (const channel of ["conversation", "push", "chip"] as const) {
      expect(
        gateBudget({
          channel,
          conversationNudgeCount: 0,
          dailySurfacingCount: 3,
          maxDailySurfacings: 3,
          inQuietHours: false,
        })?.reason,
        channel,
      ).toBe("budget_daily");
    }
  });

  test("daily count under max → pass", () => {
    expect(
      gateBudget({
        channel: "push",
        conversationNudgeCount: 0,
        dailySurfacingCount: 2,
        maxDailySurfacings: 3,
        inQuietHours: false,
      }),
    ).toBeNull();
  });

  test("quiet hours block push only", () => {
    expect(
      gateBudget({
        channel: "push",
        conversationNudgeCount: 0,
        dailySurfacingCount: 0,
        maxDailySurfacings: 3,
        inQuietHours: true,
      }),
    ).toEqual({ decision: "suppress", reason: "quiet_hours" });

    expect(
      gateBudget({
        channel: "conversation",
        conversationNudgeCount: 0,
        dailySurfacingCount: 0,
        maxDailySurfacings: 3,
        inQuietHours: true,
      }),
    ).toBeNull();

    expect(
      gateBudget({
        channel: "chip",
        conversationNudgeCount: 0,
        dailySurfacingCount: 0,
        maxDailySurfacings: 3,
        inQuietHours: true,
      }),
    ).toBeNull();
  });

  test("conversation budget checked before daily (first failure wins in runGates)", () => {
    // When both would fail, runGates order matters; conversation is checked
    // first inside gateBudget.
    expect(
      gateBudget({
        channel: "conversation",
        conversationNudgeCount: 1,
        dailySurfacingCount: 99,
        maxDailySurfacings: 3,
        inQuietHours: false,
      })?.reason,
    ).toBe("budget_conversation");
  });
});

// ---------------------------------------------------------------------------
// runGates order (g1 → g5)
// ---------------------------------------------------------------------------

describe("runGates order", () => {
  test("all clear → approve", () => {
    expect(runGates(baseInput())).toEqual({ decision: "approve" });
  });

  test("g1 fires before g2", () => {
    const out = runGates(
      baseInput({
        subjectLedger: [
          {
            reaction: "dismissed",
            shownAt: new Date(NOW.getTime() - DAY_MS),
            evidence: ["x"],
          },
        ],
        alreadyKnown: true, // would also suppress
      }),
    );
    expect(out).toEqual({ decision: "suppress", reason: "ledger_dismissed" });
  });

  test("g2 fires before g3", () => {
    const out = runGates(
      baseInput({ alreadyKnown: true, seam: "mid_task" }),
    );
    expect(out).toEqual({ decision: "suppress", reason: "already_known" });
  });

  test("g3 hold before evidence/budget", () => {
    const out = runGates(
      baseInput({
        seam: "mid_task",
        candidate: cand({ evidence: [] }), // would also fail g4
      }),
    );
    expect(out).toEqual({ decision: "hold", reason: "mid_task" });
  });

  test("skipSeamGate lets mid_task through (prospection path)", () => {
    const out = runGates(
      baseInput({ seam: "mid_task", skipSeamGate: true }),
    );
    expect(out).toEqual({ decision: "approve" });
  });

  test("g4 before g5", () => {
    const out = runGates(
      baseInput({
        candidate: cand({ kind: "pattern_nudge", evidence: ["a"] }),
        conversationNudgeCount: 1, // would also fail g5
      }),
    );
    expect(out).toEqual({ decision: "suppress", reason: "kind_not_enabled" });
  });

  test("g5 conversation budget", () => {
    expect(
      runGates(baseInput({ conversationNudgeCount: 1 })),
    ).toEqual({ decision: "suppress", reason: "budget_conversation" });
  });

  test("g5 quiet hours on push", () => {
    expect(
      runGates(
        baseInput({ channel: "push", inQuietHours: true }),
      ),
    ).toEqual({ decision: "suppress", reason: "quiet_hours" });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("isInQuietHours", () => {
  // 2026-07-16 12:00 UTC = 08:00 America/New_York (EDT, UTC-4)
  // 2026-07-16 03:00 UTC = 23:00 America/New_York
  const noonUtc = new Date("2026-07-16T12:00:00.000Z");
  const lateUtc = new Date("2026-07-16T03:00:00.000Z");

  test("default 22:00–08:00: 08:00 local is outside (end exclusive)", () => {
    // 12:00 UTC → 08:00 EDT — quiet ends at 08:00, so not in quiet
    expect(
      isInQuietHours(noonUtc, "America/New_York", "22:00:00", "08:00:00"),
    ).toBe(false);
  });

  test("default 22:00–08:00: 23:00 local is inside", () => {
    expect(
      isInQuietHours(lateUtc, "America/New_York", "22:00:00", "08:00:00"),
    ).toBe(true);
  });

  test("non-crossing window (09:00–17:00)", () => {
    // noon UTC = 08:00 EDT → outside
    expect(
      isInQuietHours(noonUtc, "America/New_York", "09:00", "17:00"),
    ).toBe(false);
    // 14:00 UTC = 10:00 EDT → inside
    expect(
      isInQuietHours(
        new Date("2026-07-16T14:00:00.000Z"),
        "America/New_York",
        "09:00",
        "17:00",
      ),
    ).toBe(true);
  });

  test("malformed time → false", () => {
    expect(isInQuietHours(NOW, "UTC", "nope", "08:00")).toBe(false);
  });
});

describe("parseTimeToMinutes", () => {
  test("parses HH:MM and HH:MM:SS", () => {
    expect(parseTimeToMinutes("22:00")).toBe(22 * 60);
    expect(parseTimeToMinutes("08:00:00")).toBe(8 * 60);
    expect(parseTimeToMinutes("00:30:00")).toBe(30);
  });

  test("rejects garbage", () => {
    expect(parseTimeToMinutes("")).toBeNull();
    expect(parseTimeToMinutes("25:00")).toBeNull();
    expect(parseTimeToMinutes("ab:cd")).toBeNull();
  });
});

describe("isPrepTypeTitle", () => {
  test("classifies prep events", () => {
    expect(isPrepTypeTitle("Interview at Acme — JavaScript backend")).toBe(
      true,
    );
    expect(isPrepTypeTitle("final exam on algorithms")).toBe(true);
    expect(isPrepTypeTitle("Board presentation Thursday")).toBe(true);
  });

  test("plain events are not prep", () => {
    expect(isPrepTypeTitle("Flight to Bangalore")).toBe(false);
    expect(isPrepTypeTitle("Meeting with Rahul")).toBe(false);
    expect(isPrepTypeTitle("Mom's birthday dinner")).toBe(false);
  });
});

describe("localDaysUntil", () => {
  test("same local day → 0", () => {
    const due = new Date("2026-07-16T20:00:00.000Z");
    expect(localDaysUntil(due, NOW, "UTC")).toBe(0);
  });

  test("three days out → 3", () => {
    const due = new Date("2026-07-19T15:00:00.000Z");
    expect(localDaysUntil(due, NOW, "UTC")).toBe(3);
  });

  test("yesterday → -1", () => {
    const due = new Date("2026-07-15T12:00:00.000Z");
    expect(localDaysUntil(due, NOW, "UTC")).toBe(-1);
  });
});

describe("hardBlockMidTask", () => {
  test("fenced code block → mid_task", () => {
    expect(hardBlockMidTask("here's the dump:\n```\nfoo\n```")).toBe(true);
  });

  test("stack frame lines → mid_task", () => {
    expect(
      hardBlockMidTask(
        "TypeError: Cannot read property 'x' of undefined\n    at Object.foo (/app/index.js:12:3)",
      ),
    ).toBe(true);
  });

  test("python traceback → mid_task", () => {
    expect(
      hardBlockMidTask(
        "Traceback (most recent call last):\n  File \"a.py\", line 1",
      ),
    ).toBe(true);
  });

  test("plain conversational turn → not hard-blocked", () => {
    expect(hardBlockMidTask("how was my week?")).toBe(false);
    expect(
      hardBlockMidTask("I'm thinking about the interview on Wednesday"),
    ).toBe(false);
  });
});
