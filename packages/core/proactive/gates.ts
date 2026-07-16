/**
 * Deterministic proactive gates (spec 02 §5.4).
 *
 * Pure functions — no LLM, no I/O. Callers pass pre-fetched ledger/budget
 * state. Executed in order g1 → g5. This module is the anti-scenario engine:
 * when in doubt, suppress and log (suppressed_reason on the ledger).
 *
 * INVARIANT (spec 02 §2.4): every ledger / budget / cooldown query that *feeds*
 * these gates MUST filter `suppressed_reason IS NULL`. Suppressed rows never
 * count as real surfacings.
 */

/** Content kinds enabled in P2. Pattern/absence are inference-grade (P5/P6). */
export const P2_ENABLED_KINDS = new Set(["loop_nudge", "date_nudge"]);

/** Lookup-grade kinds that need ≥1 receipt (spec 02 §5.4 gate 4). */
export const LOOKUP_KINDS = new Set([
  "loop_nudge",
  "date_nudge",
  "edge_nudge",
  "rule_applied",
]);

/** Cooldown after an `ignored` reaction (days). */
export const IGNORED_COOLDOWN_DAYS = 30;

export type Seam = "open" | "mid_task";
export type Channel = "conversation" | "push" | "chip";

export type SuppressedReason =
  | "ledger_dismissed"
  | "ledger_ignored_cooldown"
  | "ledger_engaged_no_new_evidence"
  | "already_known"
  | "mid_task"
  | "evidence_insufficient"
  | "kind_not_enabled"
  | "budget_conversation"
  | "budget_daily"
  | "quiet_hours";

/**
 * A gate-approved or gate-evaluated nudge candidate. Shape matches the
 * awareness-pass output (spec 02 §5.4).
 */
export interface NudgeCandidate {
  kind: string;
  subjectType: string;
  subjectId: string;
  oneLineNudge: string;
  evidence: string[];
  confidence: number;
  /**
   * When set, this candidate is already a pending ledger row (e.g. a
   * prospection-queued conversation delivery). On approve, reuse this id
   * instead of inserting a second row.
   */
  existingSurfacingId?: string | null;
}

/** Non-suppressed ledger history for one subject (caller filters). */
export interface LedgerEntry {
  reaction: string | null;
  shownAt: Date;
  evidence: string[];
}

export interface GateInput {
  candidate: NudgeCandidate;
  /** Non-suppressed history for this subject (any channel). */
  subjectLedger: LedgerEntry[];
  /** User mentioned the subject themselves in the last 48h. */
  alreadyKnown: boolean;
  seam: Seam;
  channel: Channel;
  /**
   * Count of non-suppressed, non-`rule_applied` surfacings already attached to
   * this conversation. Cap is 1 (spec 02 §5.4).
   */
  conversationNudgeCount: number;
  /**
   * Count of non-suppressed, non-`rule_applied` surfacings shown today across
   * ALL channels. Cap is `maxDailySurfacings`.
   */
  dailySurfacingCount: number;
  maxDailySurfacings: number;
  /** Local quiet hours; only blocks `channel === 'push'`. */
  inQuietHours: boolean;
  now: Date;
  /**
   * Prospection / push path has no conversational seam — skip gate 3.
   * Default false (in-conversation awareness pass).
   */
  skipSeamGate?: boolean;
}

export type GateOutcome =
  | { decision: "approve" }
  | { decision: "suppress"; reason: SuppressedReason }
  | { decision: "hold"; reason: "mid_task" };

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Individual gates (exported for exhaustive unit tests)
// ---------------------------------------------------------------------------

/**
 * g1 Ledger — same subject reaction history.
 * - dismissed ever → suppress forever (until the USER re-mentions; that is
 *   handled by the caller clearing / by already-known + new engagement path)
 * - ignored → 30-day cooldown from last ignore
 * - engaged → allowed again only when evidence contains an id not previously
 *   used for this subject
 */
export function gateLedger(
  candidate: NudgeCandidate,
  subjectLedger: LedgerEntry[],
  now: Date,
): GateOutcome | null {
  // Dismissed ever → forever.
  if (subjectLedger.some((e) => e.reaction === "dismissed")) {
    return { decision: "suppress", reason: "ledger_dismissed" };
  }

  // Most recent ignored within cooldown window.
  const lastIgnored = subjectLedger
    .filter((e) => e.reaction === "ignored")
    .sort((a, b) => b.shownAt.getTime() - a.shownAt.getTime())[0];
  if (lastIgnored) {
    const elapsed = now.getTime() - lastIgnored.shownAt.getTime();
    if (elapsed < IGNORED_COOLDOWN_DAYS * DAY_MS) {
      return { decision: "suppress", reason: "ledger_ignored_cooldown" };
    }
  }

  // Engaged previously: only re-surface with new evidence.
  const engagedEntries = subjectLedger.filter((e) => e.reaction === "engaged");
  if (engagedEntries.length > 0) {
    const priorEvidence = new Set(
      engagedEntries.flatMap((e) => e.evidence ?? []),
    );
    const hasNew = candidate.evidence.some((id) => !priorEvidence.has(id));
    if (!hasNew) {
      return { decision: "suppress", reason: "ledger_engaged_no_new_evidence" };
    }
  }

  return null;
}

/** g2 Already known — user mentioned the subject in the last 48h. */
export function gateAlreadyKnown(alreadyKnown: boolean): GateOutcome | null {
  if (alreadyKnown) {
    return { decision: "suppress", reason: "already_known" };
  }
  return null;
}

/**
 * g3 Seam — mid_task HOLDs the candidate (persists for conversation end /
 * prospection); never silently drops. open → pass.
 */
export function gateSeam(seam: Seam): GateOutcome | null {
  if (seam === "mid_task") {
    return { decision: "hold", reason: "mid_task" };
  }
  return null;
}

/**
 * g4 Evidence threshold + phase enablement.
 * P2: only loop_nudge / date_nudge; each needs ≥1 receipt.
 * pattern/absence (and any other non-enabled kind) rejected outright.
 */
export function gateEvidence(candidate: NudgeCandidate): GateOutcome | null {
  if (!P2_ENABLED_KINDS.has(candidate.kind)) {
    return { decision: "suppress", reason: "kind_not_enabled" };
  }
  if (LOOKUP_KINDS.has(candidate.kind) && candidate.evidence.length < 1) {
    return { decision: "suppress", reason: "evidence_insufficient" };
  }
  // Future: pattern needs ≥5 AND confidence ≥0.8 (P5). Not enabled here.
  return null;
}

/**
 * g5 Budget + quiet hours.
 * - ≤1 nudge per conversation (conversation channel only)
 * - ≤ maxDailySurfacings per day across ALL channels
 * - quiet hours block push only (not conversation, not chip)
 */
export function gateBudget(input: {
  channel: Channel;
  conversationNudgeCount: number;
  dailySurfacingCount: number;
  maxDailySurfacings: number;
  inQuietHours: boolean;
}): GateOutcome | null {
  const {
    channel,
    conversationNudgeCount,
    dailySurfacingCount,
    maxDailySurfacings,
    inQuietHours,
  } = input;

  if (channel === "conversation" && conversationNudgeCount >= 1) {
    return { decision: "suppress", reason: "budget_conversation" };
  }
  if (dailySurfacingCount >= maxDailySurfacings) {
    return { decision: "suppress", reason: "budget_daily" };
  }
  if (channel === "push" && inQuietHours) {
    return { decision: "suppress", reason: "quiet_hours" };
  }
  return null;
}

/**
 * Run gates g1–g5 in order. First non-null outcome wins.
 * `hold` (mid_task) stops the chain the same way suppress does — the
 * orchestrator decides whether to log it.
 */
export function runGates(input: GateInput): GateOutcome {
  const g1 = gateLedger(input.candidate, input.subjectLedger, input.now);
  if (g1) return g1;

  const g2 = gateAlreadyKnown(input.alreadyKnown);
  if (g2) return g2;

  if (!input.skipSeamGate) {
    const g3 = gateSeam(input.seam);
    if (g3) return g3;
  }

  const g4 = gateEvidence(input.candidate);
  if (g4) return g4;

  const g5 = gateBudget({
    channel: input.channel,
    conversationNudgeCount: input.conversationNudgeCount,
    dailySurfacingCount: input.dailySurfacingCount,
    maxDailySurfacings: input.maxDailySurfacings,
    inQuietHours: input.inQuietHours,
  });
  if (g5) return g5;

  return { decision: "approve" };
}

// ---------------------------------------------------------------------------
// Pure helpers used by awareness / prospection / tests
// ---------------------------------------------------------------------------

/**
 * Whether `now` falls inside the user's quiet hours window (local clock).
 * Quiet hours may cross midnight (default 22:00–08:00).
 *
 * `start` / `end` are `HH:MM` or `HH:MM:SS` strings (Postgres `time` wire form).
 */
export function isInQuietHours(
  now: Date,
  timezone: string,
  start: string,
  end: string,
): boolean {
  const localMinutes = localMinutesOfDay(now, timezone);
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin === null || endMin === null || localMinutes === null) {
    return false;
  }
  // Window that does not cross midnight: [start, end)
  if (startMin < endMin) {
    return localMinutes >= startMin && localMinutes < endMin;
  }
  // Window that crosses midnight: [start, 24h) ∪ [0, end)
  if (startMin > endMin) {
    return localMinutes >= startMin || localMinutes < endMin;
  }
  // start === end → empty window
  return false;
}

/** Minutes since local midnight for `date` in `timezone`, or null on bad tz. */
export function localMinutesOfDay(date: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

/** Local calendar date YYYY-MM-DD in the given timezone. */
export function localDateString(date: Date, timezone: string): string {
  try {
    // en-CA yields YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Parse "HH:MM" / "HH:MM:SS" → minutes since midnight. */
export function parseTimeToMinutes(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Cheap prep-type classifier for open-loop titles (spec 02 §3.3).
 * Prep events surface at T-3; plain events at T-1.
 */
export function isPrepTypeTitle(title: string): boolean {
  return /\b(interview|exam|presentation|orals?|defense|demo day|midterm|final exam)\b/i.test(
    title,
  );
}

/**
 * Whole calendar days from `now`'s local date to `dueAt`'s local date in tz.
 * Positive = due in the future. 0 = due today. Negative = overdue.
 */
export function localDaysUntil(
  dueAt: Date,
  now: Date,
  timezone: string,
): number {
  const due = localDateString(dueAt, timezone);
  const today = localDateString(now, timezone);
  // Parse as UTC midnight to get a stable day delta.
  const dueMs = Date.parse(`${due}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  return Math.round((dueMs - todayMs) / DAY_MS);
}

/** Common words that must not alone trigger already-known (gate 2). */
const ALREADY_KNOWN_STOPWORDS = new Set([
  "with",
  "from",
  "about",
  "this",
  "that",
  "have",
  "will",
  "your",
  "want",
  "need",
  "plan",
  "meeting",
  "interview",
  "backend",
  "frontend",
  "javascript",
  "typescript",
  "python",
]);

/**
 * Build ILIKE patterns for the already-known gate. Pure helper.
 * Entity: full name only. Loop: multi-token distinctive phrases — never a
 * single common token like "backend".
 */
export function buildAlreadyKnownPatterns(
  needle: string,
  isEntity: boolean,
): string[] {
  const cleaned = needle.trim();
  if (cleaned.length < 3) return [];

  if (isEntity) {
    return [cleaned];
  }

  const tokens = cleaned
    .split(/[\s,.—–/:;!?()[\]"']+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);

  const significant = tokens.filter(
    (t) => t.length >= 5 && !ALREADY_KNOWN_STOPWORDS.has(t.toLowerCase()),
  );

  if (significant.length >= 2) {
    return [
      `${significant[0]}%${significant[1]}`,
      significant.slice(0, 2).join(" "),
    ];
  }

  if (significant.length === 1 && significant[0]!.length >= 8) {
    return [significant[0]!];
  }

  if (cleaned.length >= 16) {
    return [cleaned.slice(0, 40)];
  }
  return [];
}

/**
 * Hard-block mid_task seam when the turn looks like a code/debug dump,
 * regardless of model judgment (spec 03 open question #1; P2 acceptance).
 */
export function hardBlockMidTask(userTurn: string): boolean {
  const t = userTurn;
  // Fenced code block
  if (/```/.test(t)) return true;
  // Common stack-trace / exception fingerprints
  if (
    /^\s*at\s+\S+/m.test(t) ||
    /\b(TypeError|ReferenceError|SyntaxError|RangeError|Error):\s/i.test(t) ||
    /\bException\b/.test(t) ||
    /\bTraceback \(most recent call last\)/.test(t) ||
    /\bStack Trace\b/i.test(t) ||
    /\bFATAL EXCEPTION\b/i.test(t)
  ) {
    return true;
  }
  return false;
}
