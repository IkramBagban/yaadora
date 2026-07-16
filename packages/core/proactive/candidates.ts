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
  buildAlreadyKnownPatterns,
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
 *  (b) queued prospection deliveries (pending channel=conversation,
 *      conversationId IS NULL — not yet woven into a conversation)
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
    // Prospection-queued only: never woven (conversation_id null). Rows that
    // already have a conversationId were woven and must not re-enter the pack
    // every turn (≤1 nudge per conversation).
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
          isNull(surfacings.conversationId),
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
        .where(
          and(
            eq(entities.id, q.subjectId),
            eq(entities.userId, params.userId),
          ),
        )
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
 * Excludes the current turn (persisted before answerQuestion runs).
 * Matching is conservative: entity = full name; loops require a multi-token
 * distinctive phrase, not a single common word like "backend".
 */
export async function userMentionedSubjectRecently(params: {
  userId: string;
  subjectType: string;
  subjectId: string;
  now?: Date;
  /** Current user turn id — always excluded (already persisted). */
  excludeTurnId?: string | null;
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
      .where(
        and(
          eq(entities.id, params.subjectId),
          eq(entities.userId, params.userId),
        ),
      )
      .limit(1);
    needle = ent?.name ?? null;
  }
  if (!needle || needle.trim().length < 3) return false;

  const patterns = buildAlreadyKnownPatterns(
    needle,
    params.subjectType === "entity",
  );
  if (patterns.length === 0) return false;

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

    // Exclude the live turn (persisted before answerQuestion).
    const turnConds = [
      eq(conversationTurns.userId, params.userId),
      eq(conversationTurns.role, "user"),
      gte(conversationTurns.createdAt, since),
      sql`${conversationTurns.content} ILIKE ${like}`,
    ];
    if (params.excludeTurnId) {
      turnConds.push(sql`${conversationTurns.id} != ${params.excludeTurnId}`);
    }

    const [turnHit] = await db
      .select({ id: conversationTurns.id })
      .from(conversationTurns)
      .where(and(...turnConds))
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
  const localDay = localDateString(now, timezone);
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
 * Retarget an existing pending row's channel (e.g. push → chip on send failure).
 * Only touches non-suppressed pending rows.
 */
export async function retargetSurfacingChannel(params: {
  surfacingId: string;
  userId: string;
  channel: Channel;
  now?: Date;
}): Promise<boolean> {
  const now = params.now ?? new Date();
  const [row] = await db
    .update(surfacings)
    .set({ channel: params.channel, shownAt: now })
    .where(
      and(
        eq(surfacings.id, params.surfacingId),
        eq(surfacings.userId, params.userId),
        isNull(surfacings.reaction),
        isNull(surfacings.suppressedReason),
      ),
    )
    .returning({ id: surfacings.id });
  return Boolean(row);
}

/**
 * Evaluate a candidate through gates and write the appropriate ledger row.
 * Returns the approved surfacing id, or null if blocked.
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
  /** Current user turn id for already-known exclusion. */
  excludeTurnId?: string | null;
}): Promise<{
  outcome: GateOutcome;
  surfacingId: string | null;
  approved: boolean;
}> {
  const now = params.now ?? new Date();
  const settings = await loadUserBudgetSettings(params.userId);
  const existingId = params.candidate.existingSurfacingId ?? null;

  // Load existing row when reusing a queued delivery so budget adjustments
  // only uncount rows that were actually included in the counts.
  let existingRow: {
    id: string;
    conversationId: string | null;
    shownAt: Date;
    channel: string;
  } | null = null;
  if (existingId) {
    const [row] = await db
      .select({
        id: surfacings.id,
        conversationId: surfacings.conversationId,
        shownAt: surfacings.shownAt,
        channel: surfacings.channel,
      })
      .from(surfacings)
      .where(
        and(
          eq(surfacings.id, existingId),
          eq(surfacings.userId, params.userId),
          isNull(surfacings.suppressedReason),
        ),
      )
      .limit(1);
    existingRow = row ?? null;

    // Already woven into a conversation — do not re-approve as a fresh nudge.
    if (
      existingRow?.conversationId &&
      params.channel === "conversation"
    ) {
      return {
        outcome: {
          decision: "suppress",
          reason: "budget_conversation",
        },
        surfacingId: null,
        approved: false,
      };
    }
  }

  const [subjectLedger, alreadyKnown, convoCount, dailyCount] =
    await Promise.all([
      loadSubjectLedger(params.userId, params.candidate.subjectId),
      userMentionedSubjectRecently({
        userId: params.userId,
        subjectType: params.candidate.subjectType,
        subjectId: params.candidate.subjectId,
        now,
        excludeTurnId: params.excludeTurnId,
      }),
      countConversationNudges(params.userId, params.conversationId),
      countDailySurfacings(params.userId, settings.timezone, now),
    ]);

  let conversationNudgeCount = convoCount;
  let dailySurfacingCount = dailyCount;

  if (existingRow) {
    // Only uncount conversation if this row is already bound to THIS conversation.
    if (
      params.conversationId &&
      existingRow.conversationId === params.conversationId
    ) {
      conversationNudgeCount = Math.max(0, conversationNudgeCount - 1);
    }
    // Only uncount daily if the row already counts on the user's local day.
    if (
      localDateString(existingRow.shownAt, settings.timezone) ===
      localDateString(now, settings.timezone)
    ) {
      dailySurfacingCount = Math.max(0, dailySurfacingCount - 1);
    }
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
    if (existingRow) {
      // Reuse queued/stale row: bind conversation context + channel + shownAt.
      const [updated] = await db
        .update(surfacings)
        .set({
          channel: params.channel,
          conversationId:
            params.conversationId ?? existingRow.conversationId ?? null,
          shownAt: now,
          evidence: params.candidate.evidence,
        })
        .where(
          and(
            eq(surfacings.id, existingRow.id),
            isNull(surfacings.reaction),
            isNull(surfacings.suppressedReason),
          ),
        )
        .returning({ id: surfacings.id });
      return {
        outcome,
        surfacingId: updated?.id ?? existingRow.id,
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
  // mid_task hold: log with suppressed_reason so it never counts as shown;
  // leave any existing queued row untouched so it can retry.
  const reason =
    outcome.decision === "hold" ? "mid_task" : outcome.reason;

  // Terminal suppress on a queue delivery: mark the queue row itself so it
  // stops re-entering awareness (except mid_task hold — keep pending).
  if (
    existingRow &&
    outcome.decision === "suppress" &&
    reason !== "mid_task"
  ) {
    try {
      await db
        .update(surfacings)
        .set({ suppressedReason: reason, shownAt: now })
        .where(eq(surfacings.id, existingRow.id));
      log.info("nudge gated (queued row)", {
        decision: outcome.decision,
        reason,
        surfacingId: existingRow.id,
        subjectId: params.candidate.subjectId,
      });
    } catch (err) {
      log.warn("failed to mark queued surfacing suppressed", err as Error);
    }
    return { outcome, surfacingId: null, approved: false };
  }

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

/** Subjects with a non-suppressed non-rule ledger row in the last week. */
export async function loadSubjectsSurfacedThisWeek(
  userId: string,
  now: Date,
): Promise<Set<string>> {
  const weekAgo = new Date(now.getTime() - WEEK_MS);
  const rows = await db
    .select({ subjectId: surfacings.subjectId })
    .from(surfacings)
    .where(
      and(
        eq(surfacings.userId, userId),
        isNull(surfacings.suppressedReason),
        gte(surfacings.shownAt, weekAgo),
        sql`${surfacings.kind} != 'rule_applied'`,
      ),
    );
  return new Set(rows.map((r) => r.subjectId));
}

/**
 * Scan prospection sources for a user (spec 02 §3.3):
 *  (a) open loops due ≤7d — prep at T-3, others at T-1
 *  (b) entity birthday attributes at T-1
 *  (c) pending conversation surfacings >1 day old (never rendered) —
 *      retarget same row via existingSurfacingId (no ignored reaction)
 */
export async function scanProspectionCandidates(params: {
  userId: string;
  now?: Date;
  timezone: string;
}): Promise<NudgeCandidate[]> {
  const now = params.now ?? new Date();
  const within = new Date(now.getTime() + 7 * DAY_MS);
  const out: NudgeCandidate[] = [];
  const seen = new Set<string>();

  const weekSubjects = await loadSubjectsSurfacedThisWeek(params.userId, now);

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
    if (weekSubjects.has(loop.id) || seen.has(loop.id)) continue;
    const days = localDaysUntil(loop.dueAt, now, params.timezone);
    const prep = isPrepTypeTitle(loop.title);
    const dueWindow = prep ? days === 3 : days === 1;
    if (!dueWindow) continue;
    const dueLabel = loop.dueAt.toISOString().slice(0, 10);
    seen.add(loop.id);
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
  const tomMD = tomorrow.slice(5);

  for (const ent of ents) {
    if (weekSubjects.has(ent.id) || seen.has(ent.id)) continue;
    const attrs = ent.attributes as Record<string, unknown> | null;
    const bday = attrs?.birthday;
    if (typeof bday !== "string") continue;
    const md = bday.length >= 10 ? bday.slice(5, 10) : bday.slice(0, 5);
    if (md !== tomMD) continue;

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

    seen.add(ent.id);
    out.push({
      kind: "date_nudge",
      subjectType: "entity",
      subjectId: ent.id,
      oneLineNudge: `${ent.name}'s birthday is tomorrow — want to draft a note?`,
      evidence: [evidenceId],
      confidence: 0.9,
    });
  }

  // (c) prospection-queued conversation deliveries never woven (conversation_id
  // null) and >1 day old — retarget via existingSurfacingId. Do NOT mark
  // ignored (that self-blocks g1 with ledger_ignored_cooldown).
  const stale = await db
    .select({
      id: surfacings.id,
      kind: surfacings.kind,
      subjectType: surfacings.subjectType,
      subjectId: surfacings.subjectId,
      evidence: surfacings.evidence,
      conversationId: surfacings.conversationId,
    })
    .from(surfacings)
    .where(
      and(
        eq(surfacings.userId, params.userId),
        eq(surfacings.channel, "conversation"),
        isNull(surfacings.reaction),
        isNull(surfacings.suppressedReason),
        isNull(surfacings.conversationId),
        sql`${surfacings.kind} != 'rule_applied'`,
        sql`${surfacings.shownAt} < ${new Date(now.getTime() - DAY_MS).toISOString()}::timestamptz`,
      ),
    )
    .limit(20);

  for (const s of stale) {
    if (s.kind !== "loop_nudge" && s.kind !== "date_nudge") continue;
    // Prefer retarget of the queued row even if subject was "seen this week"
    // (the week row IS this pending delivery).
    if (seen.has(s.subjectId)) continue;
    seen.add(s.subjectId);

    let oneLine = "Following up on something coming up soon.";
    if (s.subjectType === "open_loop") {
      const loop = loops.find((l) => l.id === s.subjectId);
      if (loop) {
        oneLine = isPrepTypeTitle(loop.title)
          ? `${loop.title} is coming up — want a prep plan?`
          : `${loop.title} is coming up — want a heads-up?`;
      }
    }

    out.push({
      kind: s.kind,
      subjectType: s.subjectType,
      subjectId: s.subjectId,
      oneLineNudge: oneLine,
      evidence: s.evidence ?? [],
      confidence: 0.85,
      existingSurfacingId: s.id,
    });
  }

  return out;
}
