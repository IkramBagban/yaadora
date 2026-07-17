import {
  getSurfaceablePatternInsights,
  type SurfaceablePatternRow,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { embedText } from "../ai/models";
import {
  loadUserBudgetSettings,
  countDailySurfacings,
} from "../proactive/candidates";
import type { ObservationSlot } from "./context-pack";

const log = createLogger("retrieval:observations");

/**
 * Pattern surfacing selection (spec 03 P5). Picks AT MOST ONE pattern insight to
 * offer the Ask agent as low-priority context, which the agent may weave into
 * its reply — or not (spec 01 D6: the brain proposes context, the voice
 * decides). This is the P5 design refinement: surfacing is context + prompting,
 * not a forced nudge through the gate stack. But suppression stays code+state —
 * every "must stay quiet" rule is enforced HERE as a filter on what may enter
 * context:
 *
 *  - insights toggle OFF (users.insightsEnabled=false) → nothing (inference-grade).
 *  - daily surfacing budget already spent → nothing (patterns count toward it).
 *  - dismissed ever, or surfaced (non-suppressed) within the recent window →
 *    excluded in the query so it can never re-enter context.
 *  - below the strict bar (≥5 receipts AND confidence ≥0.8, spec 02 §5.4) →
 *    excluded here.
 *  - not relevant to THIS turn (embedding distance above threshold) → excluded,
 *    so patterns only appear when they fit what the user is actually discussing.
 *
 * Returns null in the overwhelmingly common case. When it returns a slot, the
 * agent has NOT yet surfaced anything — the ledger row is written only if the
 * agent actually raises it, via the note_observation tool.
 */

/** Strict surfacing bar (spec 02 §5.4 P5 thresholds). */
export const PATTERN_MIN_RECEIPTS = 5;
export const PATTERN_MIN_CONFIDENCE = 0.8;
/**
 * Max cosine distance for "relevant to this turn". Patterns are only offered
 * when they genuinely relate to what the user is discussing; a loose match is
 * worse than silence here.
 */
export const PATTERN_MAX_DISTANCE = 0.55;
/** Don't re-offer a pattern surfaced within this window (repeat-suppression). */
export const PATTERN_RECENT_DAYS = 30;

/** Parse the "supported_by: id1, id2, ..." convention consolidation writes into
 * a pattern fact's object_text (multi-provenance until a join table exists). */
export function parsePatternReceipts(objectText: string | null): string[] {
  if (!objectText) return [];
  const m = objectText.match(/supported_by:\s*(.+)$/i);
  const list = (m?.[1] ?? objectText)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Array.from(new Set(list));
}

/** Apply the strict receipt/relevance bar to a candidate pool and pick the best. */
export function pickBestObservation(
  rows: SurfaceablePatternRow[],
): ObservationSlot | null {
  for (const r of rows) {
    if (r.confidence < PATTERN_MIN_CONFIDENCE) continue;
    if (r.distance > PATTERN_MAX_DISTANCE) continue;
    const receipts = parsePatternReceipts(r.objectText);
    if (receipts.length < PATTERN_MIN_RECEIPTS) continue;
    return { id: r.id, text: r.factText.trim(), receipts };
  }
  return null;
}

/**
 * Select the one pattern observation (if any) to place in this turn's context
 * pack. Fully guarded (toggle, budget, dismissal, recency, threshold,
 * relevance). Never throws — a failure means "no observation this turn".
 */
export async function selectObservation(params: {
  userId: string;
  userTurn: string;
  now?: Date;
}): Promise<ObservationSlot | null> {
  const { userId, userTurn } = params;
  const now = params.now ?? new Date();
  const turn = userTurn.trim();
  if (turn.length < 4) return null;

  try {
    const settings = await loadUserBudgetSettings(userId);
    // Inference-grade: silent when the user has turned Insights off (spec 03 P4).
    if (!settings.insightsEnabled) return null;
    // Patterns count toward the daily surfacing budget (spec 02 §5.4 gate 5).
    const dailyCount = await countDailySurfacings(userId, settings.timezone, now);
    if (dailyCount >= settings.maxDailySurfacings) return null;

    const { embedding } = await embedText(turn);
    if (!embedding.length) return null;

    const rows = await getSurfaceablePatternInsights({
      userId,
      turnEmbedding: embedding,
      minConfidence: PATTERN_MIN_CONFIDENCE,
      recentDays: PATTERN_RECENT_DAYS,
    });
    return pickBestObservation(rows);
  } catch (err) {
    log.warn("selectObservation failed; no observation this turn", err as Error);
    return null;
  }
}
