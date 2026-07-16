import { pgTable, uuid, text, timestamp, integer, time } from "drizzle-orm/pg-core";

/**
 * users — every row in the system is scoped by `user_id`.
 * `timezone` is critical: temporal resolution (spec 02 §2.1) resolves relative
 * time expressions against the user's tz at write time.
 *
 * `clerkUserId` links Clerk identity → local row (null only for legacy bootstrap
 * seed users used by eval/seed scripts).
 *
 * Second Brain v2 privacy/budget controls (spec 02 §2.6):
 * `transcriptRetentionDays` (null = keep forever, 0 = digest immediately),
 * `quietHoursStart`/`quietHoursEnd` (local, block push only), and
 * `maxDailySurfacings` (proactive budget across all channels).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").unique(),
  email: text("email").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  transcriptRetentionDays: integer("transcript_retention_days"), // null = keep forever, 0 = digest immediately
  quietHoursStart: time("quiet_hours_start").notNull().default("22:00:00"), // local
  quietHoursEnd: time("quiet_hours_end").notNull().default("08:00:00"), // local
  maxDailySurfacings: integer("max_daily_surfacings").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
