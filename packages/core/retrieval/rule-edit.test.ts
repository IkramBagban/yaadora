/**
 * Edit-as-correction supersession chain against a real DB (when available).
 * Pure plan tests live in rule-matcher.test.ts; this pins the write path:
 * old text immutable, new row + memory, superseded_by link, active=false on old.
 */
import { expect, test } from "bun:test";

const runDb =
  Boolean(process.env.DATABASE_URL) &&
  (process.env.EMBEDDING_PROVIDER === "google"
    ? Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY));

const dbTest = runDb ? test : test.skip;

dbTest("edit-as-correction supersedes without mutating old text", async () => {
  const { db, users, memories, rules, eq } = require("@repo/db");
  const { editRuleAsCorrection } = require("./rule-edit");
  const { embedText } = require("../ai/models");

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

    const [memory] = await db
      .insert(memories)
      .values({
        userId,
        rawText: "Original rule: always ask four questions before posting.",
        source: "manual",
        status: "processed",
      })
      .returning({ id: memories.id });

    const { embedding } = await embedText(
      "user is about to post on social media",
    );
    const [oldRule] = await db
      .insert(rules)
      .values({
        userId,
        ruleText: "Original rule: always ask four questions before posting.",
        triggerText: "user is about to post on social media",
        triggerEmbedding: embedding,
        active: true,
        sourceMemory: memory.id,
        applyCount: 2,
      })
      .returning({
        id: rules.id,
        ruleText: rules.ruleText,
        applyCount: rules.applyCount,
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
