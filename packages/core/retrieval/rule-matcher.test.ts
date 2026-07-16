import { describe, expect, test } from "bun:test";
import {
  filterRuleCandidates,
  shortRuleName,
  buildTurnEmbedText,
  RULE_SIMILARITY_THRESHOLD,
  RULE_MATCH_CAP,
  type RuleCandidate,
} from "./rule-matcher";


function cand(
  id: string,
  similarity: number,
  extras: Partial<RuleCandidate> = {},
): RuleCandidate {
  return {
    id,
    ruleText: extras.ruleText ?? `rule ${id}`,
    triggerText: extras.triggerText ?? `trigger ${id}`,
    sourceMemory: extras.sourceMemory ?? `mem-${id}`,
    similarity,
  };
}

describe("filterRuleCandidates (threshold + cap)", () => {
  test("drops candidates at or below the threshold", () => {
    const out = filterRuleCandidates([
      cand("a", 0.45), // boundary: must be *strictly* greater
      cand("b", 0.44),
      cand("c", 0.46),
      cand("d", 0.9),
    ]);
    expect(out.map((c) => c.id)).toEqual(["d", "c"]);
  });

  test("sorts by similarity descending", () => {
    const out = filterRuleCandidates([
      cand("low", 0.5),
      cand("high", 0.95),
      cand("mid", 0.7),
    ]);
    expect(out.map((c) => c.id)).toEqual(["high", "mid", "low"]);
  });

  test("caps at RULE_MATCH_CAP (3)", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      cand(`r${i}`, 0.99 - i * 0.01),
    );
    const out = filterRuleCandidates(many);
    expect(out).toHaveLength(RULE_MATCH_CAP);
    expect(out[0]!.id).toBe("r0");
    expect(out[2]!.id).toBe("r2");
  });

  test("respects a custom threshold and cap", () => {
    const out = filterRuleCandidates(
      [cand("a", 0.8), cand("b", 0.6), cand("c", 0.55)],
      0.7,
      1,
    );
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  test("empty input yields empty output", () => {
    expect(filterRuleCandidates([])).toEqual([]);
  });

  test("threshold constant matches spec 02 §5.1", () => {
    expect(RULE_SIMILARITY_THRESHOLD).toBe(0.45);
    expect(RULE_MATCH_CAP).toBe(3);
  });
});

describe("shortRuleName + buildTurnEmbedText", () => {
  test("prefers trigger text and truncates long names", () => {
    expect(
      shortRuleName({
        triggerText: "user is about to post on social media",
        ruleText: "long rule body…",
      }),
    ).toBe("user is about to post on social media");

    const long = "x".repeat(80);
    const name = shortRuleName({ triggerText: long, ruleText: "y" });
    expect(name.endsWith("…")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(48);
  });

  test("embeds previous turn when present", () => {
    expect(buildTurnEmbedText("is this good?", "draft body here")).toContain(
      "Previous user turn",
    );
    expect(buildTurnEmbedText("hello")).toBe("hello");
  });
});

describe("planRuleCorrection (edit-as-correction chain)", () => {
  let planRuleCorrection: any;
  beforeAll(() => {
    planRuleCorrection = require("./rule-edit").planRuleCorrection;
  });

  test("returns null for no-op identical text", () => {
    expect(
      planRuleCorrection({
        oldRuleText: "Ask four questions before posting",
        oldTriggerText: "about to post",
        ruleText: "Ask four questions before posting",
        triggerText: "about to post",
      }),
    ).toBeNull();
  });

  test("returns null when neither field is provided (still identical)", () => {
    expect(
      planRuleCorrection({
        oldRuleText: "A",
        oldTriggerText: "B",
      }),
    ).toBeNull();
  });

  test("plans a new ruleText while keeping trigger when only ruleText changes", () => {
    const plan = planRuleCorrection({
      oldRuleText: "old rule",
      oldTriggerText: "when posting",
      ruleText: "new corrected rule",
    });
    expect(plan).toEqual({
      ruleText: "new corrected rule",
      triggerText: "when posting",
      memoryRawText: "new corrected rule",
    });
  });

  test("plans a new trigger while keeping rule text", () => {
    const plan = planRuleCorrection({
      oldRuleText: "hold me to the four questions",
      oldTriggerText: "old trigger",
      triggerText: "user asks for feedback on a draft/post",
    });
    expect(plan?.triggerText).toBe(
      "user asks for feedback on a draft/post",
    );
    expect(plan?.ruleText).toBe("hold me to the four questions");
    expect(plan?.memoryRawText).toBe("hold me to the four questions");
  });

  test("trims whitespace and rejects empty after trim", () => {
    expect(
      planRuleCorrection({
        oldRuleText: "ok",
        oldTriggerText: "when",
        ruleText: "   ",
      }),
    ).toBeNull();
  });
});
