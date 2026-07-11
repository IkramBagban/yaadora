import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * eval_cases — retrieval regression set (spec 01 §3.7, spec 02 §7).
 *
 * A durable, per-user store of `(question -> expected memory ids)` pairs. The
 * authored baseline lives in code (`@repo/core/eval`), but THIS table is the
 * harvest target: every real retrieval failure you hit should be captured here
 * as a new case so the harness grows from real usage, not guesswork.
 *
 * `expectedMemoryIds` is a uuid[] rather than an FK array (Drizzle can't model
 * an FK on an array element). App-level integrity is acceptable — spec 01 §5
 * takes the same stance for `superseded_by`.
 */
export const evalCases = pgTable(
  "eval_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    question: text("question").notNull(),
    expectedMemoryIds: uuid("expected_memory_ids").array().notNull(),
    /** optional freeform: category, why it was added, the failure it guards. */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("eval_cases_user_idx").on(t.userId)],
);

export type EvalCaseRow = typeof evalCases.$inferSelect;
export type NewEvalCaseRow = typeof evalCases.$inferInsert;
