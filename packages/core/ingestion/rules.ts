import { db, rules, eq, and } from "@repo/db";
import type { Extraction } from "./extraction";

/**
 * Procedural rules (spec 02 §2) — the standing "always/never" instructions a
 * memory can carry ("run drafts past me before posting"). At most one per
 * source memory, matched at turn time by retrieval/rule-matcher.
 */

/**
 * Upsert the one procedural rule a source memory can derive. Retry-safe.
 *
 * Immutability: if a rule already exists for this sourceMemory, leave it alone.
 * Never UPDATE ruleText/triggerText — that would let re-ingestion overwrite a
 * user correction or a carefully extracted row (P1 review: edit-as-correction
 * pre-inserts the rule then enqueues ingestion). Text changes go through
 * edit-as-correction supersession, not in-place mutation.
 */
export async function upsertStandingRule(params: {
  userId: string;
  memoryId: string;
  standingRule: Extraction["standingRule"];
  triggerEmbedding: number[];
}): Promise<void> {
  const { userId, memoryId, standingRule, triggerEmbedding } = params;
  if (!standingRule) return;

  const [existing] = await db
    .select({ id: rules.id })
    .from(rules)
    .where(and(eq(rules.userId, userId), eq(rules.sourceMemory, memoryId)))
    .limit(1);

  if (existing) return;

  await db.insert(rules).values({
    userId,
    sourceMemory: memoryId,
    ruleText: standingRule.ruleText.trim(),
    triggerText: standingRule.triggerText.trim(),
    triggerEmbedding: triggerEmbedding.length ? triggerEmbedding : null,
  });
}
