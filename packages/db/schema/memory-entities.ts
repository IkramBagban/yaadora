import { pgTable, uuid, index, primaryKey } from "drizzle-orm/pg-core";
import { memories } from "./memories";
import { entities } from "./entities";

/**
 * memory_entities — mention edges (memory ↔ entity).
 * The `entity_idx` powers "memories mentioning X" lookups (graph channel, spec 02 §3.2).
 */
export const memoryEntities = pgTable(
  "memory_entities",
  {
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.memoryId, t.entityId] }),
    index("memory_entities_entity_idx").on(t.entityId),
  ],
);

export type MemoryEntity = typeof memoryEntities.$inferSelect;
export type NewMemoryEntity = typeof memoryEntities.$inferInsert;
