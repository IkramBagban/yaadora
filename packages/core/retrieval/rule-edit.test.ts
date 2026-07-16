/**
 * Edit-as-correction supersession chain against a real DB (when available).
 * Pure plan tests live in rule-matcher.test.ts; this pins the write path:
 * old text immutable, new row + memory, superseded_by link, active=false on old,
 * no mutation of existing rules via re-ingest, head-only edits.
 */
import { expect, test } from "bun:test";

const runDb =
  Boolean(process.env.DATABASE_URL) &&
  (process.env.EMBEDDING_PROVIDER === "google"
    ? Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY));

const dbTest = runDb ? test : test.skip;

async function seedRule(params: {
  userId: string;
  ruleText: string;
  triggerText: string;
  active?: boolean;
  applyCount?: number;
}) {
  const { db, memories, rules } = require("@repo/db");
  const { embedText } = require("../ai/models");
  const [memory] = await db
    .insert(memories)
    .values({
      userId: params.userId,
      rawText: params.ruleText,
      source: "manual",
      status: "processed",
    })
    .returning({ id: memories.id });
  const { embedding } = await embedText(params.triggerText);
  const [rule] = await db
    .insert(rules)
    .values({
      userId: params.userId,
      ruleText: params.ruleText,
      triggerText: params.triggerText,
      triggerEmbedding: embedding,
      active: params.active ?? true,
      sourceMemory: memory.id,
      applyCount: params.applyCount ?? 0,
    })
    .returning({
      id: rules.id,
      ruleText: rules.ruleText,
      applyCount: rules.applyCount,
      active: rules.active,
    });
  return { memory, rule };
}

dbTest("edit-as-correction supersedes without mutating old text", async () => {
  const { db, users, memories, rules, eq } = require("@repo/db");
  const { editRuleAsCorrection } = require("./rule-edit");

  const suffix = crypto.randomUUID();
  let userId: string | null = null;
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `rule-edit-${suffix}@example.test`,
        timezone: "UTC",
      })
      .returning({ id: users.id });
    userId = user.id;

    const { rule: oldRule } = await seedRule({
      userId,
      ruleText: "Original rule: always ask four questions before posting.",
      triggerText: "user is about to post on social media",
      applyCount: 2,
    });

    const result = await editRuleAsCorrection({
      userId,
      ruleId: oldRule.id,
      ruleText: "Corrected: also check if it sounds like me.",
    });

    expect(result).not.toBeNull();
    expect(result!.oldRuleId).toBe(oldRule.id);
    expect(result!.newRule.id).not.toBe(oldRule.id);
    expect(result!.newRule.ruleText).toBe(
      "Corrected: also check if it sounds like me.",
    );
    expect(result!.newRule.active).toBe(true);
    expect(result!.newRule.applyCount).toBe(0);

    const [oldAfter] = await db
      .select({
        ruleText: rules.ruleText,
        active: rules.active,
        supersededBy: rules.supersededBy,
        applyCount: rules.applyCount,
      })
      .from(rules)
      .where(eq(rules.id, oldRule.id))
      .limit(1);

    // Immutability: original text and apply history preserved.
    expect(oldAfter.ruleText).toBe(
      "Original rule: always ask four questions before posting.",
    );
    expect(oldAfter.active).toBe(false);
    expect(oldAfter.supersededBy).toBe(result!.newRule.id);
    expect(oldAfter.applyCount).toBe(2);

    // New memory exists as provenance.
    const [mem] = await db
      .select({ rawText: memories.rawText, source: memories.source })
      .from(memories)
      .where(eq(memories.id, result!.memoryId))
      .limit(1);
    expect(mem.rawText).toBe("Corrected: also check if it sounds like me.");
    expect(mem.source).toBe("manual");
  } finally {
    if (userId) {
      await db.delete(rules).where(eq(rules.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }
}, 60_000);

dbTest("edit carries forward paused active state", async () => {
  const { db, users, memories, rules, eq } = require("@repo/db");
  const { editRuleAsCorrection } = require("./rule-edit");

  const suffix = crypto.randomUUID();
  let userId: string | null = null;
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `rule-edit-paused-${suffix}@example.test`,
        timezone: "UTC",
      })
      .returning({ id: users.id });
    userId = user.id;

    const { rule: oldRule } = await seedRule({
      userId,
      ruleText: "Paused rule body",
      triggerText: "when reviewing a draft",
      active: false,
    });

    const result = await editRuleAsCorrection({
      userId,
      ruleId: oldRule.id,
      ruleText: "Paused rule body, corrected",
    });

    expect(result).not.toBeNull();
    expect(result!.newRule.active).toBe(false);
  } finally {
    if (userId) {
      await db.delete(rules).where(eq(rules.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }
}, 60_000);

dbTest("edit of an already-superseded rule is a no-op", async () => {
  const { db, users, memories, rules, eq } = require("@repo/db");
  const { editRuleAsCorrection } = require("./rule-edit");

  const suffix = crypto.randomUUID();
  let userId: string | null = null;
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `rule-edit-super-${suffix}@example.test`,
        timezone: "UTC",
      })
      .returning({ id: users.id });
    userId = user.id;

    const { rule: oldRule } = await seedRule({
      userId,
      ruleText: "V1 rule",
      triggerText: "when posting",
    });

    const first = await editRuleAsCorrection({
      userId,
      ruleId: oldRule.id,
      ruleText: "V2 rule",
    });
    expect(first).not.toBeNull();

    // Second edit of the ancestor must not fork another head.
    const second = await editRuleAsCorrection({
      userId,
      ruleId: oldRule.id,
      ruleText: "V3 rule",
    });
    expect(second).toBeNull();

    const heads = await db
      .select({ id: rules.id, ruleText: rules.ruleText, active: rules.active })
      .from(rules)
      .where(eq(rules.userId, userId));
    const activeHeads = heads.filter((r: { active: boolean }) => r.active);
    expect(activeHeads).toHaveLength(1);
    expect(activeHeads[0]!.ruleText).toBe("V2 rule");
  } finally {
    if (userId) {
      await db.delete(rules).where(eq(rules.userId, userId));
      await db.delete(memories).where(eq(memories.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  }
}, 60_000);

dbTest(
  "re-ingest of correction memory does not overwrite corrected rule text",
  async () => {
    const { db, users, memories, rules, eq } = require("@repo/db");
    const { editRuleAsCorrection } = require("./rule-edit");
    const { upsertStandingRule } = require("../ingestion/pipeline");

    const suffix = crypto.randomUUID();
    let userId: string | null = null;
    try {
      const [user] = await db
        .insert(users)
        .values({
          email: `rule-edit-reingest-${suffix}@example.test`,
          timezone: "UTC",
        })
        .returning({ id: users.id });
      userId = user.id;

      const { rule: oldRule } = await seedRule({
        userId,
        ruleText: "Original",
        triggerText: "when posting",
      });

      const result = await editRuleAsCorrection({
        userId,
        ruleId: oldRule.id,
        ruleText: "User-corrected text must survive re-ingest",
        triggerText: "when drafting or reviewing a social post",
      });
      expect(result).not.toBeNull();

      // Simulate ingestion re-running extraction on the correction memory.
      await upsertStandingRule({
        userId,
        memoryId: result!.memoryId,
        standingRule: {
          ruleText: "LLM paraphrased overwrite attempt",
          triggerText: "paraphrased trigger",
        },
        triggerEmbedding: [0.01, 0.02],
      });

      const [after] = await db
        .select({
          ruleText: rules.ruleText,
          triggerText: rules.triggerText,
        })
        .from(rules)
        .where(eq(rules.id, result!.newRule.id))
        .limit(1);

      expect(after.ruleText).toBe("User-corrected text must survive re-ingest");
      expect(after.triggerText).toBe(
        "when drafting or reviewing a social post",
      );
    } finally {
      if (userId) {
        await db.delete(rules).where(eq(rules.userId, userId));
        await db.delete(memories).where(eq(memories.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
    }
  },
  60_000,
);
