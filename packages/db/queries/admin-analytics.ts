import { sql } from "drizzle-orm";
import { db } from "../client";
import { asDate, asRows } from "./admin-util";

/**
 * Admin queries — engagement + usage analytics + engine health (issue #31).
 * All rollups read the issue #30 instrumentation tables; days are UTC dates.
 * Cost estimation stays in @repo/core prices.ts — this module returns token
 * sums only.
 */

// ---------------------------------------------------------------------------
// GET /admin/users/:id/activity?days=90
// ---------------------------------------------------------------------------

export interface AdminActivityDayRow {
  day: string; // 'YYYY-MM-DD'
  requests: number;
  memoriesCreated: number;
  turns: number;
}

export interface AdminApiRequestRowData {
  ts: string; // ISO
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export async function getAdminUserActivity(
  userId: string,
  days: number,
): Promise<{ days: AdminActivityDayRow[]; apiRequests: AdminApiRequestRowData[] }> {
  const [dayRows, reqRows] = await Promise.all([
    db.execute(sql`
      SELECT day::text AS day,
             requests, memories_created, turns
      FROM user_activity_days
      WHERE user_id = ${userId}::uuid AND day > current_date - ${days}
      ORDER BY day ASC`),
    db.execute(sql`
      SELECT ts, method, path, status, duration_ms
      FROM api_requests
      WHERE user_id = ${userId}::uuid
      ORDER BY ts DESC
      LIMIT 200`),
  ]);

  return {
    days: asRows(dayRows).map((r) => ({
      day: String(r.day),
      requests: Number(r.requests ?? 0),
      memoriesCreated: Number(r.memories_created ?? 0),
      turns: Number(r.turns ?? 0),
    })),
    apiRequests: asRows(reqRows).map((r) => ({
      ts: asDate(r.ts).toISOString(),
      method: String(r.method),
      path: String(r.path),
      status: Number(r.status ?? 0),
      durationMs: Number(r.duration_ms ?? 0),
    })),
  };
}

// ---------------------------------------------------------------------------
// GET /admin/users/:id/usage?granularity=day|week|month&span=6
// ---------------------------------------------------------------------------

export type UsageGranularity = "day" | "week" | "month";

/** Whitelist for the date_trunc/to_char unit interpolated via sql.raw. */
const USAGE_UNIT: Record<UsageGranularity, { trunc: string; fmt: string }> = {
  // Day label keeps ISO date form ('YYYY-MM-DD'); week uses ISO week numbers.
  day: { trunc: "day", fmt: "YYYY-MM-DD" },
  week: { trunc: "week", fmt: 'IYYY-"W"IW' },
  month: { trunc: "month", fmt: "YYYY-MM" },
};

export interface AdminUsageCell {
  period: string;
  tier: string;
  model: string;
  phase: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * ai_usage_daily grouped by period × tier × model × phase over the last
 * `span` periods (current partial period included). Period labels match the
 * web panel's periodLabel parser: 'YYYY-MM-DD' / 'YYYY-Www' / 'YYYY-MM'.
 */
export async function getAdminUsageCells(params: {
  userId: string;
  granularity: UsageGranularity;
  span: number;
}): Promise<AdminUsageCell[]> {
  const { userId, granularity, span } = params;
  const unit = USAGE_UNIT[granularity]; // whitelisted → safe for sql.raw

  const rows = await db.execute(sql`
    WITH bounds AS (
      SELECT (date_trunc(${unit.trunc}, now()) - ((${span}::int - 1) * INTERVAL '1 ${sql.raw(unit.trunc)}')) AS start_ts
    )
    SELECT to_char(date_trunc(${unit.trunc}, d.day::timestamp), ${unit.fmt}) AS period,
           d.tier, d.model, d.phase,
           sum(d.calls)::int          AS calls,
           sum(d.input_tokens)::int   AS input_tokens,
           sum(d.output_tokens)::int  AS output_tokens
    FROM ai_usage_daily d, bounds b
    WHERE d.user_id = ${userId}::uuid
      AND d.day::timestamp >= b.start_ts::timestamp
    GROUP BY 1, 2, 3, 4
    ORDER BY 1 ASC, tier ASC, model ASC, phase ASC
  `);

  return asRows(rows).map((r) => ({
    period: String(r.period),
    tier: String(r.tier),
    model: String(r.model),
    phase: String(r.phase),
    calls: Number(r.calls ?? 0),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// GET /admin/activity?days=90 — DAU / WAU / streak leaderboard
// ---------------------------------------------------------------------------

export interface ActivityCountPointData {
  day: string; // 'YYYY-MM-DD'
  count: number;
}

export interface StreakLeaderboardRow {
  userId: string;
  email: string;
  days: number;
}

export async function getGlobalActivity(params: {
  days: number;
}): Promise<{
  dau: ActivityCountPointData[];
  wau: ActivityCountPointData[];
  streakLeaderboard: StreakLeaderboardRow[];
}> {
  const { days } = params;

  const [dauRows, wauRows, boardRows] = await Promise.all([
    db.execute(sql`
      SELECT day::text AS day, count(DISTINCT user_id)::int AS count
      FROM user_activity_days
      WHERE day > current_date - ${days}
      GROUP BY day ORDER BY day ASC`),
    db.execute(sql`
      SELECT to_char(date_trunc('week', day::timestamp), 'YYYY-MM-DD') AS day,
             count(DISTINCT user_id)::int AS count
      FROM user_activity_days
      WHERE day > current_date - ${days}
      GROUP BY 1 ORDER BY 1 ASC`),
    db.execute(sql`
      WITH islands AS (
        SELECT user_id, day,
               day - (row_number() OVER (PARTITION BY user_id ORDER BY day))::int AS grp
        FROM user_activity_days
      ),
      current_streaks AS (
        SELECT user_id, count(*)::int AS days
        FROM islands GROUP BY user_id, grp
        HAVING max(day) >= current_date - 1
      )
      SELECT u.id::text AS user_id, u.email, s.days
      FROM current_streaks s JOIN users u ON u.id = s.user_id
      ORDER BY s.days DESC, u.email ASC
      LIMIT 20`),
  ]);

  const points = (rows: unknown): ActivityCountPointData[] =>
    asRows(rows).map((r) => ({
      day: String(r.day),
      count: Number(r.count ?? 0),
    }));

  return {
    dau: points(dauRows),
    wau: points(wauRows),
    streakLeaderboard: asRows(boardRows).map((r) => ({
      userId: String(r.user_id),
      email: String(r.email),
      days: Number(r.days ?? 0),
    })),
  };
}

// ---------------------------------------------------------------------------
// GET /admin/engine — consolidation runs + ingestion failures
// ---------------------------------------------------------------------------

export interface ConsolidationRunRowData {
  startedAt: string; // ISO
  finishedAt: string | null;
  status: string;
  counters: Record<string, number>;
}

/** Narrow opaque counters JSONB to Record<string, number> defensively. */
function coerceCounters(value: unknown): Record<string, number> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export async function getEngineHealthData(): Promise<{
  consolidationRuns: ConsolidationRunRowData[];
  ingestionFailures7d: number;
}> {
  const [runRows, failRows] = await Promise.all([
    db.execute(sql`
      SELECT started_at, finished_at, status, counters
      FROM consolidation_runs
      ORDER BY started_at DESC
      LIMIT 30`),
    db.execute(sql`
      SELECT count(*)::int AS n FROM memories
      WHERE status = 'failed' AND created_at > now() - INTERVAL '7 days'`),
  ]);

  return {
    consolidationRuns: asRows(runRows).map((r) => ({
      startedAt: asDate(r.started_at).toISOString(),
      finishedAt: r.finished_at ? asDate(r.finished_at).toISOString() : null,
      status: String(r.status),
      counters: coerceCounters(r.counters),
    })),
    ingestionFailures7d: Number(asRows(failRows)[0]?.n ?? 0),
  };
}
