import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * entities — canonical people/places/orgs/topics/projects.
 * `profile` + `profileEmbedding` are rebuilt nightly by consolidation (spec 02 §5).
 * Entity linking (spec 02 §2.3) collapses "40 fragments about Urhan" into one node.
 */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(), // person | place | org | topic | project
    canonicalName: text("canonical_name").notNull(),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'`),
    profile: text("profile"), // consolidated summary, rebuilt nightly
    profileEmbedding: vector("profile_embedding", { dimensions: 1536 }),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
    mentionCount: integer("mention_count").notNull().default(0),
  },
  (t) => [
    index("entities_user_type_idx").on(t.userId, t.type),
    index("entities_name_idx").on(t.userId, t.canonicalName),
    index("entities_profile_embedding_idx").using(
      "hnsw",
      t.profileEmbedding.op("vector_cosine_ops"),
    ),
  ],
);

export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
