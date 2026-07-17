import { generateObject } from "ai";
import { z } from "zod";
import { findCommitmentLoopCandidates } from "@repo/db";
import { createLogger } from "@repo/logger";
import { embedText, fastModel } from "../ai/models";
import type { AwarenessAttachment } from "./awareness";

const log = createLogger("proactive:intention");

/**
 * Held-intentions contradiction check (spec 03 P4, spec 01 D7 — the FIRST
 * inference-grade feature).
 *
 * A candidate is born when the current turn semantically CONFLICTS with an open
 * `commitment` loop (e.g. January "I'm done with consulting, going full-time on
 * product" vs. July "this consulting client offered 3 months, might take it").
 *
 * Two stages, precision-first (spec 01 §2 — "quiet and right over helpful and
 * wrong", a wrong confident inference destroys trust permanently):
 *   1. CHEAP PREFILTER — embed the turn, find open commitment loops within a
 *      proximity window. Proximity only means "same topic"; it is NOT tension.
 *   2. FAST-TIER CONFIRM — for the closest candidate(s), one structured call
 *      decides whether this is a GENUINE tension (the user is reconsidering /
 *      acting against the commitment) rather than a restatement, an unrelated
 *      match, or agreement. Conservative: no tension → no candidate.
 *
 * FRAMING IS THE FEATURE: the confirm also drafts the surface phrasing as an
 * open QUESTION ("Back in January you said you were done with consulting — has
 * that changed, or is this a runway thing?"). The never-judgment tone constraint
 * is *also* enforced in the weaving directive (context-pack renderNudge), so the
 * main agent cannot turn it into a scold even if this draft drifts.
 *
 * Evidence is ALWAYS the commitment's own source memory (≥1 receipt, gate 4).
 * Never throws — a failure means no intention candidate this turn (silence).
 */

/**
 * Embedding prefilter window (cosine distance; lower = closer). Deliberately
 * generous: proximity is only a cheap topic filter, and the fast-tier confirm
 * is the real precision gate. Too tight here would drop genuine tensions whose
 * wording differs from the commitment title.
 */
export const COMMITMENT_PROXIMITY_MAX_DISTANCE = 0.6;

/** How many nearest commitments to run the confirm over (cost bound). */
export const MAX_COMMITMENTS_TO_CONFIRM = 2;

const ContradictionSchema = z.object({
  isTension: z
    .boolean()
    .describe(
      "true ONLY if the current turn genuinely conflicts with / reconsiders / acts against the stated commitment. false for restatements, agreement, progress updates, or unrelated topics.",
    ),
  question: z
    .string()
    .describe(
      "If isTension: ONE open, non-judgmental question that names the commitment and asks whether it has changed. Never a scold, never assumes drift. Empty string if not a tension.",
    ),
});

const CONFIRM_SYSTEM = `You are the held-intentions check of a personal second brain. The user earlier made a COMMITMENT (a stated intention about how they'd act). You are given that commitment and the user's CURRENT message. Decide whether the current message is in genuine TENSION with the commitment — i.e. the user is now reconsidering it, leaning the other way, or about to act against it.

Return isTension = true ONLY for a real conflict. Return false when:
- the message merely restates or reaffirms the commitment,
- it reports progress consistent with it,
- it mentions the same topic but does not oppose the commitment,
- it is unrelated.

Precision over recall: when unsure, return false. A wrong flag erodes trust permanently.

When isTension = true, write ONE question the user's most thoughtful friend would ask: it names the earlier commitment, asks whether it has changed, and leaves room that this may be a deliberate, sensible update ("has that changed, or is this a runway thing?"). NEVER scold, NEVER imply they failed or drifted, NEVER lecture. If you cannot phrase a genuine, kind question, set isTension = false.`;

export interface DetectCommitmentContradictionsParams {
  userId: string;
  userTurn: string;
  /** Prior user turn for pronoun/topic context in the embedding (optional). */
  previousUserTurn?: string | null;
  now?: Date;
}

/**
 * Build at most ONE `intention_nudge` attachment for the turn (the awareness
 * pass still picks ≤1 candidate overall and applies the seam/budget gates).
 */
export async function detectCommitmentContradictions(
  params: DetectCommitmentContradictionsParams,
): Promise<AwarenessAttachment[]> {
  const turn = params.userTurn.trim();
  if (turn.length < 8) return [];

  try {
    // 1. Embed the turn (+ prior turn for context) and prefilter commitments.
    const embedInput = params.previousUserTurn?.trim()
      ? `${params.previousUserTurn.trim()}\n\n${turn}`
      : turn;
    const { embedding } = await embedText(embedInput);
    if (!embedding.length) return [];

    const candidates = await findCommitmentLoopCandidates(
      params.userId,
      embedding,
      COMMITMENT_PROXIMITY_MAX_DISTANCE,
      MAX_COMMITMENTS_TO_CONFIRM,
    );
    if (!candidates.length) return [];

    // 2. Fast-tier confirm genuine tension, nearest first. Take the first hit.
    for (const c of candidates) {
      const confirmed = await confirmTension({
        userTurn: turn,
        commitmentTitle: c.title,
      }).catch((err) => {
        log.warn("commitment tension confirm failed", err as Error);
        return null;
      });
      if (confirmed?.isTension && confirmed.question.trim()) {
        return [
          {
            kind: "intention_nudge",
            subjectType: "open_loop",
            subjectId: c.id,
            title: c.title,
            dueAt: null,
            // ALWAYS the commitment's source memory (gate 4: ≥1 receipt).
            evidence: [c.sourceMemory],
            suggestedNudge: confirmed.question.trim(),
          },
        ];
      }
    }
    return [];
  } catch (err) {
    log.warn("commitment contradiction detection failed; silent", err as Error);
    return [];
  }
}

async function confirmTension(params: {
  userTurn: string;
  commitmentTitle: string;
}): Promise<{ isTension: boolean; question: string }> {
  const { object } = await generateObject({
    model: fastModel,
    schema: ContradictionSchema,
    system: CONFIRM_SYSTEM,
    prompt: `Earlier commitment (what the user intended):
"""
${params.commitmentTitle}
"""

User's current message:
"""
${params.userTurn}
"""

Is the current message in genuine tension with the commitment? If so, draft the kind question.`,
  });
  return {
    isTension: Boolean(object.isTension),
    question: object.question ?? "",
  };
}
