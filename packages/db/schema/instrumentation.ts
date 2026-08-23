import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Usage instrumentation (issue #30) — the first-party, per-user tracking
 * foundation behind admin analytics.
 *
 * Four concerns, four tables:
 *   - `user_activity_days`   daily per-user rollup; `requests` powers streaks/
 *                            DAU/retention, the other columns are cheap
 *                            contextual counters.
 *   - `ai_usage_daily`       token/call/latency rollup keyed by
 *                            user × day × tier × model × phase. The prod
 *                            counterpart of the eval-only Redis tracker
 *                            (`@repo/core` usage-tracker), which stays as-is.
 *   - `api_requests`         raw request log (method/path/status/latency).
 *                            RETENTION INTENT: ~90 days — prune older rows in
 *                            a future maintenance job before this grows
 *                            unbounded.
 *   - `consolidation_runs`   one row per nightly consolidation execution with
 *                            the counters the job already logs.
 *
 * All days are UTC dates ('YYYY-MM-DD'). Rollups are written fire-and-forget:
 * a tracking failure must never fail the user-facing request that produced it.
 */

/**
 * user_activity_days — one row per user per UTC day that had any activity.
 * Rows are created lazily by upsert on first event; PK (user_id, day).
 */
export const userActivityDays = pgTable(
  "user_activity_days",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(), // UTC date, 'YYYY-MM-DD'
    /** Authenticated API requests served this day (streak source of truth). */
    requests: integer("requests").notNull().default(0),
    memoriesCreated: integer("memories_created").notNull().default(0),
    /** Conversation turns (Ask / durable conversations). */
    turns: integer("turns").notNull().default(0),
    remindersDone: integer("reminders_done").notNull().default(0),
    /** memories_created split by capture source (manual | voice | …). */
    capturesBySource: jsonb("captures_by_source")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    index("user_activity_days_day_idx").on(t.day),
  ],
);

/**
 * ai_usage_daily — LLM consumption rollup. One row per
 * user × UTC day × tier × model × phase; counters increment via upsert.
 * Token columns are plain int: a single bucket's daily totals never approach
 * 2^31 (the bigint default was deliberately dropped).
 */
export const aiUsageDaily = pgTable(
  "ai_usage_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(), // UTC date, 'YYYY-MM-DD'
    /** ingestion | reasoning | fast — tier from ai/models.ts */
    tier: text("tier").notNull(),
    /** provider:modelId as configured in ai/models.ts */
    model: text("model").notNull(),
    /** ingest | retrieve | transcribe | other */
    phase: text("phase").notNull(),
    calls: integer("calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMsSum: integer("latency_ms_sum").notNull().default(0),
  },
  (t) => [
    uniqueIndex("ai_usage_daily_user_day_tier_model_phase_uq").on(
      t.userId,
      t.day,
      t.tier,
      t.model,
      t.phase,
    ),
  ],
);

/**
 * api_requests — raw HTTP traffic log, one row per routed server response.
 * `userId` is NULL for unauthenticated requests (e.g. 401s) so traffic
 * analysis still sees them.
 *
 * RETENTION INTENT: keep ~90 days; prune older rows in a maintenance job.
 */
export const apiRequests = pgTable(
  "api_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => [index("api_requests_user_ts_idx").on(t.userId, t.ts.desc())],
);

/**
 * Counters payload persisted by the nightly consolidation job (apps/worker →
 * runConsolidation). Deliberately opaque here so the report shape can evolve
 * without a migration; consumers treat it as read-only JSON.
 */
export type ConsolidationRunCounters =
  | Record<string, unknown>
  | Array<Record<string, unknown>>
  | null;

/**
 * consolidation_runs — history of nightly consolidation executions.
 * status 'running' while in flight, then 'ok' | 'error'; `error` carries the
 * message when status='error'.
 */
export const consolidationRuns = pgTable("consolidation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(), // 'ok' | 'error'
  counters: jsonb("counters").$type<ConsolidationRunCounters>(),
  error: text("error"),
});

export type UserActivityDay = typeof userActivityDays.$inferSelect;
export type NewUserActivityDay = typeof userActivityDays.$inferInsert;
export type AiUsageDaily = typeof aiUsageDaily.$inferSelect;
export type NewAiUsageDaily = typeof aiUsageDaily.$inferInsert;
export type ApiRequestRow = typeof apiRequests.$inferSelect;
export type ConsolidationRun = typeof consolidationRuns.$inferSelect;
