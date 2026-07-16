import {
  db,
  rules,
  memories,
  eq,
  and,
  isNull,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { embedText } from "../ai/models";
import { enqueueIngestion } from "../queues";

const log = createLogger("retrieval:rule-edit");

/**
 * Edit-as-correction for standing rules (spec 02 §2.2, §8).
 *
 * NEVER mutates the old rule's text. Inserts a new memory (source 'manual'),
 * creates a new rule row with a fresh trigger embedding, then supersedes the
 * old row (superseded_by → new id, active = false). Immutability + provenance.
 *
 * Writes run in one transaction so a partial failure cannot leave two active
 * rules. Only head rules (`superseded_by IS NULL`) can be corrected.
 */

export interface RuleEditInput {
  userId: string;
  ruleId: string;
  ruleText?: string;
  triggerText?: string;
}

export interface RuleEditResult {
  oldRuleId: string;
  newRule: {
    id: string;
    ruleText: string;
    triggerText: string;
    active: boolean;
    sourceMemory: string;
    applyCount: number;
    lastAppliedAt: Date | null;
    createdAt: Date;
    supersededBy: string | null;
  };
  memoryId: string;
}

/**
 * Pure planning for the supersession chain — used by unit tests and the
 * write path. Returns null when the patch is a no-op (no text fields).
 */
export function planRuleCorrection(params: {
  oldRuleText: string;
  oldTriggerText: string;
  ruleText?: string;
  triggerText?: string;
}): { ruleText: string; triggerText: string; memoryRawText: string } | null {
  const nextRuleText = (params.ruleText ?? params.oldRuleText).trim();
  const nextTriggerText = (params.triggerText ?? params.oldTriggerText).trim();
  if (!nextRuleText || !nextTriggerText) return null;
  if (
    nextRuleText === params.oldRuleText.trim() &&
    nextTriggerText === params.oldTriggerText.trim()
  ) {
    return null;
  }
  return {
    ruleText: nextRuleText,
    triggerText: nextTriggerText,
    // Spec: "insert a NEW memory (the corrected rule text)".
    memoryRawText: nextRuleText,
  };
}

/**
 * Execute edit-as-correction. Returns null if the rule is missing/not owned,
 * already superseded, or the patch is a no-op.
 *
 * Throws if a concurrent edit already superseded the row between select and
 * the transactional update (optimistic lock).
 */
export async function editRuleAsCorrection(
  params: RuleEditInput,
): Promise<RuleEditResult | null> {
  const { userId, ruleId } = params;

  const [old] = await db
    .select({
      id: rules.id,
      ruleText: rules.ruleText,
      triggerText: rules.triggerText,
      active: rules.active,
      supersededBy: rules.supersededBy,
    })
    .from(rules)
    .where(and(eq(rules.id, ruleId), eq(rules.userId, userId)))
    .limit(1);

  // Missing, or already superseded — caller should not edit history rows.
  if (!old || old.supersededBy) return null;

  const plan = planRuleCorrection({
    oldRuleText: old.ruleText,
    oldTriggerText: old.triggerText,
    ruleText: params.ruleText,
    triggerText: params.triggerText,
  });
  if (!plan) return null;

  // Embed outside the transaction (network I/O).
  const { embedding } = await embedText(plan.triggerText);

  // Carry forward paused/active state so "Save correction" does not re-enable
  // a rule the user had paused.
  const nextActive = old.active;

  const result = await db.transaction(async (tx) => {
    const [memory] = await tx
      .insert(memories)
      .values({
        userId,
        rawText: plan.memoryRawText,
        source: "manual",
        status: "pending",
      })
      .returning({ id: memories.id });

    if (!memory) {
      throw new Error("Failed to insert correction memory for rule edit.");
    }

    const [created] = await tx
      .insert(rules)
      .values({
        userId,
        ruleText: plan.ruleText,
        triggerText: plan.triggerText,
        triggerEmbedding: embedding.length ? embedding : null,
        active: nextActive,
        sourceMemory: memory.id,
        applyCount: 0,
      })
      .returning({
        id: rules.id,
        ruleText: rules.ruleText,
        triggerText: rules.triggerText,
        active: rules.active,
        sourceMemory: rules.sourceMemory,
        applyCount: rules.applyCount,
        lastAppliedAt: rules.lastAppliedAt,
        createdAt: rules.createdAt,
        supersededBy: rules.supersededBy,
      });

    if (!created) {
      throw new Error("Failed to insert replacement rule.");
    }

    // Optimistic lock: only supersede if still a head rule.
    const superseded = await tx
      .update(rules)
      .set({
        active: false,
        supersededBy: created.id,
      })
      .where(
        and(
          eq(rules.id, old.id),
          eq(rules.userId, userId),
          isNull(rules.supersededBy),
        ),
      )
      .returning({ id: rules.id });

    if (!superseded.length) {
      // Concurrent correction won; roll back the whole transaction.
      throw new Error(
        "Rule was superseded by a concurrent edit; retry against the current head.",
      );
    }

    return {
      oldRuleId: old.id,
      newRule: created,
      memoryId: memory.id,
    };
  });

  // After commit: best-effort ingestion for facts/entities. upsertStandingRule
  // is insert-if-absent, so it will not overwrite the corrected rule text.
  try {
    await enqueueIngestion(result.memoryId);
  } catch (err) {
    log.warn("enqueue ingestion after rule edit failed (ignored)", err as Error);
  }

  log.info("rule edit-as-correction", {
    userId,
    oldRuleId: result.oldRuleId,
    newRuleId: result.newRule.id,
    memoryId: result.memoryId,
  });

  return result;
}
