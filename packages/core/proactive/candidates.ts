import {
  db,
  openLoops,
  entities,
  surfacings,
  conversationTurns,
  conversations,
  memories,
  memoryEntities,
  users,
  eq,
  and,
  isNull,
  sql,
  gte,
  desc,
  inArray,
} from "@repo/db";
import { createLogger } from "@repo/logger";
import type { AwarenessAttachment } from "./awareness";
import {
  isInQuietHours,
  isPrepTypeTitle,
  localDateString,
  localDaysUntil,
  runGates,
  type Channel,
  type GateOutcome,
  type LedgerEntry,
  type NudgeCandidate,
  type Seam,
} from "./gates";

const log = createLogger("proactive:candidates");

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const ALREADY_KNOWN_MS = 48 * 60 * 60 * 1000;

/**
 * Load awareness-pass attachments for a turn (spec 02 §5.4):
 *  (a) open loops due ≤7d without a non-suppressed ledger row this week
 *  (b) queued prospection deliveries (pending channel=conversation)
 *
 * Birthday / date candidates arrive via prospection queue or the loop path;
 * entity birthdays without a loop are scanned by prospection.
 */
export async function loadAwarenessCandidates(params: {
  userId: string;
  now?: Date;
}): Promise<AwarenessAttachment[]> {
  const now = params.now ?? new Date();
  const within = new Date(now.getTime() + 7 * DAY_MS);
  const weekAgo = new Date(now.getTime() - WEEK_MS);

  const [loops, queued, recentSubjects] = await Promise.all([
    db
      .select({
        id: openLoops.id,
        kind: openLoops.kind,
        title: openLoops.title,
        dueAt: openLoops.dueAt,
        sourceMemory: openLoops.sourceMemory,
      })
      .from(openLoops)
      .where(
        and(
          eq(openLoops.userId, params.userId),
          eq(openLoops.status, "open"),
          sql`${openLoops.dueAt} IS NOT NULL`,
          sql`${openLoops.dueAt} <= ${within.toISOString()}::timestamptz`,
        ),
      )
      .limit(30),
    // Queued prospection deliveries waiting for a conversational seam.
    db
      .select({
        id: surfacings.id,
        kind: surfacings.kind,
        subjectType: surfacings.subjectType,
        subjectId: surfacings.subjectId,
        evidence: surfacings.evidence,
      })
      .from(surfacings)
      .where(
        and(
          eq(surfacings.userId, params.userId),
          eq(surfacings.channel, "conversation"),
          isNull(surfacings.reaction),
          isNull(surfacings.suppressedReason),
          // Only "queued" ones not yet woven this session — pending reaction.
          // Shown within the last 2 days so stale rows fall to prospection.
          gte(surfacings.shownAt, new Date(now.getTime() - 2 * DAY_MS)),
        ),
      )
      .orderBy(desc(surfacings.shownAt))
      .limit(10),
    // Subjects already in a non-suppressed ledger row this week.
    db
      .select({
        subjectId: surfacings.subjectId,
      })
      .from(surfacings)
      .where(
        and(
          eq(surfacings.userId, params.userId),
          isNull(surfacings.suppressedReason),
          gte(surfacings.shownAt, weekAgo),
          sql`${surfacings.kind} != 'rule_applied'`,
        ),
      ),
  ]);

  const surfacedThisWeek = new Set(recentSubjects.map((r) => r.subjectId));
  const attachments: AwarenessAttachment[] = [];
  const seen = new Set<string>();

  // Queued deliveries first (prospection already gated them once).
  for (const q of queued) {
    if (seen.has(q.subjectId)) continue;
    if (q.kind !== "loop_nudge" && q.kind !== "date_nudge") continue;
    if (q.subjectType !== "open_loop" && q.subjectType !== "entity") continue;
    seen.add(q.subjectId);
    let title = q.subjectId;
    if (q.subjectType === "open_loop") {
      const loop = loops.find((l) => l.id === q.subjectId);
      title = loop?.title ?? title;
    } else {
      const [ent] = await db
        .select({ name: entities.canonicalName })
        .from(entities)
        .where(eq(entities.id, q.subjectId))
        .limit(1);
      title = ent ? `${ent.name}'s birthday` : title;
    }
    attachments.push({
      kind: q.kind as "loop_nudge" | "date_nudge",
      subjectType: q.subjectType as "open_loop" | "entity",
      subjectId: q.subjectId,
      title,
      dueAt: null,
      evidence: q.evidence ?? [],
      existingSurfacingId: q.id,
    });
  }

  for (const loop of loops) {
    if (seen.has(loop.id)) continue;
    if (surfacedThisWeek.has(loop.id)) continue;
    if (!loop.dueAt) continue;
    seen.add(loop.id);
    attachments.push({
      kind: "loop_nudge",
      subjectType: "open_loop",
      subjectId: loop.id,
      title: loop.title,
      dueAt: loop.dueAt.toISOString(),
      evidence: [loop.sourceMemory],
    });
  }

  return attachments;
}

/** Prior conversation nudge ids from the last assistant turn (for engagement). */
export async function loadPriorSurfacingIds(params: {
  userId: string;
  conversationId: string | null | undefined;
}): Promise<string[]> {
  if (!params.conversationId) return [];
  // Last assistant turn meta.surfacingIds, filtered to non-rule rows that are
  // still pending (reaction null, not suppressed).
  const [lastAssistant] = await db
    .select({ meta: conversationTurns.meta })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.conversationId, params.conversationId),
        eq(conversationTurns.role, "assistant"),
      ),
    )
    .orderBy(desc(conversationTurns.createdAt))
    .limit(1);

  const meta = lastAssistant?.meta as { surfacingIds?: string[] } | null;
  const ids = meta?.surfacingIds?.filter(Boolean) ?? [];
  if (ids.length === 0) return [];

  const rows = await db
    .select({ id: surfacings.id, kind: surfacings.kind })
    .from(surfacings)
    .where(
      and(
        eq(surfacings.userId, params.userId),
        isNull(surfacings.reaction),
        isNull(surfacings.suppressedReason),
        inArray(surfacings.id, ids),
        sql`${surfacings.kind} != 'rule_applied'`,
      ),
    );
  return rows.map((r) => r.id);
}

export async function loadSubjectLedger(
  userId: string,
  subjectId: string,
): Promise<LedgerEntry[]> {
  const rows = await db
    .select({
      reaction: surfacings.reaction,
      shownAt: surfacings.shownAt,
      evidence: surfacings.evidence,
    })
    .from(surfacings)
    .where(
      and(
        eq(surfacings.userId, userId),
        eq(surfacings.subjectId, subjectId),
        isNull(surfacings.suppressedReason),
      ),
    )
    .orderBy(desc(surfacings.shownAt))
    .limit(50);

  return rows.map((r) => ({
    reaction: r.reaction,
    shownAt: r.shownAt,
    evidence: r.evidence ?? [],
  }));
}

/**
 * True when the user themselves mentioned the subject in the last 48h
 * (memories.raw_text or user conversation turns) — gate 2.
 *
 * For open loops we match against the loop title keywords; for entities,
 * the canonical name. Conservative lexical match (no embedding).
 */
export async function userMentionedSubjectRecently(params: {
  userId: string;
  subjectType: string;
  subjectId: string;
  now?: Date;
}): Promise<boolean> {
  const now = params.now ?? new Date();
  const since = new Date(now.getTime() - ALREADY_KNOWN_MS);

  let needle: string | null = null;
  if (params.subjectType === "open_loop") {
    const [loop] = await db
      .select({ title: openLoops.title })
      .from(openLoops)
      .where(eq(openLoops.id, params.subjectId))
      .limit(1);
    needle = loop?.title ?? null;
  } else if (params.subjectType === "entity") {
    const [ent] = await db
      .select({ name: entities.canonicalName })
      .from(entities)
      .where(eq(entities.id, params.subjectId))
      .limit(1);
    needle = ent?.name ?? null;
  }
  if (!needle || needle.trim().length < 3) return false;

  // Use the most distinctive multi-word chunk (≥1 word of length ≥4) so we
  // don't false-positive on "the" / "with". Fall back to the full title.
  const tokens = needle
    .split(/[\s,.—–-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .slice(0, 4);
  const patterns = tokens.length > 0 ? tokens : [needle.slice(0, 40)];

  for (const p of patterns) {
    const like = `%${p.replace(/[%_]/g, "")}%`;
    const [memHit] = await db
      .select({ id: memories.id })
      .from(memories)
      .where(
        and(
          eq(memories.userId, params.userId),
          gte(memories.createdAt, since),
          sql`${memories.rawText} ILIKE ${like}`,
        ),
      )
      .limit(1);
    if (memHit) return true;

    const [turnHit] = await db
      .select({ id: conversationTurns.id })
      .from(conversationTurns)
      .where(
        and(
          eq(conversationTurns.userId, params.userId),
          eq(conversationTurns.role, "user"),
          gte(conversationTurns.createdAt, since),
          sql`${conversationTurns.content} ILIKE ${like}`,
        ),
      )
      .limit(1);
    if (turnHit) return true;
  }
  return false;
}

export async function countConversationNudges(
  userId: string,
  conversationId: string | null | undefined,
): Promise<number> {
  if (!conversationId) return 0;
  const rows = await db
    .select({ id: surfacings.id })
    .from(surfacings)
    .where(
      and(
        eq(surfacings.userId, userId),
        eq(surfacings.conversationId, conversationId),
        isNull(surfacings.suppressedReason),
        sql`${surfacings.kind} != 'rule_applied'`,
      ),
    );
  return rows.length;
}

export async function countDailySurfacings(
  userId: string,
  timezone: string,
  now: Date,
): Promise<number> {
  // Count non-suppressed non-rule surfacings whose shown_at falls on the
  // user's local calendar day.
  const localDay = localDateString(now, timezone);
  // Approximate: use UTC day window expanded ±1 day then filter in JS for
  // correctness across tz edges without a heavy SQL timezone dance.
  const windowStart = new Date(now.getTime() - 36 * 60 * 60 * 1000);
  const rows = await db
    .select({ shownAt: surfacings.shownAt })
    .from(surfacings)
    .where(
      and(
        eq(surfacings.userId, userId),
        isNull(surfacings.suppressedReason),
        sql`${surfacings.kind} != 'rule_applied'`,
        gte(surfacings.shownAt, windowStart),
      ),
    );
  return rows.filter(
    (r) => localDateString(r.shownAt, timezone) === localDay,
  ).length;
}

export async function loadUserBudgetSettings(userId: string): Promise<{
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  maxDailySurfacings: number;
}> {
  const [u] = await db
    .select({
      timezone: users.timezone,
      quietHoursStart: users.quietHoursStart,
      quietHoursEnd: users.quietHoursEnd,
      maxDailySurfacings: users.maxDailySurfacings,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return {
    timezone: u?.timezone ?? "UTC",
    // drizzle time columns come back as "HH:MM:SS" strings
    quietHoursStart: String(u?.quietHoursStart ?? "22:00:00"),
    quietHoursEnd: String(u?.quietHoursEnd ?? "08:00:00"),
    maxDailySurfacings: u?.maxDailySurfacings ?? 3,
  };
}

/** Mark a prior surfacing as engaged (reaction capture). */
export async function markSurfacingEngaged(surfacingId: string): Promise<void> {
  await db
    .update(surfacings)
    .set({ reaction: "engaged", reactionAt: new Date() })
    .where(
      and(eq(surfacings.id, surfacingId), isNull(surfacings.reaction)),
    );
}

/**
 * Evaluate a candidate through gates and write the appropriate ledger row.
 * Returns the approved surfacing id + directive text, or null if blocked.
 */
export async function evaluateAndRecord(params: {
  userId: string;
  conversationId?: string | null;
  candidate: NudgeCandidate;
  seam: Seam;
  channel: Channel;
  now?: Date;
  /** Prospection path skips the seam gate. */
  skipSeamGate?: boolean;
}): Promise<{
  outcome: GateOutcome;
  surfacingId: string | null;
  approved: boolean;
}> {
  const now = params.now ?? new Date();
  const settings = await loadUserBudgetSettings(params.userId);

  const [subjectLedger, alreadyKnown, convoCount, dailyCount] =
    await Promise.all([
      loadSubjectLedger(params.userId, params.candidate.subjectId),
      userMentionedSubjectRecently({
        userId: params.userId,
        subjectType: params.candidate.subjectType,
        subjectId: params.candidate.subjectId,
        now,
      }),
      countConversationNudges(params.userId, params.conversationId),
      countDailySurfacings(params.userId, settings.timezone, now),
    ]);

  // If this is a queued delivery already counted in convo/daily, don't
  // double-count it against the budget (it was approved once already).
  let conversationNudgeCount = convoCount;
  let dailySurfacingCount = dailyCount;
  if (params.candidate.existingSurfacingId) {
    conversationNudgeCount = Math.max(0, conversationNudgeCount - 1);
    dailySurfacingCount = Math.max(0, dailySurfacingCount - 1);
  }

  const outcome = runGates({
    candidate: params.candidate,
    subjectLedger,
    alreadyKnown,
    seam: params.seam,
    channel: params.channel,
    conversationNudgeCount,
    dailySurfacingCount,
    maxDailySurfacings: settings.maxDailySurfacings,
    inQuietHours: isInQuietHours(
      now,
      settings.timezone,
      settings.quietHoursStart,
      settings.quietHoursEnd,
    ),
    now,
    skipSeamGate: params.skipSeamGate,
  });

  if (outcome.decision === "approve") {
    // Reuse queued row, or insert a fresh pending row.
    if (params.candidate.existingSurfacingId) {
      return {
        outcome,
        surfacingId: params.candidate.existingSurfacingId,
        approved: true,
      };
    }
    const [row] = await db
      .insert(surfacings)
      .values({
        userId: params.userId,
        kind: params.candidate.kind,
        subjectType: params.candidate.subjectType,
        subjectId: params.candidate.subjectId,
        channel: params.channel,
        conversationId: params.conversationId ?? null,
        evidence: params.candidate.evidence,
        shownAt: now,
      })
      .returning({ id: surfacings.id });
    return {
      outcome,
      surfacingId: row?.id ?? null,
      approved: true,
    };
  }

  // hold or suppress → write a suppressed ledger row for tuning (spec 03).
  // mid_task hold: log with suppressed_reason so it never counts as shown,
  // but the open loop remains available for next turn / prospection.
  const reason =
    outcome.decision === "hold" ? "mid_task" : outcome.reason;

  try {
    const [row] = await db
      .insert(surfacings)
      .values({
        userId: params.userId,
        kind: params.candidate.kind,
        subjectType: params.candidate.subjectType,
        subjectId: params.candidate.subjectId,
        channel: params.channel,
        conversationId: params.conversationId ?? null,
        evidence: params.candidate.evidence,
        shownAt: now,
        suppressedReason: reason,
      })
      .returning({ id: surfacings.id });
    log.info("nudge gated", {
      decision: outcome.decision,
      reason,
      surfacingId: row?.id,
      subjectId: params.candidate.subjectId,
    });
  } catch (err) {
    log.warn("failed to log suppressed surfacing", err as Error);
  }

  return { outcome, surfacingId: null, approved: false };
}

/**
 * Whether the user has had any conversation turn today (local day).
 * Used by prospection to choose conversation-queue vs push/chip.
 */
export async function userHadConversationToday(
  userId: string,
  timezone: string,
  now: Date,
): Promise<boolean> {
  const localDay = localDateString(now, timezone);
  const windowStart = new Date(now.getTime() - 36 * 60 * 60 * 1000);
  const rows = await db
    .select({ lastTurnAt: conversations.lastTurnAt })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        gte(conversations.lastTurnAt, windowStart),
      ),
    )
    .limit(20);
  return rows.some(
    (r) => localDateString(r.lastTurnAt, timezone) === localDay,
  );
}

/**
 * Scan prospection sources for a user (spec 02 §3.3):
 *  (a) open loops due ≤7d — prep at T-3, others at T-1
 *  (b) entity birthday attributes at T-1
 *  (c) pending conversation surfacings >1 day old (never rendered)
 */
export async function scanProspectionCandidates(params: {
  userId: string;
  now?: Date;
  timezone: string;
}): Promise<NudgeCandidate[]> {
  const now = params.now ?? new Date();
  const within = new Date(now.getTime() + 7 * DAY_MS);
  const out: NudgeCandidate[] = [];

  // (a) open loops
  const loops = await db
    .select({
      id: openLoops.id,
      title: openLoops.title,
      dueAt: openLoops.dueAt,
      sourceMemory: openLoops.sourceMemory,
    })
    .from(openLoops)
    .where(
      and(
        eq(openLoops.userId, params.userId),
        eq(openLoops.status, "open"),
        sql`${openLoops.dueAt} IS NOT NULL`,
        sql`${openLoops.dueAt} <= ${within.toISOString()}::timestamptz`,
        sql`${openLoops.dueAt} >= ${now.toISOString()}::timestamptz`,
      ),
    );

  for (const loop of loops) {
    if (!loop.dueAt) continue;
    const days = localDaysUntil(loop.dueAt, now, params.timezone);
    const prep = isPrepTypeTitle(loop.title);
    const dueWindow = prep ? days === 3 : days === 1;
    if (!dueWindow) continue;
    const dueLabel = loop.dueAt.toISOString().slice(0, 10);
    out.push({
      kind: "loop_nudge",
      subjectType: "open_loop",
      subjectId: loop.id,
      oneLineNudge: prep
        ? `${loop.title} is in ${days} days — want a prep plan?`
        : `${loop.title} is ${dueLabel === localDateString(new Date(now.getTime() + DAY_MS), params.timezone) ? "tomorrow" : `on ${dueLabel}`} — want a heads-up plan?`,
      evidence: [loop.sourceMemory],
      confidence: 0.95,
    });
  }

  // (b) birthdays at T-1 (tomorrow local)
  const ents = await db
    .select({
      id: entities.id,
      name: entities.canonicalName,
      attributes: entities.attributes,
    })
    .from(entities)
    .where(eq(entities.userId, params.userId));

  const tomorrow = localDateString(
    new Date(now.getTime() + DAY_MS),
    params.timezone,
  );
  // tomorrow is YYYY-MM-DD; birthday attributes are often YYYY-MM-DD or MM-DD
  const tomMD = tomorrow.slice(5); // MM-DD

  for (const ent of ents) {
    const attrs = ent.attributes as Record<string, unknown> | null;
    const bday = attrs?.birthday;
    if (typeof bday !== "string") continue;
    const md = bday.length >= 10 ? bday.slice(5, 10) : bday.slice(0, 5);
    if (md !== tomMD) continue;

    // Prefer a memory_entities link as evidence (gate 4 needs ≥1 receipt).
    const [linked] = await db
      .select({ memoryId: memoryEntities.memoryId })
      .from(memoryEntities)
      .innerJoin(memories, eq(memories.id, memoryEntities.memoryId))
      .where(
        and(
          eq(memoryEntities.entityId, ent.id),
          eq(memories.userId, params.userId),
        ),
      )
      .limit(1);

    let evidenceId = linked?.memoryId ?? null;
    if (!evidenceId) {
      // Last resort: any memory mentioning the name (fixtures / thin graphs).
      const [mem] = await db
        .select({ id: memories.id })
        .from(memories)
        .where(
          and(
            eq(memories.userId, params.userId),
            sql`${memories.rawText} ILIKE ${"%" + ent.name.replace(/[%_]/g, "") + "%"}`,
          ),
        )
        .limit(1);
      evidenceId = mem?.id ?? null;
    }
    if (!evidenceId) continue;

    out.push({
      kind: "date_nudge",
      subjectType: "entity",
      subjectId: ent.id,
      oneLineNudge: `${ent.name}'s birthday is tomorrow — want to draft a note?`,
      evidence: [evidenceId],
      confidence: 0.9,
    });
  }

  // (c) approved conversation nudges that never rendered — pending >1 day
  const stale = await db
    .select({
      id: surfacings.id,
      kind: surfacings.kind,
      subjectType: surfacings.subjectType,
      subjectId: surfacings.subjectId,
      evidence: surfacings.evidence,
    })
    .from(surfacings)
    .where(
      and(
        eq(surfacings.userId, params.userId),
        eq(surfacings.channel, "conversation"),
        isNull(surfacings.reaction),
        isNull(surfacings.suppressedReason),
        sql`${surfacings.kind} != 'rule_applied'`,
        sql`${surfacings.shownAt} < ${new Date(now.getTime() - DAY_MS).toISOString()}::timestamptz`,
      ),
    )
    .limit(20);

  for (const s of stale) {
    if (s.kind !== "loop_nudge" && s.kind !== "date_nudge") continue;
    // Mark the old row ignored so it doesn't loop forever; re-deliver fresh.
    await db
      .update(surfacings)
      .set({ reaction: "ignored", reactionAt: now })
      .where(eq(surfacings.id, s.id));

    out.push({
      kind: s.kind,
      subjectType: s.subjectType,
      subjectId: s.subjectId,
      oneLineNudge: "Following up on something coming up soon.",
      evidence: s.evidence ?? [],
      confidence: 0.85,
    });
  }

  return out;
}
