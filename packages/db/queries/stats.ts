import { sql } from "drizzle-orm";
import { db } from "../client";

/**
 * Web analytics helpers (spec 03 §8 wave: backend gaps).
 *
 * Read-only aggregates for the web dashboard: /stats/overview,
 * /stats/timeseries and /surfacings/summary. Raw SQL lives HERE in @repo/db;
 * routes only validate input and serialize. Every helper is scoped to a
 * single user_id — no cross-user aggregation ever happens.
 */

const asRows = (rows: unknown): Array<Record<string, unknown>> =>
  rows as unknown as Array<Record<string, unknown>>;

const num = (v: unknown): number => Number(v ?? 0);

// ---------------------------------------------------------------------------
// Overview counters
// ---------------------------------------------------------------------------

export interface StatsOverview {
  memories: { total: number; byStatus: Record<string, number> };
  /** current = valid_to IS NULL · superseded = valid_to IS NOT NULL · conflicted = conflicts_with IS NOT NULL */
  facts: { currentCount: number; supersededCount: number; conflictedCount: number };
  entities: { total: number; byType: Record<string, number> };
  openLoops: { total: number; byStatus: Record<string, number> };
  /** head rows only (superseded_by IS NULL), matching what GET /rules lists */
  rules: { active: number };
  /** pending = status pending · suggested = pending AND origin suggested */
  reminders: { pending: number; suggested: number };
}

function tally(rows: Array<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.key)] = num(r.n);
  return out;
}

export async function getStatsOverview(userId: string): Promise<StatsOverview> {
  const [memRows, factRows, entRows, loopRows, ruleRows, remRows] =
    await Promise.all([
      db.execute(
        sql`SELECT status AS key, count(*)::int AS n
            FROM memories WHERE user_id = ${userId} GROUP BY status`,
      ),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE valid_to IS NULL)::int          AS current_count,
          count(*) FILTER (WHERE valid_to IS NOT NULL)::int      AS superseded_count,
          count(*) FILTER (WHERE conflicts_with IS NOT NULL)::int AS conflicted_count
        FROM facts WHERE user_id = ${userId}`),
      db.execute(
        sql`SELECT type AS key, count(*)::int AS n
            FROM entities WHERE user_id = ${userId} GROUP BY type`,
      ),
      db.execute(
        sql`SELECT status AS key, count(*)::int AS n
            FROM open_loops WHERE user_id = ${userId} GROUP BY status`,
      ),
      db.execute(
        sql`SELECT count(*)::int AS n FROM rules
            WHERE user_id = ${userId} AND active AND superseded_by IS NULL`,
      ),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE status = 'pending')::int AS pending,
          count(*) FILTER (WHERE status = 'pending' AND origin = 'suggested')::int AS suggested
        FROM reminders WHERE user_id = ${userId}`),
    ]);

  const memByStatus = tally(asRows(memRows));
  const f = asRows(factRows)[0] ?? {};
  const r = asRows(ruleRows)[0] ?? {};
  const rem = asRows(remRows)[0] ?? {};

  return {
    memories: {
      total: Object.values(memByStatus).reduce((a, b) => a + b, 0),
      byStatus: memByStatus,
    },
    facts: {
      currentCount: num(f.current_count),
      supersededCount: num(f.superseded_count),
      conflictedCount: num(f.conflicted_count),
    },
    entities: {
      total: Object.values(tally(asRows(entRows))).reduce((a, b) => a + b, 0),
      byType: tally(asRows(entRows)),
    },
    openLoops: {
      total: Object.values(tally(asRows(loopRows))).reduce((a, b) => a + b, 0),
      byStatus: tally(asRows(loopRows)),
    },
    rules: { active: num(r.n) },
    reminders: { pending: num(rem.pending), suggested: num(rem.suggested) },
  };
}

// ---------------------------------------------------------------------------
// Timeseries — memory volume per time bucket, split by capture source
// ---------------------------------------------------------------------------

export type StatsBucket = "day" | "week" | "month";

/** Whitelist for the interval unit interpolated via sql.raw below. */
const BUCKET_UNIT: Record<StatsBucket, string> = {
  day: "day",
  week: "week",
  month: "month",
};

export interface TimeseriesPoint {
  /** ISO start of the bucket (UTC) */
  bucketStart: string;
  total: number;
  bySource: Record<string, number>;
}

/**
 * Memory counts per bucket over the last `days` days, split by source
 * (manual | voice | import). Empty buckets are included so charts don't
 * collapse gaps. Event time is COALESCE(occurred_at, created_at), consistent
 * with every other temporal view.
 */
export async function getMemoriesTimeseries(params: {
  userId: string;
  days: number;
  bucket: StatsBucket;
}): Promise<TimeseriesPoint[]> {
  const { userId, days, bucket } = params;
  const unit = BUCKET_UNIT[bucket]; // whitelisted → safe for sql.raw

  const rows = await db.execute(sql`
    WITH series AS (
      SELECT generate_series(
        date_trunc(${bucket}, now()) - ((${days}::int - 1) * INTERVAL '1 ${sql.raw(unit)}'),
        date_trunc(${bucket}, now()),
        INTERVAL '1 ${sql.raw(unit)}'
      ) AS bucket_start
    )
    SELECT s.bucket_start, m.source, count(m.id)::int AS n
    FROM series s
    LEFT JOIN memories m
      ON m.user_id = ${userId}
     AND date_trunc(${bucket}, COALESCE(m.occurred_at, m.created_at)) = s.bucket_start
    GROUP BY s.bucket_start, m.source
    ORDER BY s.bucket_start
  `);

  const points = new Map<string, TimeseriesPoint>();
  for (const r of asRows(rows)) {
    const raw = r.bucket_start;
    const d = raw instanceof Date ? raw : new Date(String(raw));
    const key = d.toISOString();
    let p = points.get(key);
    if (!p) {
      p = { bucketStart: key, total: 0, bySource: {} };
      points.set(key, p);
    }
    if (r.source == null) continue; // empty bucket marker row
    const source = String(r.source);
    const n = num(r.n);
    p.bySource[source] = n;
    p.total += n;
  }
  return Array.from(points.values());
}

// ---------------------------------------------------------------------------
// Surfacings summary — kind × reaction INCLUDING suppressed candidates
// ---------------------------------------------------------------------------

export interface SurfacingKindSummary {
  kind: string;
  /** every ledger row of this kind, suppressed ones included (analytics view) */
  total: number;
  /** rows blocked by a gate — never shown to the user */
  suppressed: number;
  /** shown but not yet reacted to */
  pending: number;
  reactionCounts: Record<string, number>;
}

export interface SuppressionReasonRow {
  kind: string;
  reason: string;
  count: number;
}

export interface SurfacingsSummary {
  summaries: SurfacingKindSummary[];
  suppressionReasons: SuppressionReasonRow[];
}

/**
 * Deliberately bypasses the usual `suppressed_reason IS NULL` filter (which
 * exists so blocked candidates never reach the user). This is an ANALYTICS
 * surface for tuning the gates — suppressed rows are the whole point here.
 */
export async function getSurfacingsSummary(
  userId: string,
): Promise<SurfacingsSummary> {
  const [kindRows, reactionRows, reasonRows] = await Promise.all([
    db.execute(sql`
      SELECT kind,
             count(*)::int AS total,
             count(*) FILTER (WHERE suppressed_reason IS NOT NULL)::int AS suppressed
      FROM surfacings WHERE user_id = ${userId}
      GROUP BY kind ORDER BY kind`),
    // Reactions only exist on non-suppressed rows (suppressed = never shown),
    // so no extra filter is needed — kept explicit anyway for safety.
    db.execute(sql`
      SELECT kind, reaction, count(*)::int AS n
      FROM surfacings
      WHERE user_id = ${userId}
        AND suppressed_reason IS NULL AND reaction IS NOT NULL
      GROUP BY kind, reaction`),
    db.execute(sql`
      SELECT kind, suppressed_reason AS reason, count(*)::int AS n
      FROM surfacings
      WHERE user_id = ${userId} AND suppressed_reason IS NOT NULL
      GROUP BY kind, suppressed_reason ORDER BY kind, n DESC`),
  ]);

  const reactions = new Map<string, Record<string, number>>();
  for (const r of asRows(reactionRows)) {
    const kind = String(r.kind);
    const map = reactions.get(kind) ?? {};
    map[String(r.reaction)] = num(r.n);
    reactions.set(kind, map);
  }

  const summaries = asRows(kindRows).map((r) => {
    const kind = String(r.kind);
    const total = num(r.total);
    const suppressed = num(r.suppressed);
    const rc = reactions.get(kind) ?? {};
    const reacted = Object.values(rc).reduce((a, b) => a + b, 0);
    return {
      kind,
      total,
      suppressed,
      pending: Math.max(0, total - suppressed - reacted),
      reactionCounts: rc,
    };
  });

  const suppressionReasons = asRows(reasonRows).map((r) => ({
    kind: String(r.kind),
    reason: String(r.reason),
    count: num(r.n),
  }));

  return { summaries, suppressionReasons };
}
