import { generateObject } from "ai";
import { z } from "zod";
import { createLogger } from "@repo/logger";
import { fastModel } from "../ai/models";
import {
  hardBlockMidTask,
  type NudgeCandidate,
  type Seam,
} from "./gates";

const log = createLogger("proactive:awareness");

/**
 * Awareness pass (spec 02 §5.4) — one fast-tier structured call per turn.
 *
 * HARD deadline 800 ms (Promise.race). On timeout → no nudge this turn.
 * Hard-blocks seam to mid_task when the turn contains a code block or stack
 * trace, regardless of model judgment.
 */

/** Spec deadline; miss → silence this turn. */
export const AWARENESS_DEADLINE_MS = 800;

/** Attachment the model may choose among (or none). */
export interface AwarenessAttachment {
  kind: "loop_nudge" | "date_nudge" | "edge_nudge" | "intention_nudge";
  subjectType: "open_loop" | "entity" | "entity_edge";
  subjectId: string;
  title: string;
  dueAt: string | null;
  evidence: string[];
  /** Optional pre-written one-liner (e.g. from prospection queue). */
  suggestedNudge?: string | null;
  /** Pending ledger row id when this is a queued prospection delivery. */
  existingSurfacingId?: string | null;
}

export interface AwarenessHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AwarenessPassInput {
  userTurn: string;
  /** Last ~6 turns, chronological (oldest first). */
  recentTurns: AwarenessHistoryTurn[];
  candidates: AwarenessAttachment[];
  /**
   * Pending conversation surfacings from the prior turn that may be marked
   * engaged if the user addresses them.
   */
  priorSurfacingIds: string[];
}

export interface AwarenessPassResult {
  candidate: NudgeCandidate | null;
  seam: Seam;
  engagedWithPrior: string | null;
  /** True when the fast call timed out or failed — silence this turn. */
  timedOut: boolean;
}

const AwarenessSchema = z.object({
  candidate: z
    .object({
      subjectId: z
        .string()
        .describe("subjectId of the chosen attachment, or empty if none"),
      oneLineNudge: z
        .string()
        .describe(
          "ONE concrete line a friend would say. No cliffhangers. Empty if none.",
        ),
      confidence: z.number().min(0).max(1),
    })
    .nullable()
    .describe("null when nothing should surface this turn"),
  seam: z
    .enum(["open", "mid_task"])
    .describe(
      "open = a friend would naturally interject; mid_task = user is deep in a task (debugging, drafting code, frantic) — hold the nudge",
    ),
  engagedWithPrior: z
    .string()
    .nullable()
    .describe(
      "If the user's current turn addresses a prior nudge (ids listed), return that surfacing id; else null",
    ),
});

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildPrompt(input: AwarenessPassInput): string {
  const history = input.recentTurns
    .slice(-6)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${clip(t.content, 400)}`)
    .join("\n");

  const attachments =
    input.candidates.length === 0
      ? "(none)"
      : input.candidates
          .map((c, i) => {
            const due = c.dueAt ? ` due=${c.dueAt}` : "";
            const hint = c.suggestedNudge
              ? ` suggested="${clip(c.suggestedNudge, 120)}"`
              : "";
            return `${i + 1}. subjectId=${c.subjectId} kind=${c.kind} type=${c.subjectType} "${clip(c.title, 160)}"${due}${hint} evidence=[${c.evidence.join(",")}]`;
          })
          .join("\n");

  const priors =
    input.priorSurfacingIds.length === 0
      ? "(none)"
      : input.priorSurfacingIds.join(", ");

  return `Current user turn:
${clip(input.userTurn, 1500)}

Recent conversation (oldest first):
${history || "(empty)"}

Candidate attachments the system may surface (pick at most ONE, or none):
${attachments}

Prior nudge surfacing ids from the last assistant turn (for engagement capture):
${priors}

Decide:
1. Is this a natural seam for a friend to interject (open) or is the user mid-task (mid_task)?
2. If open AND a candidate is genuinely useful right now, pick ONE by subjectId and write a single concrete one-line nudge (no cliffhangers, no "by the way…" padding). Prefer silence when the fit is weak. When a candidate has a suggested phrasing, prefer it.
3. If the user's turn clearly addresses a prior nudge, set engagedWithPrior to that id.

For an intention_nudge (kind=intention_nudge): this holds a PAST commitment up beside what the user is doing now. It MUST be phrased as an open QUESTION, never a judgment — acknowledge they may have deliberately changed their mind; never scold, never assume they've drifted. If you cannot phrase it as a genuine, non-accusatory question, stay silent.

Bias hard toward silence. Never invent candidates not in the list.`;
}

/**
 * Run the awareness model call (no deadline). Used by the deadline wrapper
 * and by tests that inject a mock.
 */
export async function runAwarenessModel(
  input: AwarenessPassInput,
): Promise<AwarenessPassResult> {
  // No candidates and no prior surfacings → skip the LLM entirely.
  if (input.candidates.length === 0 && input.priorSurfacingIds.length === 0) {
    const seam: Seam = hardBlockMidTask(input.userTurn) ? "mid_task" : "open";
    return { candidate: null, seam, engagedWithPrior: null, timedOut: false };
  }

  const { object } = await generateObject({
    model: fastModel,
    schema: AwarenessSchema,
    system:
      "You are the awareness sidecar for a personal second brain. You decide whether ONE small, evidence-backed nudge fits this conversational moment. Precision over recall: silence is the correct default. Never invent facts.",
    prompt: buildPrompt(input),
  });

  let seam: Seam = object.seam;
  // HARD-block mid_task when the turn is a code/stack dump (spec).
  if (hardBlockMidTask(input.userTurn)) {
    seam = "mid_task";
  }

  let engagedWithPrior: string | null = null;
  if (
    object.engagedWithPrior &&
    input.priorSurfacingIds.includes(object.engagedWithPrior)
  ) {
    engagedWithPrior = object.engagedWithPrior;
  }

  let candidate: NudgeCandidate | null = null;
  if (object.candidate?.subjectId && object.candidate.oneLineNudge?.trim()) {
    const match = input.candidates.find(
      (c) => c.subjectId === object.candidate!.subjectId,
    );
    if (match && match.evidence.length > 0) {
      candidate = {
        kind: match.kind,
        subjectType: match.subjectType,
        subjectId: match.subjectId,
        oneLineNudge: object.candidate.oneLineNudge.trim(),
        evidence: match.evidence,
        confidence: object.candidate.confidence,
        existingSurfacingId: match.existingSurfacingId ?? null,
      };
    }
  }

  // Even if the model picked something, mid_task hard-block keeps the
  // candidate so gates can HOLD it (not drop) for prospection fallthrough.
  return { candidate, seam, engagedWithPrior, timedOut: false };
}

/**
 * Awareness pass with the hard 800 ms deadline. On timeout or error →
 * silence (no nudge this turn); logs the miss.
 */
export async function runAwarenessPass(
  input: AwarenessPassInput,
  deadlineMs = AWARENESS_DEADLINE_MS,
): Promise<AwarenessPassResult> {
  const seamFallback: Seam = hardBlockMidTask(input.userTurn)
    ? "mid_task"
    : "open";

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<AwarenessPassResult>((resolve) => {
    timer = setTimeout(() => {
      log.warn("awareness pass timed out; no nudge this turn", {
        deadlineMs,
      });
      resolve({
        candidate: null,
        seam: seamFallback,
        engagedWithPrior: null,
        timedOut: true,
      });
    }, deadlineMs);
  });

  try {
    const result = await Promise.race([runAwarenessModel(input), timeout]);
    return result;
  } catch (err) {
    log.warn("awareness pass failed; no nudge this turn", err as Error);
    return {
      candidate: null,
      seam: seamFallback,
      engagedWithPrior: null,
      timedOut: false,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
