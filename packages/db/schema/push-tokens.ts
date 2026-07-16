import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * push_tokens — device registrations for server-initiated Expo push (spec 01
 * D10, spec 02 §2.6, §6).
 *
 * Keyed by (user, device) so registration upserts the token. Agent-initiated
 * surfacing while the app is closed is tightly budgeted (default ≤1 push/day,
 * quiet hours, every push writes a ledger row).
 */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    deviceId: text("device_id").notNull(),
    expoToken: text("expo_token").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("push_tokens_user_device_uniq").on(t.userId, t.deviceId)],
);

export type PushToken = typeof pushTokens.$inferSelect;
export type NewPushToken = typeof pushTokens.$inferInsert;
