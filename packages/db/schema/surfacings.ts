import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { conversations } from "./conversations";

/**
 * surfacings — the ledger (spec 01 D5, spec 02 §2.4).
 *
 * INVARIANT: nothing proactive reaches the user without a row here. Rule
 * applications also log (`kind = 'rule_applied'`) — exempt from nudge budgets
 * but visible in the transparency UI. Suppressed candidates are logged too with
 * `suppressedReason` set (non-null = a gate blocked this candidate; it was
 * NEVER shown, kept for tuning/review). Every gate/budget/cooldown query MUST
 * filter `suppressed_reason IS NULL` so blocked candidates never count.
 *
 * `subjectId` is polymorphic (id in the subject's table, per `subjectType`) so
 * it is a plain uuid, no FK. `evidence` is the multi-provenance memory-id array.
 */
export const surfacings = pgTable(
  "surfacings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // content kind (delivery is `channel`):
    // rule_applied | loop_nudge | edge_nudge | date_nudge | pattern_nudge | absence_nudge
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(), // rule | open_loop | entity_edge | pattern_fact | entity
    subjectId: uuid("subject_id").notNull(), // id in the subject's table (polymorphic, no FK)
    channel: text("channel").notNull(), // conversation | push | chip
    conversationId: uuid("conversation_id").references(() => conversations.id), // nullable (null for push/chip)
    evidence: uuid("evidence").array().notNull(), // memory ids shown as receipts
    shownAt: timestamp("shown_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reaction: text("reaction"), // engaged | dismissed | ignored | null (=pending)
    reactionAt: timestamp("reaction_at", { withTimezone: true }),
    // non-null = a gate blocked this candidate; it was NEVER shown. Kept for tuning/review.
    suppressedReason: text("suppressed_reason"),
  },
  (t) => [
    index("surfacings_user_subject_shown_idx").on(
      t.userId,
      t.subjectType,
      t.subjectId,
      t.shownAt,
    ),
  ],
);

export type Surfacing = typeof surfacings.$inferSelect;
export type NewSurfacing = typeof surfacings.$inferInsert;
