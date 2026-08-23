import { sql } from "drizzle-orm";
import { db } from "../client";
import { asDate, asRows } from "./admin-util";

/**
 * Admin queries — user directory + profile (issue #31). Raw SQL lives HERE in
 * @repo/db; routes only validate input and serialize. These are the ONLY
 * cross-user aggregates in the codebase and every one of them is gated behind
 * requireAdmin at the route layer.
 *
 * Cost math is deliberately NOT done here: token sums leave this module per
 * model, and @repo/core prices.ts folds them into USD estimates.
 */

// ---------------------------------------------------------------------------
// GET /admin/users — directory with joined aggregates + keyset pagination
// ---------------------------------------------------------------------------

export interface AdminUserListRow {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  /** UTC date ('YYYY-MM-DD') of the newest activity row; null = never active. */
  lastActiveAt: string | null;
  streakDays: number;
  memoriesTotal: number;
  conversationsTotal: number;
  hasFailedMemories: boolean;
  insightsDisabled: boolean;
}

export interface ListAdminUsersParams {
  /** Email substring (ILIKE); caller escapes %/_ wildcards. */
  query: string | null;
  cursorCreatedAt: Date | null;
  cursorId: string | null;
  limit: number;
}

export async function listAdminUsers(
  params: ListAdminUsersParams,
): Promise<AdminUserListRow[]> {
  const { query, cursorCreatedAt, cursorId, limit } = params;
  const pattern = query ? `%${query}%` : null;

  // Current streak = run of consecutive UTC activity days whose LAST day is
  // today or yesterday. Classic gaps-and-islands over the daily rollup.
  const rows = await db.execute(sql`
    WITH page AS (
      SELECT id, email, role::text AS role, created_at, insights_enabled
      FROM users
      WHERE (${pattern}::text IS NULL OR email ILIKE ${pattern})
        AND (
          ${cursorCreatedAt ? cursorCreatedAt.toISOString() : null}::timestamptz IS NULL
          OR (created_at, id) < (
            ${cursorCreatedAt ? cursorCreatedAt.toISOString() : null}::timestamptz,
            ${cursorId ?? "00000000-0000-0000-0000-000000000000"}::uuid
          )
        )
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    ),
    islands AS (
      SELECT user_id, day,
             day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS grp
      FROM user_activity_days
    ),
    streaks AS (
      SELECT user_id, count(*)::int AS days
      FROM islands
      GROUP BY user_id, grp
      HAVING max(day) >= current_date - 1
    )
    SELECT p.id, p.email, p.role, p.created_at, p.insights_enabled,
           la.last_active_at::text AS last_active_at,
           COALESCE(s.days, 0)::int AS streak_days,
           m.total::int             AS memories_total,
           c.total::int             AS conversations_total,
           f.failed                 AS has_failed_memories
    FROM page p
    LEFT JOIN LATERAL (
      SELECT max(day) AS last_active_at
      FROM user_activity_days WHERE user_id = p.id
    ) la ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total FROM memories WHERE user_id = p.id
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS total FROM conversations WHERE user_id = p.id
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT EXISTS(
        SELECT 1 FROM memories WHERE user_id = p.id AND status = 'failed'
      ) AS failed
    ) f ON true
    LEFT JOIN streaks s ON s.user_id = p.id
    ORDER BY p.created_at DESC, p.id DESC
  `);

  return asRows(rows).map((r) => ({
    id: String(r.id),
    email: String(r.email),
    role: String(r.role),
    createdAt: asDate(r.created_at),
    lastActiveAt: r.last_active_at ? String(r.last_active_at) : null,
    streakDays: Number(r.streak_days ?? 0),
    memoriesTotal: Number(r.memories_total ?? 0),
    conversationsTotal: Number(r.conversations_total ?? 0),
    hasFailedMemories: Boolean(r.has_failed_memories),
    insightsDisabled: !Boolean(r.insights_enabled),
  }));
}

export interface UserModelTokens {
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Per-user × model token sums since `days` days ago (30d cost window). */
export async function getAiUsageByModelSince(
  userIds: string[],
  days: number,
): Promise<UserModelTokens[]> {
  if (userIds.length === 0) return [];
  const rows = await db.execute(sql`
    SELECT user_id::text, model,
           sum(input_tokens)::int  AS input_tokens,
           sum(output_tokens)::int AS output_tokens
    FROM ai_usage_daily
    WHERE day > current_date - ${days}
      AND user_id IN (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})
    GROUP BY user_id, model
  `);
  return asRows(rows).map((r) => ({
    userId: String(r.user_id),
    model: String(r.model),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// GET /admin/users/:id — profile + overview counters + devices
// ---------------------------------------------------------------------------

export interface AdminUserProfileRow {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  timezone: string;
}

export interface AdminUserOverviewRow {
  memoriesTotal: number;
  factsTotal: number;
  entitiesTotal: number;
  openLoopsOpen: number;
  conversationsTotal: number;
  turnsTotal: number;
  streakDays: number;
  activeDays30: number;
}

export interface AdminDevice {
  deviceId: string;
  updatedAt: Date;
}

export interface AdminUserDetail {
  profile: AdminUserProfileRow;
  overview: AdminUserOverviewRow;
  devices: AdminDevice[];
}

export async function getAdminUserDetail(
  userId: string,
): Promise<AdminUserDetail | null> {
  const [profileRows, overviewRows, deviceRows] = await Promise.all([
    db.execute(sql`
      SELECT id, email, role::text AS role, created_at, timezone
      FROM users WHERE id = ${userId}::uuid LIMIT 1`),
    db.execute(sql`
      WITH islands AS (
        SELECT day,
               day - (row_number() OVER (ORDER BY day))::int AS grp
        FROM user_activity_days WHERE user_id = ${userId}::uuid
      ),
      streaks AS (
        SELECT count(*)::int AS days FROM islands
        GROUP BY grp HAVING max(day) >= current_date - 1
      )
      SELECT
        (SELECT count(*) FROM memories WHERE user_id = ${userId}::uuid)::int AS memories_total,
        (SELECT count(*) FROM facts WHERE user_id = ${userId}::uuid)::int AS facts_total,
        (SELECT count(*) FROM entities WHERE user_id = ${userId}::uuid)::int AS entities_total,
        (SELECT count(*) FROM open_loops WHERE user_id = ${userId}::uuid AND status = 'open')::int AS loops_open,
        (SELECT count(*) FROM conversations WHERE user_id = ${userId}::uuid)::int AS conversations_total,
        (SELECT COALESCE(sum(turn_count), 0) FROM conversations WHERE user_id = ${userId}::uuid)::int AS turns_total,
        (SELECT COALESCE(max(days), 0) FROM streaks)::int AS streak_days,
        (SELECT count(DISTINCT day) FROM user_activity_days
         WHERE user_id = ${userId}::uuid AND day > current_date - 30)::int AS active_days_30`),
    db.execute(sql`
      SELECT device_id, updated_at FROM push_tokens
      WHERE user_id = ${userId}::uuid ORDER BY updated_at DESC`),
  ]);

  const p = asRows(profileRows)[0];
  if (!p) return null;
  const o = asRows(overviewRows)[0] ?? {};

  return {
    profile: {
      id: String(p.id),
      email: String(p.email),
      role: String(p.role),
      createdAt: new Date(p.created_at as string),
      timezone: String(p.timezone),
    },
    overview: {
      memoriesTotal: Number(o.memories_total ?? 0),
      factsTotal: Number(o.facts_total ?? 0),
      entitiesTotal: Number(o.entities_total ?? 0),
      openLoopsOpen: Number(o.loops_open ?? 0),
      conversationsTotal: Number(o.conversations_total ?? 0),
      turnsTotal: Number(o.turns_total ?? 0),
      streakDays: Number(o.streak_days ?? 0),
      activeDays30: Number(o.active_days_30 ?? 0),
    },
    devices: asRows(deviceRows).map((d) => ({
      deviceId: String(d.device_id),
      updatedAt: asDate(d.updated_at),
    })),
  };
}
