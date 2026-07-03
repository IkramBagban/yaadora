import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * users — every row in the system is scoped by `user_id`.
 * `timezone` is critical: temporal resolution (spec 02 §2.1) resolves relative
 * time expressions against the user's tz at write time.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
