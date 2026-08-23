import { sql } from "drizzle-orm";
import { db } from "../client";
import {
  aiUsageDaily,
  apiRequests,
  userActivityDays,
} from "../schema/instrumentation";

/**
 * Usage-instrumentation writers (issue #30). All helpers are small upserts /
 * inserts meant to be called FIRE-AND-FORGET from request and job paths — a
 * tracking failure must never fail the user-facing work that produced it.
 * Error swallowing happens at the call sites (see @repo/core prod-usage.ts and
 * apps/server instrumentation), not here: here we stay honest about failures.
 *
 * Raw SQL lives in @repo/db; callers only pass ids and numbers.
 */

/** UTC calendar day ('YYYY-MM-DD') used as the rollup key everywhere. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// ai_usage_daily — per user × day × tier × model × phase token rollup
// ---------------------------------------------------------------------------

export interface ProdUsageEvent {
  userId: string;
  /** UTC date key; defaults to today (server clock is UTC-authoritative). */
  day?: string;
  /** ingestion | reasoning | fast | transcription | … */
  tier: string;
  /** provider:modelId as configured in ai/models.ts */
  model: string;
  /** ingest | retrieve | transcribe | other */
  phase: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** Upsert one LLM/transcription event into the daily rollup (calls +1). */
export async function upsertAiUsageDaily(event: ProdUsageEvent): Promise<void> {
  await db
    .insert(aiUsageDaily)
    .values({
      userId: event.userId,
      day: event.day ?? utcDay(),
      tier: event.tier,
      model: event.model,
      phase: event.phase,
      calls: 1,
      inputTokens: Math.max(0, Math.round(event.inputTokens)),
      outputTokens: Math.max(0, Math.round(event.outputTokens)),
      latencyMsSum: Math.max(0, Math.round(event.latencyMs)),
    })
    .onConflictDoUpdate({
      target: [
        aiUsageDaily.userId,
        aiUsageDaily.day,
        aiUsageDaily.tier,
        aiUsageDaily.model,
        aiUsageDaily.phase,
      ],
      set: {
        calls: sql`${aiUsageDaily.calls} + 1`,
        inputTokens:
          sql`${aiUsageDaily.inputTokens} + ${Math.max(0, Math.round(event.inputTokens))}`,
        outputTokens:
          sql`${aiUsageDaily.outputTokens} + ${Math.max(0, Math.round(event.outputTokens))}`,
        latencyMsSum:
          sql`${aiUsageDaily.latencyMsSum} + ${Math.max(0, Math.round(event.latencyMs))}`,
      },
    });
}

// ---------------------------------------------------------------------------
// user_activity_days — daily activity rollup (streaks / DAU / retention)
// ---------------------------------------------------------------------------

/**
 * Count one authenticated API request for the user's streak/DAU rollup.
 * Creates the day's row on first touch.
 */
export async function pingUserActivity(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(userActivityDays)
    .values({ userId, day: utcDay(now), requests: 1 })
    .onConflictDoUpdate({
      target: [userActivityDays.userId, userActivityDays.day],
      set: { requests: sql`${userActivityDays.requests} + 1` },
    });
}

/**
 * Record a memory capture: memories_created +1 AND the per-source tally in
 * captures_by_source (jsonb merge, e.g. manual | voice) in ONE statement.
 */
export async function recordCaptureActivity(
  userId: string,
  source: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(userActivityDays)
    .values({
      userId,
      day: utcDay(now),
      memoriesCreated: 1,
      capturesBySource: { [source]: 1 },
    })
    .onConflictDoUpdate({
      target: [userActivityDays.userId, userActivityDays.day],
      set: {
        memoriesCreated: sql`${userActivityDays.memoriesCreated} + 1`,
        // jsonb keyed increment: existing tally +1 for this source, or seed it.
        capturesBySource: sql`jsonb_set(
          ${userActivityDays.capturesBySource},
          ARRAY[${source}],
          to_jsonb(COALESCE((${userActivityDays.capturesBySource} ->> ${source})::int, 0) + 1),
          true
        )`,
      },
    });
}

/** Record one conversation turn (Ask / durable conversations). */
export async function recordTurnActivity(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(userActivityDays)
    .values({ userId, day: utcDay(now), turns: 1 })
    .onConflictDoUpdate({
      target: [userActivityDays.userId, userActivityDays.day],
      set: { turns: sql`${userActivityDays.turns} + 1` },
    });
}

/** Record a reminder being marked done. */
export async function recordReminderDoneActivity(
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(userActivityDays)
    .values({ userId, day: utcDay(now), remindersDone: 1 })
    .onConflictDoUpdate({
      target: [userActivityDays.userId, userActivityDays.day],
      set: { remindersDone: sql`${userActivityDays.remindersDone} + 1` },
    });
}

// ---------------------------------------------------------------------------
// api_requests — raw HTTP traffic log (~90d retention intent)
// ---------------------------------------------------------------------------

export interface ApiRequestLogInput {
  /** Local users.id when the request was authenticated; null otherwise. */
  userId: string | null;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

/** Insert one post-response request log row. */
export async function insertApiRequest(
  input: ApiRequestLogInput,
): Promise<void> {
  await db.insert(apiRequests).values({
    userId: input.userId,
    method: input.method,
    path: input.path,
    status: input.status,
    durationMs: Math.max(0, Math.round(input.durationMs)),
  });
}
