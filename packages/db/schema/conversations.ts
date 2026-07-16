import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * conversations — chats become durable data (spec 01 D2, spec 02 §2.1).
 *
 * The server stays RAM-stateless: the client sends `conversationId` and the
 * server loads turns. A conversation goes `idle` after 30 min without a turn
 * (checked lazily / by cron); idle triggers `summary` generation and the
 * conversation-capture sweep. `summary` is derived and rebuildable.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastTurnAt: timestamp("last_turn_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("active"), // active | idle | closed
    summary: text("summary"), // derived; updated when idle/closed
    turnCount: integer("turn_count").notNull().default(0),
  },
  (t) => [index("conversations_user_last_turn_idx").on(t.userId, t.lastTurnAt)],
);

/**
 * conversation_turns — one row per user/assistant message (spec 02 §2.1).
 *
 * `meta` carries provenance for what the assistant did this turn
 * ({searches, citations, ruleIdsApplied, surfacingIds}). Retention: a nightly
 * job hard-deletes turns older than the user's `transcriptRetentionDays` only
 * if the conversation summary exists; summaries/memories/ledger are never
 * auto-deleted.
 */
export const conversationTurns = pgTable(
  "conversation_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Provenance for what the assistant did this turn:
    // {searches, citations, ruleIdsApplied, surfacingIds}
    meta: jsonb("meta"),
  },
  (t) => [
    index("conversation_turns_conversation_idx").on(
      t.conversationId,
      t.createdAt,
    ),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationTurn = typeof conversationTurns.$inferSelect;
export type NewConversationTurn = typeof conversationTurns.$inferInsert;
