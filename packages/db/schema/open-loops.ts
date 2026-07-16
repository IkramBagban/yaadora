import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { entities } from "./entities";
import { memories } from "./memories";

/**
 * open_loops — unfinished things attached to entities and dates (spec 01 D4,
 * spec 02 §2.3).
 *
 * Facts state what's true; loops track what's UNFINISHED — a lifecycle
 * (open → resolved | expired), not a truth value. Created by extraction and
 * consolidation; resolved when a later memory clearly closes it (provenance in
 * `resolvedBy`). `upcoming_event` loops auto-expire after `dueAt` + 7 days.
 * `sourceMemory` is provenance, always.
 */
export const openLoops = pgTable(
  "open_loops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(), // commitment | unresolved_conflict | upcoming_event | goal
    title: text("title").notNull(), // "Equity split with Rahul never resolved"
    entityId: uuid("entity_id").references(() => entities.id), // nullable
    dueAt: timestamp("due_at", { withTimezone: true }), // nullable; set for upcoming_event, some commitments
    status: text("status").notNull().default("open"), // open | resolved | expired
    resolvedBy: uuid("resolved_by").references(() => memories.id), // the memory that closed it, nullable
    sourceMemory: uuid("source_memory")
      .notNull()
      .references(() => memories.id), // PROVENANCE
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSurfacedAt: timestamp("last_surfaced_at", { withTimezone: true }),
  },
  (t) => [
    index("open_loops_user_status_due_idx").on(t.userId, t.status, t.dueAt),
    index("open_loops_user_entity_idx")
      .on(t.userId, t.entityId)
      .where(sql`status = 'open'`),
  ],
);

export type OpenLoop = typeof openLoops.$inferSelect;
export type NewOpenLoop = typeof openLoops.$inferInsert;
