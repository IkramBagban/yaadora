import {
  getFollowUpLoopCandidates,
  getAbsenceCandidates,
  getRaisingHistoryForSubjects,
  getSinceThenForEntity,
  type FollowUpLoopRow,
  type AbsenceCandidateRow,
  type RaisingHistoryEntry,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import { embedText } from "../ai/models";
import {
  loadUserBudgetSettings,
  countDailySurfacings,
} from "../proactive/candidates";

const log = createLogger("retrieval:follow-ups");

/**
 * Follow-up threads & absence — candidate assembly (spec 04 §3.3).
 *
 * The mirror of P5's `selectObservation`, generalized: this builds DOSSIERS,
 * not directives. A dossier is CONTEXT the model reasons over fresh each turn —
 * the original moment, what's happened since, and the complete raising history
 * with reactions — never a script or a stored one-liner.
 *
 * Design principle (spec 04, non-negotiable): CODE decides what may NOT be
 * raised; the MODEL decides what IS raised. So the only hard rules here are the
 * unambiguous ones:
 *  - dismissed-ever → excluded, permanently (enforced in SQL NOT EXISTS);
 *  - daily surfacing budget spent → empty result;
 *  - Insights toggle off → excludes ONLY absence (inference-grade); dated/undated
 *    threads remain (lookup-grade — the user TOLD us the thing);
 *  - cap 3 dossiers/turn; cap 6 `sinceThen` items each.
 * Everything else is ranking (selection pressure, not suppression): a low rank
 * means "not among today's three", NEVER "never". Recently-raised subjects rank
 * low mechanically but are still offered, because the model can see the history
 * and judge — the no-cadence-rule decision (spec 04 §1).
 */

/** Cap of dossiers offered per turn (context cost, spec 04 §3.3). */
export const FOLLOWUP_DOSSIER_CAP = 3;
/** Cap of "what's happened since" items per dossier. */
export const SINCE_THEN_CAP = 6;
/**
 * A subject raised within this window ranks low (but is NOT excluded). "Asked
 * twice in two days is almost never right" — the model sees exactly that from
 * the history; this only pushes it down the ranking (spec 04 §3.3).
 */
export const RECENTLY_RAISED_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dossier subject: an open loop (thread/commitment/…) or an entity (absence). */
export type FollowUpSubjectType = "open_loop" | "entity";
/** Dossier kind carried into the `onYourMind` pack section (spec 04 §3.4). */
export type FollowUpDossierKind = "followup" | "absence";

export interface SinceThenItem {
  id: string;
  snippet: string;
}

export interface RaisingHistoryItem {
  shownAt: Date;
  channel: string;
  reaction: string | null;
}

/**
 * A follow-up dossier (spec 04 §3.3). Context, not a directive. `receipts` are
 * the memory ids shown as sources; `sinceThen` is "what's happened since";
 * `raisingHistory` is every prior non-suppressed raise with the user's reaction.
 */
export interface FollowUpDossier {
  subjectType: FollowUpSubjectType;
  subjectId: string;
  /** onYourMind dossier kind — 'followup' for loops, 'absence' for entities. */
  kind: FollowUpDossierKind;
  summary: string;
  originatedAt: Date;
  dueAt: Date | null;
  receipts: string[];
  sinceThen: SinceThenItem[];
  raisingHistory: RaisingHistoryItem[];
  /** Ranking score (exposed for tests / tracing). Higher = more likely today. */
  score: number;
}

// ---------------------------------------------------------------------------
// Ranking — pure and unit-testable (spec 04 §3.3 heuristics).
// ---------------------------------------------------------------------------

export interface RankSignals {
  /** 0.6–1.0 for dated-and-passed, 0.1–0.55 for undated threads, ~0.3 absence. */
  ripeness: number;
  /** 0..1, 1 = most relevant to this turn (from embedding distance). */
  relevance: number;
  /** Raised within RECENTLY_RAISED_DAYS — ranks low, never excluded. */
  recentlyRaised: boolean;
  /** Absence is the weakest signal (a MISSING memory) — down-weighted. */
  isAbsence: boolean;
}

/**
 * Combine ranking signals into a score. On the FIRST turn of a conversation a
 * friend asks "how was the exam?" as the opener, so ripeness outranks relevance;
 * mid-conversation, relevance leads (a related turn pulls its thread up). A
 * recently-raised subject is multiplicatively demoted but never zeroed — the
 * model still sees it and its history and decides.
 */
export function scoreDossier(s: RankSignals, firstTurn: boolean): number {
  const base = firstTurn
    ? 0.7 * s.ripeness + 0.3 * s.relevance
    : 0.4 * s.ripeness + 0.6 * s.relevance;
  let score = base;
  if (s.isAbsence) score *= 0.8;
  if (s.recentlyRaised) score *= 0.3;
  return score;
}

/** Ripeness for a loop candidate (spec 04 §3.3). Dated-and-passed ranks
 * highest from dueAt+2h, decaying slowly; undated threads sit lower and decay
 * as they age unraised. Kept in disjoint bands so a dated check-in always
 * outranks an undated thread of equal relevance. */
export function loopRipeness(row: FollowUpLoopRow, now: Date): number {
  if (row.dueAt) {
    const daysSinceDue = (now.getTime() - row.dueAt.getTime()) / DAY_MS;
    return clamp(1 - daysSinceDue / 28, 0.6, 1);
  }
  const daysSinceCreated = (now.getTime() - row.createdAt.getTime()) / DAY_MS;
  return clamp(0.55 - daysSinceCreated / 60, 0.1, 0.55);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function relevanceFromDistance(distance: number | null): number {
  if (distance == null || !Number.isFinite(distance)) return 0.4; // neutral
  return clamp(1 - distance, 0, 1);
}

function raisedRecently(history: RaisingHistoryItem[], now: Date): boolean {
  return history.some(
    (h) => now.getTime() - h.shownAt.getTime() < RECENTLY_RAISED_DAYS * DAY_MS,
  );
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface SelectFollowUpsParams {
  userId: string;
  userTurn: string;
  conversationId?: string | null;
  now?: Date;
  /** True when this is the first turn of the conversation (ripeness leads). */
  isFirstTurn?: boolean;
}

/**
 * Select up to 3 follow-up dossiers for this turn. Fully guarded (budget,
 * dismissal in SQL, insights toggle for absence, caps). Never throws — a failure
 * means "no follow-ups this turn" (silence is the safe default, spec 01 §2).
 */
export async function selectFollowUps(
  params: SelectFollowUpsParams,
): Promise<FollowUpDossier[]> {
  const { userId, userTurn, isFirstTurn = false } = params;
  const now = params.now ?? new Date();

  try {
    const settings = await loadUserBudgetSettings(userId);
    // Budget spent → nothing more enters context this day (spec 04 anti-cases).
    const dailyCount = await countDailySurfacings(userId, settings.timezone, now);
    if (dailyCount >= settings.maxDailySurfacings) return [];

    // Turn embedding drives relevance ranking; empty is tolerated (neutral).
    let turnEmbedding: number[] = [];
    const turn = userTurn.trim();
    if (turn.length >= 3) {
      try {
        const { embedding } = await embedText(turn);
        turnEmbedding = embedding ?? [];
      } catch (err) {
        log.warn("follow-up turn embedding failed; ranking without relevance", err as Error);
      }
    }

    const [loops, absence] = await Promise.all([
      getFollowUpLoopCandidates({ userId, now, turnEmbedding }),
      getAbsenceCandidates({ userId, now }),
    ]);

    // Insights toggle governs ONLY absence (inference-grade). Threads remain —
    // the user explicitly told us those (lookup-grade).
    const absenceCandidates = settings.insightsEnabled ? absence : [];

    // Fetch raising history for every candidate subject in one query (used both
    // for ranking demotion and for the dossier itself).
    const loopIds = loops.map((l) => l.id);
    const entityIds = absenceCandidates.map((a) => a.entityId);
    const historyRows = await getRaisingHistoryForSubjects(userId, [
      ...loopIds,
      ...entityIds,
    ]);
    const historyBySubject = groupHistory(historyRows);

    // Rank all candidates together, then take the top 3.
    type Ranked = {
      row: FollowUpLoopRow | AbsenceCandidateRow;
      isAbsence: boolean;
      score: number;
      history: RaisingHistoryItem[];
    };
    const ranked: Ranked[] = [];

    for (const l of loops) {
      const history = historyBySubject.get(l.id) ?? [];
      const score = scoreDossier(
        {
          ripeness: loopRipeness(l, now),
          relevance: relevanceFromDistance(l.distance),
          recentlyRaised: raisedRecently(history, now),
          isAbsence: false,
        },
        isFirstTurn,
      );
      ranked.push({ row: l, isAbsence: false, score, history });
    }
    for (const a of absenceCandidates) {
      const history = historyBySubject.get(a.entityId) ?? [];
      const score = scoreDossier(
        {
          ripeness: 0.3,
          relevance: 0.4, // absence has no turn embedding — neutral
          recentlyRaised: raisedRecently(history, now),
          isAbsence: true,
        },
        isFirstTurn,
      );
      ranked.push({ row: a, isAbsence: true, score, history });
    }

    ranked.sort((x, y) => y.score - x.score);
    const top = ranked.slice(0, FOLLOWUP_DOSSIER_CAP);

    // Hydrate the chosen few with receipts + "what's happened since".
    const dossiers: FollowUpDossier[] = [];
    for (const r of top) {
      if (r.isAbsence) {
        const a = r.row as AbsenceCandidateRow;
        // Absence "receipts" are the last places the entity came up — where the
        // user can tap to see who we mean. `sinceThen` is empty by definition.
        const lastMentions = await getSinceThenForEntity({
          userId,
          entityId: a.entityId,
          since: new Date(0),
          limit: 3,
        }).catch(() => []);
        dossiers.push({
          subjectType: "entity",
          subjectId: a.entityId,
          kind: "absence",
          summary: absenceSummary(a),
          originatedAt: a.lastMentionAt ?? now,
          dueAt: null,
          receipts: lastMentions.map((m) => m.id),
          sinceThen: [],
          raisingHistory: r.history,
          score: r.score,
        });
      } else {
        const l = r.row as FollowUpLoopRow;
        let sinceThen: SinceThenItem[] = [];
        if (l.entityId) {
          const since = await getSinceThenForEntity({
            userId,
            entityId: l.entityId,
            since: l.createdAt,
            excludeMemoryId: l.sourceMemory,
            limit: SINCE_THEN_CAP,
          }).catch(() => []);
          sinceThen = since.map((m) => ({ id: m.id, snippet: m.snippet }));
        }
        dossiers.push({
          subjectType: "open_loop",
          subjectId: l.id,
          kind: "followup",
          summary: l.title,
          originatedAt: l.createdAt,
          dueAt: l.dueAt,
          receipts: [l.sourceMemory],
          sinceThen,
          raisingHistory: r.history,
          score: r.score,
        });
      }
    }
    return dossiers;
  } catch (err) {
    log.warn("selectFollowUps failed; no follow-ups this turn", err as Error);
    return [];
  }
}

function groupHistory(
  rows: RaisingHistoryEntry[],
): Map<string, RaisingHistoryItem[]> {
  const out = new Map<string, RaisingHistoryItem[]>();
  for (const r of rows) {
    const arr = out.get(r.subjectId) ?? [];
    arr.push({ shownAt: r.shownAt, channel: r.channel, reaction: r.reaction });
    out.set(r.subjectId, arr);
  }
  return out;
}

/** "X hasn't come up since <Month Year>" — the absence dossier summary. */
export function absenceSummary(a: AbsenceCandidateRow): string {
  if (!a.lastMentionAt) return `${a.name} hasn't come up in a long while`;
  const when = a.lastMentionAt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return `${a.name} hasn't come up since ${when}`;
}
