import { test, expect, describe } from "bun:test";
import {
  parsePatternReceipts,
  pickBestObservation,
  PATTERN_MIN_RECEIPTS,
  PATTERN_MIN_CONFIDENCE,
  PATTERN_MAX_DISTANCE,
} from "./observations";
import { buildContextPackText, type ContextPackSlots } from "./context-pack";

/**
 * P5 pattern surfacing — the deterministic guarantees. Per the eval-suite CI
 * policy (spec 03), a SUPPRESSION regression must block release, so the "stays
 * silent" cases below are the load-bearing ones: a pattern must NOT surface
 * when under-supported, low-confidence, or irrelevant to the turn. These are
 * pure (no DB); the query-level dismissal/recency filter is covered by the
 * DB-backed eval.
 */

const FIVE = ["m1", "m2", "m3", "m4", "m5"];
function row(over: Partial<Parameters<typeof pickBestObservation>[0][number]> = {}) {
  return {
    id: "f1",
    factText: "Your last five projects went quiet around week three.",
    objectText: `supported_by: ${FIVE.join(", ")}`,
    confidence: 0.85,
    distance: 0.2,
    ...over,
  };
}

describe("parsePatternReceipts", () => {
  test("parses the supported_by convention, deduped", () => {
    expect(parsePatternReceipts("supported_by: a, b, c")).toEqual(["a", "b", "c"]);
    expect(parsePatternReceipts("supported_by: a, a, b")).toEqual(["a", "b"]);
  });
  test("tolerates a bare id list and null", () => {
    expect(parsePatternReceipts("x, y")).toEqual(["x", "y"]);
    expect(parsePatternReceipts(null)).toEqual([]);
    expect(parsePatternReceipts("")).toEqual([]);
  });
});

describe("pickBestObservation — strict bar (spec 02 §5.4)", () => {
  test("surfaces a 5-receipt, high-confidence, relevant pattern", () => {
    const picked = pickBestObservation([row()]);
    expect(picked).not.toBeNull();
    expect(picked!.id).toBe("f1");
    expect(picked!.receipts).toHaveLength(5);
  });

  test("SILENT below 5 receipts (inference too thin)", () => {
    expect(
      pickBestObservation([row({ objectText: "supported_by: m1, m2, m3, m4" })]),
    ).toBeNull();
  });

  test("receipt boundary: exactly MIN passes, one under fails", () => {
    const ids = (n: number) =>
      Array.from({ length: n }, (_, i) => `m${i}`).join(", ");
    expect(
      pickBestObservation([
        row({ objectText: `supported_by: ${ids(PATTERN_MIN_RECEIPTS)}` }),
      ]),
    ).not.toBeNull();
    expect(
      pickBestObservation([
        row({ objectText: `supported_by: ${ids(PATTERN_MIN_RECEIPTS - 1)}` }),
      ]),
    ).toBeNull();
  });

  test("SILENT below confidence 0.8; boundary passes", () => {
    expect(pickBestObservation([row({ confidence: PATTERN_MIN_CONFIDENCE - 0.01 })])).toBeNull();
    expect(pickBestObservation([row({ confidence: PATTERN_MIN_CONFIDENCE })])).not.toBeNull();
  });

  test("SILENT when not relevant to the turn (distance too high)", () => {
    expect(pickBestObservation([row({ distance: PATTERN_MAX_DISTANCE + 0.01 })])).toBeNull();
    expect(pickBestObservation([row({ distance: PATTERN_MAX_DISTANCE })])).not.toBeNull();
  });

  test("skips a disqualified top candidate and takes the next eligible one", () => {
    const picked = pickBestObservation([
      row({ id: "weak", confidence: 0.5 }),
      row({ id: "good", distance: 0.3 }),
    ]);
    expect(picked!.id).toBe("good");
  });

  test("empty pool → null", () => {
    expect(pickBestObservation([])).toBeNull();
  });
});

describe("context pack — onYourMind slot (spec 04 §3.4)", () => {
  const base: ContextPackSlots = {
    profile: null,
    weekDigest: null,
    loops: [],
    rules: [],
    nudge: null,
  };

  test("renders a pattern dossier with its id, receipts, and stay-silent guidance", () => {
    const { text } = buildContextPackText({
      ...base,
      onYourMind: [
        { kind: "pattern", id: "f1", summary: "Projects stall at week three.", receipts: FIVE },
      ],
    });
    expect(text).toContain("Projects stall at week three.");
    expect(text).toContain("id: f1");
    expect(text).toContain("note_surfaced");
    expect(text.toLowerCase()).toContain("raise nothing");
  });

  test("onYourMind is the FIRST slot dropped under budget pressure (lowest priority)", () => {
    // A tiny budget that fits the header + rules but nothing else: the rule
    // (highest priority) survives, the onYourMind section does not.
    const { text } = buildContextPackText(
      {
        ...base,
        rules: [{ id: "r1", ruleText: "Always ask the four questions." }],
        onYourMind: [{ kind: "pattern", id: "f1", summary: "A pattern.", receipts: FIVE }],
      },
      50,
    );
    expect(text).toContain("four questions");
    expect(text).not.toContain("A pattern.");
  });
});
