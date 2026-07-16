import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * digests — small, cache-like, rebuildable summaries (spec 02 §3.2).
 *
 * Consolidation writes a per-user 7-day digest (`kind = 'week'`) and refreshes
 * the profile summary (`kind = 'profile'`) nightly. Keyed by (user, kind), so a
 * unique constraint lets consolidation upsert. Cheap and fully rebuildable from
 * the log.
 */
export const digests = pgTable(
  "digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(), // profile | week
    content: text("content"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("digests_user_kind_uniq").on(t.userId, t.kind)],
);

export type Digest = typeof digests.$inferSelect;
export type NewDigest = typeof digests.$inferInsert;
