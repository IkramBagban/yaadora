import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, integer } from "drizzle-orm/pg-core";
import { users } from "./users";
import { memories } from "./memories";

/**
 * reminders — the actionable/scheduling view (spec 01 §3.6).
 * The originating intent still lives as a memory + fact (factType = 'intent').
 * `sourceMemory` carries provenance when the reminder was AI-suggested.
 */
export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    text: text("text").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    // once: dueAt is the exact fire time. daily/weekly: dueAt's clock time is
    // the recurring time-of-day (spec: docs/superpowers/specs/2026-07-15-reminder-recurrence-design.md).
    recurrence: text("recurrence").notNull().default("once"), // once | daily | weekly
    weekdays: integer("weekdays").array(), // 0(Sun)..6(Sat); set only when recurrence='weekly'
    status: text("status").notNull().default("pending"), // pending | done | dismissed
    origin: text("origin").notNull().default("manual"), // manual | suggested
    sourceMemory: uuid("source_memory").references(() => memories.id), // provenance when AI-suggested
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("reminders_due_idx")
      .on(t.userId, t.dueAt)
      .where(sql`status = 'pending'`),
  ],
);

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
