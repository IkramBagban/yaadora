# Spec 01 — System Architecture & Data Model

> Prereq: read `docs/CONTEXT.md`. This spec defines the runtime topology, the packages, and the
> **canonical Postgres data model in Drizzle**. Specs 02 and 03 build on the tables defined here.

---

## 1. Runtime topology

```
  ┌────────────────┐         HTTPS/JSON          ┌───────────────────────────┐
  │  apps/mobile   │  ───────────────────────▶   │        apps/server        │
  │  (Expo / RN)   │  ◀───────────────────────   │       (Bun.serve)         │
  └────────────────┘                             │  auth · capture · ask     │
        local write queue                        │  reasoning · reminders    │
        (offline-first)                          └───────────┬───────────────┘
                                                             │
                        enqueue job (BullMQ)                 │  read/write
                                                             ▼
                             ┌──────────────┐        ┌──────────────────────┐
                             │    Redis     │◀──────▶│  PostgreSQL + pgvector │
                             │  (BullMQ)    │        │  episodic · facts ·    │
                             └──────┬───────┘        │  entities · graph ·    │
                                    │                │  vectors · reminders   │
                        consume jobs│                └───────────▲───────────┘
                                    ▼                            │ read/write
                             ┌──────────────────────────────────┴───────────┐
                             │                 apps/worker                    │
                             │  ingestion pipeline (per memory)               │
                             │  nightly consolidation (cron via BullMQ)       │
                             └────────────────────────────────────────────────┘
```

**Golden rule of the write path:** `POST /memories` does exactly two things synchronously —
(1) `INSERT` the raw row, (2) enqueue a BullMQ ingestion job — then returns `201`. All intelligence
(extraction, embeddings, linking) happens asynchronously in the worker. The user never waits on an LLM.

**Read/ask path** is synchronous in `apps/server` (retrieval + one or more LLM calls), because the
user is actively waiting for an answer. See spec 02.

---

## 2. Packages & responsibilities

| Package | Runtime | Owns |
|---|---|---|
| `apps/server` | Bun | HTTP API (`Bun.serve` + a light router), auth, request validation (zod), capture endpoint, ask/reason endpoints, reminders CRUD. Calls `@repo/db` and `@repo/core`. |
| `apps/worker` | Bun | BullMQ `Worker`s: `ingestion` queue (per-memory pipeline) and `consolidation` queue (nightly, scheduled via BullMQ repeatable jobs). Calls `@repo/db` and `@repo/core`. |
| `@repo/db` | lib | Drizzle schema, migrations (`drizzle-kit`), the DB client, and **typed query helpers** for hybrid retrieval (raw SQL lives here, not in apps). |
| `@repo/core` | lib | The AI-SDK provider layer, prompt templates, zod schemas for structured extraction, the ingestion stage functions, and the retrieval/reasoning orchestration. Shared by `server` + `worker`. |

> **Why `@repo/core`:** both the worker (ingestion) and the server (ask/reason) need the model
> layer and the retrieval helpers. Putting them in a shared package prevents drift and keeps
> `apps/*` thin. Create it as a Bun library package (no build step needed; export `.ts` directly
> like `@repo/db`).

### `@repo/db` setup notes (migrating off Prisma)

- Remove `@prisma/client` / `prisma` from `packages/db/package.json`. Add `drizzle-orm`,
  `drizzle-kit`, and `postgres` (postgres.js) **or** use Drizzle's Bun-SQL driver.
  Recommended driver: `drizzle-orm/postgres-js` with the `postgres` package — most battle-tested
  with pgvector + migrations. (Bun's native `Bun.sql` driver for Drizzle is fine too; pick one and
  document it.)
- `drizzle.config.ts` reads `DATABASE_URL` from env (Bun auto-loads `.env`; no `dotenv`).
- Export from `packages/db/index.ts`: the `db` client, all schema tables, and the query helpers.
- Enable the extension in the first migration: `CREATE EXTENSION IF NOT EXISTS vector;`

---

## 3. Data model (Drizzle)

Five core tables plus reminders and eval. All embeddings are `vector(1536)`. All rows are scoped by
`user_id`. This is the canonical schema — implement it in `packages/db/schema/`.

### 3.1 `users`

```ts
export const users = pgTable("users", {
  id:        uuid("id").primaryKey().defaultRandom(),
  email:     text("email").notNull().unique(),
  timezone:  text("timezone").notNull().default("UTC"), // critical for temporal resolution
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### 3.2 `memories` — episodic ground truth (immutable)

```ts
export const memories = pgTable("memories", {
  id:         uuid("id").primaryKey().defaultRandom(),
  userId:     uuid("user_id").notNull().references(() => users.id),
  rawText:    text("raw_text").notNull(),                 // verbatim, NEVER modified
  occurredAt: timestamp("occurred_at", { withTimezone: true }), // resolved event time (may != createdAt)
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  source:     text("source").notNull().default("manual"), // manual | voice | import
  embedding:  vector("embedding", { dimensions: 1536 }),
  status:     text("status").notNull().default("pending"),// pending | processing | processed | failed
  // full-text search vector, generated from raw_text (see §4)
}, (t) => ({
  userIdx:      index("memories_user_idx").on(t.userId),
  occurredIdx:  index("memories_occurred_idx").on(t.userId, t.occurredAt),
  embeddingIdx: index("memories_embedding_idx")
                  .using("hnsw", t.embedding.op("vector_cosine_ops")),
}));
```

> `raw_text` is sacred. No pipeline stage ever writes back to it. Corrections happen at the fact
> layer, not here.

### 3.3 `entities` — canonical people/places/orgs/topics/projects

```ts
export const entities = pgTable("entities", {
  id:               uuid("id").primaryKey().defaultRandom(),
  userId:           uuid("user_id").notNull().references(() => users.id),
  type:             text("type").notNull(),        // person | place | org | topic | project
  canonicalName:    text("canonical_name").notNull(),
  aliases:          text("aliases").array().notNull().default(sql`'{}'`),
  profile:          text("profile"),               // consolidated summary, rebuilt nightly
  profileEmbedding: vector("profile_embedding", { dimensions: 1536 }),
  firstSeen:        timestamp("first_seen", { withTimezone: true }),
  lastSeen:         timestamp("last_seen", { withTimezone: true }),
  mentionCount:     integer("mention_count").notNull().default(0),
}, (t) => ({
  userTypeIdx:  index("entities_user_type_idx").on(t.userId, t.type),
  nameIdx:      index("entities_name_idx").on(t.userId, t.canonicalName),
  profileIdx:   index("entities_profile_embedding_idx")
                  .using("hnsw", t.profileEmbedding.op("vector_cosine_ops")),
}));
```

### 3.4 `memory_entities` — mention edges (memory ↔ entity)

```ts
export const memoryEntities = pgTable("memory_entities", {
  memoryId: uuid("memory_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
}, (t) => ({
  pk:        primaryKey({ columns: [t.memoryId, t.entityId] }),
  entityIdx: index("memory_entities_entity_idx").on(t.entityId), // "memories mentioning X"
}));
```

### 3.5 `facts` — derived atomic semantic units (the graph edges live here)

```ts
export const facts = pgTable("facts", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userId:       uuid("user_id").notNull().references(() => users.id),
  subjectId:    uuid("subject_id").references(() => entities.id),   // graph edge: subject → object
  predicate:    text("predicate"),
  objectText:   text("object_text"),
  objectId:     uuid("object_id").references(() => entities.id),    // nullable (literal objects)
  factText:     text("fact_text").notNull(),                        // natural-language form
  embedding:    vector("embedding", { dimensions: 1536 }),
  validFrom:    timestamp("valid_from", { withTimezone: true }),
  validTo:      timestamp("valid_to", { withTimezone: true }),      // null = currently true
  supersededBy: uuid("superseded_by"),                             // self-ref (set after insert)
  confidence:   real("confidence").notNull().default(0.7),
  factType:     text("fact_type").notNull().default("semantic"),   // see spec 02 classification
  origin:       text("origin").notNull().default("extraction"),    // extraction | consolidation
  sourceMemory: uuid("source_memory").notNull().references(() => memories.id), // PROVENANCE, always
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  subjectIdx:   index("facts_subject_idx").on(t.subjectId),   // graph traversal (spec 04 answer: Postgres, not Neo4j)
  objectIdx:    index("facts_object_idx").on(t.objectId),
  currentIdx:   index("facts_current_idx").on(t.userId, t.subjectId).where(sql`valid_to IS NULL`),
  embeddingIdx: index("facts_embedding_idx")
                  .using("hnsw", t.embedding.op("vector_cosine_ops")),
}));
```

> **Why facts and memories are separate tables** (recurring question): they have *opposite
> mutability semantics*. `memories` is immutable episodic truth; `facts` are a mutable index that
> gets superseded/merged/reweighted as knowledge changes. `sourceMemory` unifies them — facts are an
> *index over* memories, not a sibling dataset. You cannot collapse them without either rewriting the
> diary or losing episodic texture.

> **Why the graph lives in Postgres, not Neo4j:** every query we need is 1–2 hops scoped to one
> user ("facts about Urhan", "entities connected to Urhan"). Indexed FK joins do this in
> microseconds. A graph DB earns its cost only for deep variable-length traversals over huge graphs —
> not a personal memory graph. Keeping vectors + facts + graph + full-text in **one Postgres, one
> transaction** is exactly what makes hybrid retrieval (spec 02) clean. For occasional 2–3 hop
> expansion use `WITH RECURSIVE`. Escape hatch if ever needed: the **Apache AGE** Postgres extension
> adds Cypher — no migration to Neo4j required. Prediction: never needed here.

### 3.6 `reminders`

```ts
export const reminders = pgTable("reminders", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userId:       uuid("user_id").notNull().references(() => users.id),
  text:         text("text").notNull(),
  dueAt:        timestamp("due_at", { withTimezone: true }).notNull(),
  status:       text("status").notNull().default("pending"), // pending | done | dismissed
  origin:       text("origin").notNull().default("manual"),  // manual | suggested
  sourceMemory: uuid("source_memory").references(() => memories.id), // provenance when AI-suggested
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dueIdx: index("reminders_due_idx").on(t.userId, t.dueAt).where(sql`status = 'pending'`),
}));
```

> Reminders are also memories conceptually — "did I call the bank?" is answerable because the
> reminder and its completion are in the graph. The `reminders` table is the actionable/scheduling
> view; the originating intent still lives as a `memory` + `fact` with `factType = 'intent'`.

### 3.7 `eval_cases` — retrieval regression set (see spec 02)

```ts
export const evalCases = pgTable("eval_cases", {
  id:               uuid("id").primaryKey().defaultRandom(),
  userId:           uuid("user_id").notNull().references(() => users.id),
  question:         text("question").notNull(),
  expectedMemoryIds:uuid("expected_memory_ids").array().notNull(),
  note:             text("note"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

## 4. Full-text search (lexical channel)

The lexical retrieval channel needs a `tsvector`. Add it as a **generated column** on `memories`
(and optionally `facts.factText`) via raw SQL in a migration, since Drizzle doesn't model generated
tsvector columns natively:

```sql
ALTER TABLE memories ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', raw_text)) STORED;
CREATE INDEX memories_fts_idx ON memories USING GIN (fts);
```

Represent `fts` in Drizzle as an untracked/`customType` column or just query it via raw SQL in the
`@repo/db` helpers. Same treatment for `facts.fact_text` if lexical fact search is enabled.

---

## 5. Indexing & performance notes

- **HNSW over IVFFlat** for vector indexes: better recall/latency at our scale, no training step.
  Use `vector_cosine_ops` (embeddings are cosine-normalized by the AI SDK models we use).
- Partial index `facts_current_idx WHERE valid_to IS NULL` keeps "current truth" lookups fast.
- All hot query paths are covered by the indexes above; add composite indexes only when the eval
  set shows a real query pattern needs one. Don't pre-optimize.
- `superseded_by` is a self-referential FK; add the constraint in a follow-up migration after the
  table exists, or leave it as a plain uuid with app-level integrity (simpler; acceptable).

---

## 6. Migrations & environments

- Migrations authored with **`drizzle-kit`**, checked into `packages/db/drizzle/`.
- First migration: `CREATE EXTENSION vector;` + all tables + the tsvector generated columns/indexes.
- Local dev: Postgres 16+ with `pgvector` (Docker: `pgvector/pgvector:pg16`) and a Redis container.
  Add a `docker-compose.yml` at repo root for both. Bun auto-loads `.env`.
- `DATABASE_URL` and `REDIS_URL` are the only required infra env vars; model provider keys are in
  spec 02.
