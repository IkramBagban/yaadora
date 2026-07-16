import { test, expect, mock, beforeAll, afterAll } from "bun:test";

let buildContextPackText: any;
let estimateTokens: any;
let CONTEXT_PACK_TOKEN_BUDGET: any;
type ContextPackSlots = import("./context-pack").ContextPackSlots;

beforeAll(() => {
  mock.module("@repo/db", () => ({
    getDigest: async () => null,
    getDueOpenLoops: async () => [],
  }));

  const mod = require("./context-pack");
  buildContextPackText = mod.buildContextPackText;
  estimateTokens = mod.estimateTokens;
  CONTEXT_PACK_TOKEN_BUDGET = mod.CONTEXT_PACK_TOKEN_BUDGET;
});

afterAll(() => {
  mock.restore();
});

/**
 * The load-bearing invariant of the context pack (spec 02 §4): whatever the
 * inputs, the rendered pack never exceeds its token budget. `buildContextPackText`
 * is pure, so we can prove it without a database.
 */

const emptyStubs = { rules: [], nudge: null } as const;

function bigText(chars: number): string {
  return "x".repeat(chars);
}

test("stays under budget with grossly oversized inputs", () => {
  // Each slot alone is ~5x the whole budget.
  const huge = bigText(CONTEXT_PACK_TOKEN_BUDGET * 4 * 5);
  const slots: ContextPackSlots = {
    profile: huge,
    weekDigest: huge,
    loops: Array.from({ length: 200 }, (_, i) => ({
      id: `loop-${i}`,
      kind: "upcoming_event",
      title: bigText(500),
      dueAt: new Date("2026-07-20T00:00:00Z"),
    })),
    ...emptyStubs,
  };

  const { text, estimatedTokens } = buildContextPackText(slots);
  expect(estimatedTokens).toBeLessThanOrEqual(CONTEXT_PACK_TOKEN_BUDGET);
  expect(estimateTokens(text)).toBeLessThanOrEqual(CONTEXT_PACK_TOKEN_BUDGET);
});

test("honors priority: loops kept before digest before profile when squeezed", () => {
  // Loops fill most of the budget; digest + profile should be squeezed out.
  const slots: ContextPackSlots = {
    profile: "PROFILE_MARKER",
    weekDigest: "DIGEST_MARKER",
    loops: [
      {
        id: "loop-1",
        kind: "upcoming_event",
        title: bigText(CONTEXT_PACK_TOKEN_BUDGET * 4),
        dueAt: null,
      },
    ],
    ...emptyStubs,
  };

  const { text, estimatedTokens } = buildContextPackText(slots);
  expect(estimatedTokens).toBeLessThanOrEqual(CONTEXT_PACK_TOKEN_BUDGET);
  expect(text).toContain("Open threads:");
  // Lower-priority slots dropped under pressure.
  expect(text).not.toContain("PROFILE_MARKER");
  expect(text).not.toContain("DIGEST_MARKER");
});

test("small pack renders all slots in display order, well under budget", () => {
  const slots: ContextPackSlots = {
    profile: "Founder building Yaadora. Based in Pune.",
    weekDigest: "Shipped the reminders composer; started the second-brain schema.",
    loops: [
      {
        id: "loop-1",
        kind: "upcoming_event",
        title: "Interview on the 24th (JavaScript, backend)",
        dueAt: new Date("2026-07-24T00:00:00Z"),
      },
    ],
    ...emptyStubs,
  };

  const { text, estimatedTokens } = buildContextPackText(slots);
  expect(estimatedTokens).toBeLessThanOrEqual(CONTEXT_PACK_TOKEN_BUDGET);
  const profileIdx = text.indexOf("About the user:");
  const digestIdx = text.indexOf("This week:");
  const loopsIdx = text.indexOf("Open threads:");
  expect(profileIdx).toBeGreaterThanOrEqual(0);
  expect(digestIdx).toBeGreaterThan(profileIdx);
  expect(loopsIdx).toBeGreaterThan(digestIdx);
  expect(text).toContain("Interview on the 24th");
  expect(text).toContain("(due 2026-07-24)");
});

test("empty pack is just the header", () => {
  const slots: ContextPackSlots = {
    profile: null,
    weekDigest: null,
    loops: [],
    ...emptyStubs,
  };
  const { text, estimatedTokens } = buildContextPackText(slots);
  expect(text).toBe("## What you currently know (context pack)");
  expect(estimatedTokens).toBeLessThanOrEqual(CONTEXT_PACK_TOKEN_BUDGET);
});

// ---------------------------------------------------------------------------
// P3 entity-context slot (spec 02 §4/§5.2): displayed BELOW loops and ABOVE the
// nudge; budgeted AFTER dated loops and BEFORE the digest.
// ---------------------------------------------------------------------------

test("entity context slot renders below loops and above the nudge", () => {
  const slots: ContextPackSlots = {
    profile: "PROFILE_MARKER",
    weekDigest: "DIGEST_MARKER",
    loops: [
      {
        id: "loop-1",
        kind: "upcoming_event",
        title: "Trip to Pune",
        dueAt: new Date("2026-07-24T00:00:00Z"),
      },
    ],
    rules: [],
    nudge: { text: "NUDGE_MARKER", evidence: ["m1"] },
    entityContext: {
      text: "— Rahul (person) —\nProfile: co-founder",
      entityIds: ["e1"],
      receipts: ["m1"],
    },
  };
  const { text, estimatedTokens } = buildContextPackText(slots);
  expect(estimatedTokens).toBeLessThanOrEqual(CONTEXT_PACK_TOKEN_BUDGET);
  const loopsIdx = text.indexOf("Open threads:");
  const entityIdx = text.indexOf("Rahul (person)");
  const nudgeIdx = text.indexOf("NUDGE_MARKER");
  expect(loopsIdx).toBeGreaterThanOrEqual(0);
  expect(entityIdx).toBeGreaterThan(loopsIdx);
  expect(nudgeIdx).toBeGreaterThan(entityIdx);
});

test("budget priority: loops > entity context > digest under pressure", () => {
  const slots: ContextPackSlots = {
    profile: "PROFILE_MARKER",
    weekDigest: "DIGEST_MARKER",
    loops: [
      {
        id: "loop-1",
        kind: "upcoming_event",
        title: bigText(CONTEXT_PACK_TOKEN_BUDGET * 2),
        dueAt: null,
      },
    ],
    rules: [],
    nudge: null,
    entityContext: {
      text: "ENTITY_MARKER " + bigText(CONTEXT_PACK_TOKEN_BUDGET * 2),
      entityIds: ["e1"],
      receipts: [],
    },
  };
  const { text, estimatedTokens } = buildContextPackText(slots);
  expect(estimatedTokens).toBeLessThanOrEqual(CONTEXT_PACK_TOKEN_BUDGET);
  // Loops (higher priority) survive; the digest (lower) is squeezed out.
  expect(text).toContain("Open threads:");
  expect(text).not.toContain("DIGEST_MARKER");
});

test("clamp holds with a grossly oversized entity context slot", () => {
  const huge = bigText(CONTEXT_PACK_TOKEN_BUDGET * 4 * 5);
  const slots: ContextPackSlots = {
    profile: null,
    weekDigest: null,
    loops: [],
    rules: [],
    nudge: null,
    entityContext: { text: huge, entityIds: ["e1"], receipts: [] },
  };
  const { text, estimatedTokens } = buildContextPackText(slots);
  expect(estimatedTokens).toBeLessThanOrEqual(CONTEXT_PACK_TOKEN_BUDGET);
  expect(estimateTokens(text)).toBeLessThanOrEqual(CONTEXT_PACK_TOKEN_BUDGET);
});
