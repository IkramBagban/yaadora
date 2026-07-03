import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  real,
  vector,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { entities } from "./entities";
import { memories } from "./memories";

/**
 * facts — derived atomic semantic units. The graph edges live here.
 *
 * Opposite mutability to `memories`: facts are a MUTABLE index that is
 * superseded/merged/reweighted as knowledge changes. `sourceMemory` is the
 * provenance link back to the immutable memory that produced the fact and is
 * ALWAYS set (CONTEXT.md core principle — never compromise provenance).
 *
 * `supersededBy` is a self-referential uuid kept as a plain column (app-level
 * integrity, per spec 01 §5) — the FK can be added in a follow-up migration.
 */
export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    subjectId: uuid("subject_id").references(() => entities.id), // graph edge: subject → object
    predicate: text("predicate"),
    objectText: text("object_text"),
    objectId: uuid("object_id").references(() => entities.id), // nullable (literal objects)
    factText: text("fact_text").notNull(), // natural-language form
    embedding: vector("embedding", { dimensions: 1536 }),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }), // null = currently true
    supersededBy: uuid("superseded_by"), // self-ref (set after insert)
    confidence: real("confidence").notNull().default(0.7),
    factType: text("fact_type").notNull().default("semantic"), // semantic | preference | intent | episodic
    origin: text("origin").notNull().default("extraction"), // extraction | consolidation
    sourceMemory: uuid("source_memory")
      .notNull()
      .references(() => memories.id), // PROVENANCE, always
    // Salience prior (spec 02 §5.4): recency × frequency × emotional weight × pins.
    // Rebuilt nightly by consolidation; used ONLY as a rerank tie-breaker in
    // retrieval — never a filter, never deletes.
    salience: real("salience").notNull().default(0),
    // Genuine-conflict flag (spec 02 §2.5): points at the incompatible fact from
    // the same period. Non-null → surface to the user ("has this changed?").
    // Plain uuid (app-level integrity, like superseded_by).
    conflictsWith: uuid("conflicts_with"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("facts_subject_idx").on(t.subjectId), // graph traversal (Postgres, not Neo4j)
    index("facts_object_idx").on(t.objectId),
    index("facts_current_idx")
      .on(t.userId, t.subjectId)
      .where(sql`valid_to IS NULL`), // "current truth" fast path
    index("facts_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;
