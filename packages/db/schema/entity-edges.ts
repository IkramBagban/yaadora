import {
  pgTable,
  uuid,
  text,
  timestamp,
  real,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { entities } from "./entities";

/**
 * entity_edges — materialized nightly (spec 01 D1, spec 02 §2.5).
 *
 * DERIVED-OF-DERIVED: consolidation rebuilds this from `facts` (which already
 * encode subject→predicate→object) plus co-mention statistics from
 * `memory_entities`. Deleting the table and re-running consolidation must
 * reproduce it — that is the test of the rebuild story. `aId < bId` is
 * normalized; direction lives in `relType`. `evidence` is the multi-provenance
 * memory-id array (fixes the known single-provenance TODO).
 */
export const entityEdges = pgTable(
  "entity_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    aId: uuid("a_id")
      .notNull()
      .references(() => entities.id), // a_id < b_id normalized
    bId: uuid("b_id")
      .notNull()
      .references(() => entities.id), // direction in rel_type
    relType: text("rel_type").notNull(), // "co-founded with", "fell out with", "works at", ...
    status: text("status").notNull().default("active"), // active | unresolved | ended
    strength: real("strength").notNull().default(0), // co-mention frequency × recency
    lastMentioned: timestamp("last_mentioned", { withTimezone: true }),
    evidence: uuid("evidence").array().notNull(), // supporting memory ids (multi-provenance)
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("entity_edges_uniq").on(t.userId, t.aId, t.bId, t.relType),
    index("entity_edges_a_idx").on(t.userId, t.aId),
    index("entity_edges_b_idx").on(t.userId, t.bId),
  ],
);

export type EntityEdge = typeof entityEdges.$inferSelect;
export type NewEntityEdge = typeof entityEdges.$inferInsert;
