import { generateObject } from "ai";
import { z } from "zod";
import {
  db,
  rules,
  eq,
  and,
  sql,
  toVectorLiteral,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { embedText, fastModel } from "../ai/models";

const log = createLogger("retrieval:rule-matcher");

/**
 * Rules doorway matcher (spec 02 §5.1).
 *
 * Per turn, before the main agent starts:
 *  1. Embed the user turn (+ previous user turn for context) — one embedding call.
 *  2. Cosine against active rules' trigger_embedding; keep candidates > 0.45.
 *  3. If any: one fast-tier structured call confirms which rules' *situations*
 *     actually apply to *this task* (kills incidental platform mentions).
 *  4. Return matched rules, cap 3.
 *
 * Latency is overlapped with context-pack SQL via Promise.all in the agent.
 */

/** Cosine similarity threshold (spec 02 §5.1). */
export const RULE_SIMILARITY_THRESHOLD = 0.45;

/** Max rules injected into the pack / applied per turn (spec 02 §4 / §5.1). */
export const RULE_MATCH_CAP = 3;

/** A rule that survived embedding filter + optional confirm. */
export interface MatchedRule {
  id: string;
  ruleText: string;
  triggerText: string;
  sourceMemory: string;
  similarity: number;
}

/** Candidate after the embedding filter, before LLM confirm. */
export interface RuleCandidate {
  id: string;
  ruleText: string;
  triggerText: string;
  sourceMemory: string;
  similarity: number;
}

/**
 * Pure threshold + cap filter (unit-testable without DB/LLM).
 * Keeps candidates with similarity > threshold, sorted desc, capped.
 */
export function filterRuleCandidates(
  candidates: RuleCandidate[],
  threshold = RULE_SIMILARITY_THRESHOLD,
  cap = RULE_MATCH_CAP,
): RuleCandidate[] {
  return candidates
    .filter((c) => c.similarity > threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, Math.max(0, cap));
}

/**
 * Short human label for the live trace step
 * ("Applying your rule: <short name>").
 */
export function shortRuleName(rule: {
  triggerText: string;
  ruleText: string;
}): string {
  const source = (rule.triggerText || rule.ruleText).trim();
  if (!source) return "standing rule";
  const first = source.split(/[.;\n]/)[0]!.trim();
  if (first.length <= 48) return first;
  return `${first.slice(0, 45).trimEnd()}…`;
}

/** Build the one-shot embedding input for the turn (spec 02 §5.1). */
export function buildTurnEmbedText(
  userTurn: string,
  previousUserTurn?: string | null,
): string {
  const current = userTurn.trim();
  const prev = previousUserTurn?.trim();
  if (prev) {
    return `Previous user turn:\n${prev}\n\nCurrent user turn:\n${current}`;
  }
  return current;
}

const ConfirmSchema = z.object({
  ruleIds: z
    .array(z.string())
    .describe(
      "IDs of rules whose SITUATION actually applies to the user's current task. Empty if none apply.",
    ),
});

/**
 * Match active standing rules for this user turn.
 * Failures return [] so Ask never blocks on the matcher.
 */
export async function matchStandingRules(params: {
  userId: string;
  userTurn: string;
  previousUserTurn?: string | null;
}): Promise<MatchedRule[]> {
  const { userId, userTurn, previousUserTurn } = params;
  const turn = userTurn.trim();
  if (!turn) return [];

  try {
    const embedInput = buildTurnEmbedText(turn, previousUserTurn);
    const { embedding } = await embedText(embedInput);
    if (!embedding.length) return [];

    const vector = toVectorLiteral(embedding);
    const similarity = sql<number>`(1 - (${rules.triggerEmbedding} <=> ${vector}::vector))`;

    // Pull a slightly wider pool than the cap so the confirm step can pick
    // the right subset; pure filter still enforces threshold in SQL.
    const rows = await db
      .select({
        id: rules.id,
        ruleText: rules.ruleText,
        triggerText: rules.triggerText,
        sourceMemory: rules.sourceMemory,
        similarity,
      })
      .from(rules)
      .where(
        and(
          eq(rules.userId, userId),
          eq(rules.active, true),
          sql`${rules.triggerEmbedding} IS NOT NULL`,
          sql`(1 - (${rules.triggerEmbedding} <=> ${vector}::vector)) > ${RULE_SIMILARITY_THRESHOLD}`,
        ),
      )
      .orderBy(sql`${rules.triggerEmbedding} <=> ${vector}::vector`)
      .limit(10);

    const candidates: RuleCandidate[] = rows.map((r) => ({
      id: r.id,
      ruleText: r.ruleText,
      triggerText: r.triggerText,
      sourceMemory: r.sourceMemory,
      similarity: Number(r.similarity),
    }));

    // Threshold already applied in SQL; re-apply pure filter for safety + order.
    const filtered = filterRuleCandidates(candidates, RULE_SIMILARITY_THRESHOLD, 10);
    if (!filtered.length) return [];

    // Cap without confirm only if we somehow skip LLM — always confirm when
    // candidates exist (spec 02 §5.1 step 3).
    const confirmedIds = await confirmRuleSituations({
      userTurn: turn,
      previousUserTurn: previousUserTurn ?? null,
      candidates: filtered,
    });

    if (!confirmedIds.length) return [];

    const byId = new Map(filtered.map((c) => [c.id, c]));
    const matched: MatchedRule[] = [];
    for (const id of confirmedIds) {
      const c = byId.get(id);
      if (c) matched.push(c);
      if (matched.length >= RULE_MATCH_CAP) break;
    }

    // If the model returned ids out of similarity order, re-sort and re-cap.
    return filterRuleCandidates(matched, RULE_SIMILARITY_THRESHOLD, RULE_MATCH_CAP);
  } catch (err) {
    log.warn("rule matcher failed; continuing without rules", err as Error);
    return [];
  }
}

/**
 * Fast-tier confirm: which candidates' *situations* apply to THIS task.
 * Precision-first — incidental mentions must not fire.
 */
async function confirmRuleSituations(params: {
  userTurn: string;
  previousUserTurn: string | null;
  candidates: RuleCandidate[];
}): Promise<string[]> {
  const { userTurn, previousUserTurn, candidates } = params;
  if (!candidates.length) return [];

  const listing = candidates
    .map(
      (c, i) =>
        `[${i}] id=${c.id}\n  situation: ${c.triggerText}\n  rule: ${c.ruleText.slice(0, 280)}${c.ruleText.length > 280 ? "…" : ""}`,
    )
    .join("\n\n");

  const prevBlock = previousUserTurn
    ? `Previous user turn:\n"""\n${previousUserTurn}\n"""\n\n`
    : "";

  const { object } = await generateObject({
    model: fastModel,
    schema: ConfirmSchema,
    system:
      "You gate standing rules for a personal second-brain agent. A rule applies " +
      "ONLY when the user is currently doing (or asking for help with) the " +
      "situation the rule describes. Precision over recall.\n\n" +
      "FIRE when: the user is drafting/reviewing a post, asking whether to " +
      "publish, asking for feedback on a tweet/post/draft, or otherwise performing " +
      "the task the rule governs.\n\n" +
      "DO NOT FIRE when: the platform or topic is mentioned only incidentally " +
      "(e.g. company name 'X', 'which database should company X use?'), the user " +
      "is recalling past posting history, or the task is unrelated.\n\n" +
      "Return only rule ids that truly apply to THIS task. Empty array if none.",
    prompt: `${prevBlock}Current user turn:
"""
${userTurn}
"""

Candidate rules:
${listing}

Which rule ids' situations actually apply to this task?`,
  });

  const allowed = new Set(candidates.map((c) => c.id));
  return (object.ruleIds ?? []).filter((id) => allowed.has(id));
}
