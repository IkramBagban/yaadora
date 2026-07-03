import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  vector,
  boolean,
  real,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { tsvector } from "./columns";

/**
 * memories — episodic ground truth. IMMUTABLE.
 *
 * `raw_text` is sacred: no pipeline stage ever writes back to it. Corrections
 * happen at the fact layer, never here (CONTEXT.md core principle).
 *
 * `fts` is a generated tsvector column derived from `raw_text` (spec 01 §4).
 * It is `GENERATED ALWAYS AS (...) STORED`, so it is never written by the app.
 */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    rawText: text("raw_text").notNull(), // verbatim, NEVER modified
    occurredAt: timestamp("occurred_at", { withTimezone: true }), // resolved event time (may != createdAt)
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text("source").notNull().default("manual"), // manual | voice | import
    embedding: vector("embedding", { dimensions: 1536 }),
    status: text("status").notNull().default("pending"), // pending | processing | processed | failed
    // Salience prior (spec 02 §5.4) — rebuilt nightly, rerank tie-breaker only.
    salience: real("salience").notNull().default(0),
    // User pin: a hard boost input to the salience score. Immutable raw_text is
    // untouched; pinning is metadata, never a content edit.
    pinned: boolean("pinned").notNull().default(false),
    // Lexical channel: generated tsvector over raw_text (spec 01 §4).
    fts: tsvector("fts").generatedAlwaysAs(
      sql`to_tsvector('english', "raw_text")`,
    ),
  },
  (t) => [
    index("memories_user_idx").on(t.userId),
    index("memories_occurred_idx").on(t.userId, t.occurredAt),
    index("memories_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("memories_fts_idx").using("gin", t.fts),
  ],
);

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
