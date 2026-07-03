import { generateObject } from "ai";
import { z } from "zod";
import {
  db,
  facts,
  sql,
  eq,
  findSupersessionCandidates,
  type NewFact,
  type SupersessionCandidate,
} from "@repo/db";
import { ingestionModel } from "../ai/models";

/**
 * Contradiction / update detection (spec 02 §2.5).
 *
 * Before a new fact is stored, we look at currently-valid facts about the SAME
 * subject with a similar predicate/meaning (the candidate SQL lives in @repo/db)
 * and decide the relationship:
 *
 *   - duplicate → don't store twice; reinforce the existing fact's confidence.
 *   - update    → store the new fact AND supersede the old one (validTo +
 *                 supersededBy). Nothing is deleted — history stays queryable.
 *   - conflict  → same period, incompatible: keep BOTH, cross-flag via
 *                 conflicts_with so the app can ask "has this changed?".
 *   - unrelated → just insert.
 *
 * Cost discipline (spec 02 §9): candidates are gated by cosine distance, so most
 * facts skip the LLM classification entirely and go straight to a fresh insert.
 */

// Cosine-distance gate: above this the top candidate is clearly a different
// fact, so we don't spend a classification call — just insert.
const RELATED_DISTANCE = 0.28;

const RelationSchema = z.object({
  relation: z.enum(["duplicate", "update", "conflict", "unrelated"]),
  reason: z.string(),
});

const SYSTEM_PROMPT = `You reconcile a NEW atomic fact against an EXISTING fact about the same subject in a personal memory system. Classify their relationship:
- "duplicate": they state the same thing (the new one restates/re-observes the existing).
- "update": same attribute but the value CHANGED over time (e.g. "lives in Mumbai" → "lives in Pune"). The new fact supersedes the old.
- "conflict": they are incompatible for the SAME time period and cannot both be true (a contradiction, not a change over time).
- "unrelated": different attributes; both can stand.
Use the valid-from dates to distinguish an update (later value replaces earlier) from a conflict (same period, incompatible).`;

export interface ReconcileInput {
  userId: string;
  memoryId: string;
  /** the prepared fact row (embedding already set on it) */
  fact: NewFact;
  /** the fact embedding, 1536-d (same values as fact.embedding) */
  embedding: number[];
  /** resolved event time of the source memory (drives supersession validTo) */
  occurredAt: Date | null;
}

/**
 * Reconcile a new fact against history, then persist it. Returns the inserted
 * fact id, or null when it was a duplicate (merged into an existing row).
 */
export async function reconcileAndInsertFact(
  input: ReconcileInput,
): Promise<string | null> {
  const { userId, memoryId, fact, embedding, occurredAt } = input;

  const candidates = embedding.length
    ? await findSupersessionCandidates({
        userId,
        subjectId: fact.subjectId ?? null,
        embedding,
        predicate: fact.predicate ?? null,
        excludeMemory: memoryId,
        limit: 5,
      })
    : [];

  const top = candidates.find((c) => c.distance <= RELATED_DISTANCE);
  if (!top) return insertFresh(fact);

  const relation = await classifyRelation(fact, top);

  switch (relation) {
    case "duplicate": {
      // Reinforce, don't duplicate: nudge confidence up (capped at 1.0).
      await db
        .update(facts)
        .set({
          confidence: sql`LEAST(1.0, GREATEST(${facts.confidence}, ${fact.confidence ?? 0.7}::real) + 0.05)`,
        })
        .where(eq(facts.id, top.id));
      return null;
    }
    case "update": {
      const newId = await insertFresh(fact);
      // The old fact stopped being true when the new one began.
      const validTo = occurredAt ?? fact.validFrom ?? new Date();
      await db
        .update(facts)
        .set({ validTo, supersededBy: newId })
        .where(eq(facts.id, top.id));
      return newId;
    }
    case "conflict": {
      const newId = await insertFresh(fact);
      // Keep both; cross-flag so the app can surface the contradiction.
      await db.update(facts).set({ conflictsWith: top.id }).where(eq(facts.id, newId));
      await db.update(facts).set({ conflictsWith: newId }).where(eq(facts.id, top.id));
      return newId;
    }
    default:
      return insertFresh(fact);
  }
}

async function insertFresh(fact: NewFact): Promise<string> {
  const [row] = await db.insert(facts).values(fact).returning({ id: facts.id });
  return row!.id;
}

async function classifyRelation(
  fact: NewFact,
  cand: SupersessionCandidate,
): Promise<z.infer<typeof RelationSchema>["relation"]> {
  // Fast path: identical text is unambiguously a duplicate — skip the LLM call.
  if (fact.factText.trim().toLowerCase() === cand.factText.trim().toLowerCase()) {
    return "duplicate";
  }
  const fmt = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : "unknown");
  const { object } = await generateObject({
    model: ingestionModel,
    schema: RelationSchema,
    system: SYSTEM_PROMPT,
    prompt: `NEW fact: "${fact.factText}" (valid from ${fmt(fact.validFrom)})
EXISTING fact: "${cand.factText}" (valid from ${fmt(cand.validFrom)})`,
  });
  return object.relation;
}
