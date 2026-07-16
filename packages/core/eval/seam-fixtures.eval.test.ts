/**
 * Seam judgment fixtures (spec 03 P2): ~10 labeled conversation turns.
 *
 * The hard-block regex is evaluated on every fixture. Model seam judgment is
 * only involved when the hard-block does not fire; those cases are labeled
 * and checked for the pure hard-block side here. Full LLM seam quality is
 * best-effort when keys are present.
 */
import { describe, expect, test } from "bun:test";
import { hardBlockMidTask } from "../proactive/gates";
import { runAwarenessModel, type AwarenessAttachment } from "../proactive/awareness";

interface SeamFixture {
  id: string;
  turn: string;
  /** Expected hard-block (code/stack) result. */
  hardBlock: boolean;
  /** Human label for model seam when hard-block is false. */
  expectedSeam?: "open" | "mid_task";
}

/**
 * Labeled fixtures: hard-block cases are deterministic; open/mid_task labels
 * document the intended model judgment for the awareness pass.
 */
export const SEAM_FIXTURES: SeamFixture[] = [
  {
    id: "greeting-open",
    turn: "hey, what's a good focus for today?",
    hardBlock: false,
    expectedSeam: "open",
  },
  {
    id: "recall-open",
    turn: "what do you know about my goals this quarter?",
    hardBlock: false,
    expectedSeam: "open",
  },
  {
    id: "smalltalk-open",
    turn: "thanks — that helps",
    hardBlock: false,
    expectedSeam: "open",
  },
  {
    id: "planning-open",
    turn: "I should probably think about next week",
    hardBlock: false,
    expectedSeam: "open",
  },
  {
    id: "fenced-code-block",
    turn: "why is this failing?\n```ts\nconst x = foo.bar();\n```",
    hardBlock: true,
  },
  {
    id: "js-stack-trace",
    turn: `TypeError: Cannot read property 'map' of undefined
    at renderList (/app/src/List.tsx:18:22)
    at App (/app/src/App.tsx:9:5)`,
    hardBlock: true,
  },
  {
    id: "python-traceback",
    turn: `Traceback (most recent call last):
  File "main.py", line 12, in <module>
    run()
ValueError: empty stream`,
    hardBlock: true,
  },
  {
    id: "exception-line",
    turn: "FATAL EXCEPTION: main\njava.lang.NullPointerException: Attempt to invoke",
    hardBlock: true,
  },
  {
    id: "syntax-error",
    turn: "SyntaxError: Unexpected token '}' in JSON at position 42",
    hardBlock: true,
  },
  {
    id: "mixed-draft-open",
    turn: "here's a rough draft of my post — is the tone okay? no code, just prose.",
    hardBlock: false,
    expectedSeam: "open",
  },
];

describe("seam hard-block fixtures (deterministic)", () => {
  for (const fix of SEAM_FIXTURES) {
    test(`${fix.id}: hardBlock=${fix.hardBlock}`, () => {
      expect(hardBlockMidTask(fix.turn)).toBe(fix.hardBlock);
    });
  }

  test("exactly the labeled hard-block set matches", () => {
    const blocked = SEAM_FIXTURES.filter((f) => hardBlockMidTask(f.turn)).map(
      (f) => f.id,
    );
    const expected = SEAM_FIXTURES.filter((f) => f.hardBlock).map((f) => f.id);
    expect(blocked).toEqual(expected);
  });
});

// LLM seam judgment is optional and quota-heavy. Opt in with RUN_SEAM_LLM_TEST=1.
const runSeamLlm =
  process.env.RUN_SEAM_LLM_TEST === "1" &&
  Boolean(process.env.GROQ_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const llmTest = runSeamLlm ? test : test.skip;

const SAMPLE_CANDIDATE: AwarenessAttachment = {
  kind: "loop_nudge",
  subjectType: "open_loop",
  subjectId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  title: "Interview at Acme — JavaScript backend",
  dueAt: "2026-07-19T15:00:00.000Z",
  evidence: ["dddddddd-dddd-dddd-dddd-dddddddddddd"],
};

describe("seam model path hard-block (no LLM — pure post-process)", () => {
  // runAwarenessModel applies hardBlockMidTask after the model. When there are
  // no candidates/priors it skips the LLM entirely — so we can assert the
  // hard-block path without burning quota.
  for (const fix of SEAM_FIXTURES.filter((f) => f.hardBlock)) {
    test(`${fix.id}: empty-candidate path still yields mid_task`, async () => {
      const result = await runAwarenessModel({
        userTurn: fix.turn,
        recentTurns: [],
        candidates: [],
        priorSurfacingIds: [],
      });
      expect(result.seam).toBe("mid_task");
      expect(result.candidate).toBeNull();
      expect(result.timedOut).toBe(false);
    });
  }
});

describe("seam model judgment (opt-in RUN_SEAM_LLM_TEST=1)", () => {
  llmTest("greeting-open: awareness returns without throw", async () => {
    const fix = SEAM_FIXTURES.find((f) => f.id === "greeting-open")!;
    const result = await runAwarenessModel({
      userTurn: fix.turn,
      recentTurns: [],
      candidates: [SAMPLE_CANDIDATE],
      priorSurfacingIds: [],
    });
    expect(result.timedOut).toBe(false);
    expect(["open", "mid_task"]).toContain(result.seam);
  }, 20_000);
});
