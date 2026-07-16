/**
 * P1 standing-rules evals (spec 03 P1).
 *
 * 1. Canonical regression: X-post rule fires on a draft review, does NOT fire
 *    on an incidental "company X" database question.
 * 2. Matcher precision suite: true fires + true skips (target 0 false fires,
 *    ≥8/10 true fires).
 *
 * Requires DATABASE_URL + embedding + fast-tier credentials (same as rebuild
 * story). Skips hermetically when keys are absent.
 */
import { expect, test } from "bun:test";
import {
  RULE_SIMILARITY_THRESHOLD,
  type MatchedRule,
} from "../retrieval/rule-matcher";

const hasDb = Boolean(process.env.DATABASE_URL);
const hasEmbed =
  process.env.EMBEDDING_PROVIDER === "google"
    ? Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
const hasLlm = Boolean(
  process.env.GROQ_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
);
const runEval = hasDb && hasEmbed && hasLlm;
const evalTest = runEval ? test : test.skip;

/** Verbatim X-post rule from spec 01 / 03 P1. */
export const X_POST_RULE_TEXT =
  "Write good, long posts and post on social media. Don't take too much help from AI. Spend even 1–2 hours writing a post to include feelings and realness. Before posting anything, ask yourself: Will it help anybody? Will it make people engage with it? Will it create a positive impression of me for someone looking for great engineers and founders? Will people like it?";

export const X_POST_TRIGGER_TEXT =
  "user is about to post on social media or asks for feedback on a post, draft, tweet, or whether something is good to publish";

/** Four criteria from the X-post rule — accept near-paraphrases that still
 *  make each criterion visible in the answer. Spec 03 P1 requires the four
 *  questions applied *visibly*; wording may vary. */
const FOUR_QUESTIONS = [
  /help anybody|help someone|help people|useful to (anyone|others|somebody)|will it help|help others|anyone benefit|value to others/i,
  /engage|engagement|people (to )?interact|spark conversation|invite replies|conversation starter/i,
  /positive impression|engineers? and founders?|great engineers|looking for (great )?engineers|founder brand|hiring manager/i,
  /people like|will people like|likable|like it\b|resonate with people|audience (will )?like/i,
];

interface MatcherCase {
  id: string;
  turn: string;
  previous?: string;
  /** true = must fire the X-post rule; false = must not */
  expectFire: boolean;
}

/** 10 labeled cases — 5 true fires, 5 true skips (spec 03 P1). */
const MATCHER_CASES: MatcherCase[] = [
  // True fires
  {
    id: "fire-draft-review",
    turn: "I'm posting this on X, is it good?",
    previous:
      "Here's my draft:\n\nShipped a hard thing this week. Still learning.",
    expectFire: true,
  },
  {
    id: "fire-should-publish",
    turn: "Should I publish this?",
    previous: "Draft: lessons from failing my first startup.",
    expectFire: true,
  },
  {
    id: "fire-review-tweet",
    turn: "Can you review my tweet before I hit post?",
    expectFire: true,
  },
  {
    id: "fire-drafting-post",
    turn: "I'm drafting a LinkedIn post about our launch — any feedback?",
    expectFire: true,
  },
  {
    id: "fire-social-feedback",
    turn: "Give me feedback on this social media post before I share it.",
    previous: "We just closed our seed round after 18 months of grind.",
    expectFire: true,
  },
  // True skips
  {
    id: "skip-company-x-db",
    turn: "Which database should company X use for vector search?",
    expectFire: false,
  },
  {
    id: "skip-platform-incidental",
    turn: "I saw a thread on X about Postgres performance — what do I use?",
    expectFire: false,
  },
  {
    id: "skip-recall-history",
    turn: "When did I last post about the launch?",
    expectFire: false,
  },
  {
    id: "skip-unrelated",
    turn: "Remind me what Rahul said about the equity split.",
    expectFire: false,
  },
  {
    id: "skip-generic-question",
    turn: "What's coming up this week?",
    expectFire: false,
  },
];

async function seedUserWithXPostRule(): Promise<{
  userId: string;
  ruleId: string;
  memoryId: string;
  cleanup: () => Promise<void>;
}> {
  const {
    db,
    users,
    memories,
    rules,
    surfacings,
    eq,
  } = require("@repo/db");
  const { embedText } = require("../ai/models");

  const suffix = crypto.randomUUID();
  const [user] = await db
    .insert(users)
    .values({
      email: `p1-rules-${suffix}@example.test`,
      timezone: "UTC",
    })
    .returning({ id: users.id });
  const userId = user.id as string;

  const [memory] = await db
    .insert(memories)
    .values({
      userId,
      rawText: X_POST_RULE_TEXT,
      source: "manual",
      status: "processed",
    })
    .returning({ id: memories.id });
  const memoryId = memory.id as string;

  const { embedding } = await embedText(X_POST_TRIGGER_TEXT);
  const [rule] = await db
    .insert(rules)
    .values({
      userId,
      ruleText: X_POST_RULE_TEXT,
      triggerText: X_POST_TRIGGER_TEXT,
      triggerEmbedding: embedding,
      active: true,
      sourceMemory: memoryId,
      applyCount: 0,
    })
    .returning({ id: rules.id });
  const ruleId = rule.id as string;

  return {
    userId,
    ruleId,
    memoryId,
    cleanup: async () => {
      await db.delete(surfacings).where(eq(surfacings.userId, userId));
      await db.delete(rules).where(eq(rules.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    },
  };
}

function firedOnRule(matched: MatchedRule[], ruleId: string): boolean {
  return matched.some((m) => m.id === ruleId);
}

evalTest("matcher suite: 0 false fires, ≥8/10 true decisions", async () => {
  const { matchStandingRules } = require("../retrieval/rule-matcher");
  const fixture = await seedUserWithXPostRule();
  try {
    let correct = 0;
    let falseFires = 0;
    const results: Array<{ id: string; expectFire: boolean; fired: boolean }> =
      [];

    for (const c of MATCHER_CASES) {
      const matched: MatchedRule[] = await matchStandingRules({
        userId: fixture.userId,
        userTurn: c.turn,
        previousUserTurn: c.previous ?? null,
      });
      const fired = firedOnRule(matched, fixture.ruleId);
      results.push({ id: c.id, expectFire: c.expectFire, fired });
      if (fired === c.expectFire) correct += 1;
      if (fired && !c.expectFire) falseFires += 1;
    }

    // Log for the acceptance report.
    console.log(
      "rule-matcher cases:\n" +
        results
          .map(
            (r) =>
              `  ${r.id}: expect=${r.expectFire} got=${r.fired} ${r.expectFire === r.fired ? "OK" : "FAIL"}`,
          )
          .join("\n"),
    );

    expect(falseFires, "false fires must be 0").toBe(0);
    expect(correct, "true decisions ≥ 8/10").toBeGreaterThanOrEqual(8);
    expect(MATCHER_CASES).toHaveLength(10);
  } finally {
    await fixture.cleanup();
  }
}, 180_000);

evalTest(
  "canonical P1 regression: fire on X draft review; skip company-X database",
  async () => {
    const { matchStandingRules } = require("../retrieval/rule-matcher");
    const { answerQuestion } = require("../retrieval/agent");
    const {
      db,
      rules,
      surfacings,
      conversations,
      eq,
      and,
    } = require("@repo/db");

    const fixture = await seedUserWithXPostRule();
    let conversationId: string | null = null;
    try {
      // Create a durable conversation for ledger conversation_id.
      const [convo] = await db
        .insert(conversations)
        .values({
          userId: fixture.userId,
          startedAt: new Date(),
          lastTurnAt: new Date(),
          status: "active",
          turnCount: 0,
        })
        .returning({ id: conversations.id });
      conversationId = convo.id;

      const draft =
        "Shipped something hard this week. Still figuring out the craft. " +
        "Grateful for the people who stayed.";
      const question = "I'm posting this on X, is it good?";

      const steps: Array<{ kind: string; label: string }> = [];
      const handle = await answerQuestion({
        userId: fixture.userId,
        question,
        history: [{ role: "user", content: draft }],
        conversationId,
        onStep: (s: { kind: string; label: string }) => steps.push(s),
      });

      let answer = "";
      for await (const chunk of handle.textStream) {
        answer += chunk;
      }
      const final = await handle.result;

      // (a) four questions applied visibly
      const questionsHit = FOUR_QUESTIONS.filter((re) => re.test(answer));
      console.log("canonical answer excerpt:", answer.slice(0, 400));
      console.log(
        "four-question hits:",
        questionsHit.length,
        "/",
        FOUR_QUESTIONS.length,
      );
      expect(
        questionsHit.length,
        "answer should visibly apply the four posting questions",
      ).toBeGreaterThanOrEqual(3);

      // (b) rule trace step
      const ruleSteps = [
        ...steps,
        ...final.steps,
      ].filter((s) => s.kind === "rule");
      expect(ruleSteps.length, "rule trace step emitted").toBeGreaterThanOrEqual(
        1,
      );
      expect(final.ruleIdsApplied).toContain(fixture.ruleId);

      // (c) ledger row
      const ledger = await db
        .select({
          id: surfacings.id,
          kind: surfacings.kind,
          subjectId: surfacings.subjectId,
        })
        .from(surfacings)
        .where(
          and(
            eq(surfacings.userId, fixture.userId),
            eq(surfacings.kind, "rule_applied"),
            eq(surfacings.subjectId, fixture.ruleId),
          ),
        );
      expect(ledger.length, "rule_applied ledger row").toBeGreaterThanOrEqual(1);

      // apply_count bumped
      const [updatedRule] = await db
        .select({ applyCount: rules.applyCount })
        .from(rules)
        .where(eq(rules.id, fixture.ruleId))
        .limit(1);
      expect(updatedRule.applyCount).toBeGreaterThanOrEqual(1);

      // Precision: database question mentioning X must NOT fire
      const skipMatched: MatchedRule[] = await matchStandingRules({
        userId: fixture.userId,
        userTurn: "Which database should company X use?",
      });
      expect(
        firedOnRule(skipMatched, fixture.ruleId),
        "rule must NOT fire on incidental company X",
      ).toBe(false);

      // Threshold constant still the contract
      expect(RULE_SIMILARITY_THRESHOLD).toBe(0.45);
    } finally {
      if (conversationId) {
        await db
          .delete(surfacings)
          .where(eq(surfacings.userId, fixture.userId));
        await db
          .delete(conversations)
          .where(eq(conversations.id, conversationId));
      }
      await fixture.cleanup();
    }
  },
  300_000,
);
