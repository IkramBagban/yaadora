import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { memories } from "./memories";

/**
 * rules — procedural memory (spec 01 D3, spec 02 §2.2).
 *
 * A rule ARRIVES as a raw memory; extraction recognizes the `standing_rule`
 * intent and derives this row, so the class is fully rebuildable and
 * provenance (`sourceMemory`) is always kept. `triggerText` is a situation
 * description (not keywords); the matcher (spec 02 §5.1) embeds turns against
 * `triggerEmbedding`. Editing a rule writes a new correction memory + a new row
 * and supersedes the old via `supersededBy`.
 *
 * `supersededBy` is a self-referential uuid kept as a plain column (app-level
 * integrity, per spec 01 §5), mirroring `facts.supersededBy`.
 */
export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    ruleText: text("rule_text").notNull(), // the behavior to apply, verbatim-faithful
    triggerText: text("trigger_text").notNull(), // situation description, not keywords
    triggerEmbedding: vector("trigger_embedding", { dimensions: 1536 }),
    active: boolean("active").notNull().default(true),
    sourceMemory: uuid("source_memory")
      .notNull()
      .references(() => memories.id), // PROVENANCE, always
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    applyCount: integer("apply_count").notNull().default(0),
    supersededBy: uuid("superseded_by"), // self-ref (set after insert)
  },
  (t) => [
    index("rules_user_active_idx")
      .on(t.userId)
      .where(sql`active`),
  ],
);

export type Rule = typeof rules.$inferSelect;
export type NewRule = typeof rules.$inferInsert;
