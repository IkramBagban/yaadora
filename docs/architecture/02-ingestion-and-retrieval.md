# Spec 02 — Ingestion, Retrieval & Reasoning (the AI core)

> Prereq: specs `CONTEXT.md` + `01-system-and-data-model.md`. This is where accuracy lives. It
> defines the async ingestion pipeline, the AI-SDK provider layer, hybrid retrieval, decision
> reasoning, consolidation, and evaluation. Everything here is in `@repo/core`, run by `apps/worker`
> (ingestion/consolidation) and `apps/server` (ask/reason).

---

## 1. The AI-SDK provider layer (`@repo/core/ai`)

All model access goes through **one module**. No provider SDK is imported anywhere else.

```ts
// @repo/core/ai/models.ts
import { anthropic } from "@ai-sdk/anthropic";
import { google }    from "@ai-sdk/google";
import { openai }    from "@ai-sdk/openai";

// Two tiers, selected by env. Swapping Claude <-> Gemini is a config change only.
const REGISTRY = {
  anthropic: {
    ingestion: anthropic("claude-haiku-4-5-20251001"),
    reasoning: anthropic("claude-opus-4-8"),        // or claude-sonnet-4-6 for cost
  },
  google: {
    ingestion: google("gemini-flash-latest"),
    reasoning: google("gemini-pro-latest"),
  },
} as const;

const PROVIDER = (process.env.AI_PROVIDER ?? "anthropic") as keyof typeof REGISTRY;

export const ingestionModel = REGISTRY[PROVIDER].ingestion;
export const reasoningModel = REGISTRY[PROVIDER].reasoning;

// Embeddings need a dedicated provider (Anthropic has none). Dimension is FIXED at 1536.
export const embeddingModel = openai.embedding("text-embedding-3-small"); // 1536-d
```

Rules:
- Use the AI SDK's `generateObject` (with zod schemas) for **all extraction** — never parse
  free-form text. Use `generateText`/`streamText` for the Ask answer.
- Use `embed` / `embedMany` for embeddings. Batch with `embedMany` in ingestion.
- Model IDs live only in this file. If the embedding model ever changes, it's a re-embedding
  migration (the DB column is 1536-d).
- Keep provider keys in env: `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`,
  and `AI_PROVIDER=anthropic|google`.

---

## 2. Ingestion pipeline (BullMQ `ingestion` queue, one job per memory)

Runs within seconds of capture. **The entire extraction (stages 2.1–2.4) is ONE `generateObject`
call** against the cheap ingestion model — classify + temporal + entities + facts in a single
structured output. This keeps cost per memory near-zero. Stages 2.5–2.6 are deterministic DB work.

### Single structured-extraction schema (zod)

```ts
const Extraction = z.object({
  occurredAt: z.string().nullable(),           // ISO; resolved against createdAt + user tz, null if unknown
  types: z.array(z.enum([
    "episodic","semantic","preference","intent","reflection",
  ])).min(1),
  entities: z.array(z.object({
    surface: z.string(),                        // as written ("Urhan")
    type: z.enum(["person","place","org","topic","project"]),
    canonicalGuess: z.string(),                 // normalized ("Urhan")
  })),
  facts: z.array(z.object({
    subject: z.string(),                        // entity surface or "user"
    predicate: z.string(),
    object: z.string(),
    factText: z.string(),                       // natural-language atomic statement
    validFrom: z.string().nullable(),
    factType: z.enum(["semantic","preference","intent","episodic"]),
    confidence: z.number().min(0).max(1),
  })),
  intent: z.object({                            // for the reminder engine; null if none
    hasFutureAction: z.boolean(),
    dueAt: z.string().nullable(),
    text: z.string().nullable(),
  }).nullable(),
});
```

### 2.1 Temporal resolution
Resolve every relative time expression against `memory.createdAt` + `user.timezone`. "today" →
absolute date; "last Tuesday" → absolute; distinguish `createdAt` (when written) from `occurredAt`
(when it happened). Half of all queries are temporal, and embeddings are time-blind — so time must
become a concrete timestamp at **write** time. Pass the current date + tz into the prompt.

### 2.2 Classification
`types[]` drives retrieval strategy and consolidation. `intent` feeds the reminder engine.

### 2.3 Entity extraction **and linking** (the accuracy backbone)
Extraction gives candidate mentions; **linking** is a deterministic step after the LLM call:

1. **Candidate lookup** per mention: alias/`canonical_name` match **+** embedding similarity of the
   mention against existing `entities.profile_embedding` (scoped to user + type).
2. **Resolve:** confident match → link to existing entity. Ambiguous (two "Urhan"s) → a small
   disambiguation `generateObject` call using the candidate entity profiles + this memory's context.
   No match → create a new entity.
3. Upsert a `memory_entities` edge for every resolved mention; bump `mention_count`, `last_seen`,
   extend `aliases`.

This is what turns "40 fragments about Urhan" into one entity node — the fix for entity fragmentation.

### 2.4 Atomic fact extraction
Decompose into smallest independently-true statements, each anchored to subject/predicate/object +
time. One-line entries still pass through: a one-liner yields one fact, or **zero** (a pure
reflection just gets embedded + typed — no fact). Extraction adapts to input size; it never blocks
capture. **Every fact gets `sourceMemory` = this memory (provenance, always).**

> **Why extract at all if a one-line memory is "already the memory"?** Because the raw text is the
> *record*, not the *index*. Raw RAG can't resolve time, can't unify entity mentions, and can't
> represent that a fact changed. Extraction builds queryable structure *on top of* the immutable raw
> line — it never replaces it.

### 2.5 Contradiction & update detection (kills the memory-A-vs-B problem)
For each new fact, query existing **currently-valid** facts with same `subjectId` + similar
predicate (embedding + lexical):
- **Duplicate** → bump `confidence`/mention, don't store twice.
- **Update** ("moved to Pune" vs "lives in Mumbai") → set old fact `validTo = occurredAt`,
  `supersededBy = newId`. Nothing deleted — "where did Urhan live in January?" still answerable.
- **Genuine conflict** (same period, incompatible) → keep both, flag, and surface to the user:
  "You mentioned X earlier — has this changed?" (turns an accuracy risk into an engagement feature).

### 2.6 Multi-representation embeddings (`embedMany`)
Embed at three granularities so similar memories don't collide:
1. **Raw memory text** → `memories.embedding` (episodic recall).
2. **Each atomic fact** → `facts.embedding` (precise QA).
3. **Entity profiles** → `entities.profile_embedding` (rebuilt in consolidation).

Finally set `memories.status = 'processed'`. On failure: retry with BullMQ backoff; after max
retries set `status = 'failed'` and leave raw text intact (it's never lost).

---

## 3. Retrieval engine (`@repo/core/retrieval`) — where accuracy lives

Runs synchronously in `apps/server` for Ask. High recall → hard filters → rerank → grounded answer.

### 3.1 Query understanding (first reasoning-tier call, `generateObject`)
Classify + extract filters:
- `queryType`: `episodic | entity | factual | temporal | decision`
- `entities[]` → resolve to entity IDs via alias + embedding
- `timeRange` → absolute `[from, to]` or null
- `searchQueries[]` → 1–3 rewritten queries (multi-query expansion)

### 3.2 Hybrid candidate retrieval (parallel channels, union) — raw SQL in `@repo/db`

| Channel | Mechanism | Catches |
|---|---|---|
| **Vector** | pgvector cosine over `facts.embedding` + `memories.embedding` | semantic similarity |
| **Lexical** | Postgres `tsvector` / `ts_rank` over `memories.fts` (+ facts) | exact names, rare terms embeddings miss |
| **Graph** | resolved entity IDs → their facts + linked memories + 1-hop neighbors (indexed FK joins; `WITH RECURSIVE` for 2–3 hop) | "everything about Urhan" completeness |
| **Temporal** | `occurred_at` / `valid_from` range filters | "last March", "when I was at X" |

**Temporal and entity constraints are applied as hard SQL `WHERE` predicates**, not similarity
hopes. This is the single biggest accuracy win over naive RAG — wrong-time/wrong-person candidates
never enter ranking. Prefer `valid_to IS NULL` (current) facts unless the query is historical.

### 3.3 Rerank & assemble
- Union ~50–100 candidates → **rerank** to top 10–15. Start with an LLM rerank (`generateObject`
  scoring) for simplicity; swap to a cross-encoder (`bge-reranker`) if latency/cost demands.
- Salience (spec §5) is a tie-breaker prior in reranking, never a filter.
- Assemble context: reranked facts + **their source-memory snippets** + entity profiles + timestamps.

### 3.4 Grounded answer generation (reasoning tier, streamed)
- Answer cites sources inline: "You met Urhan on July 3rd *(memory: 'Met Urhan today…')*", tap-through
  to the raw memory (server returns `citations: [{ memoryId, snippet }]`).
- **Groundedness guard:** every claim must map to a retrieved source. If retrieval confidence is low
  or nothing relevant is found, answer **"I don't have a memory about that."** Never fabricate a
  memory — a memory app that invents memories is dead on arrival. Enforce via a post-generation check
  or a strict system prompt + a "no sources → refuse" branch before generation.

---

## 4. Ask / Reason — decision mode (`@repo/core/reason`)

Simple questions: single-pass §3 retrieval → grounded answer.

Decisions ("should I take this offer?") trigger a bounded agent loop:
1. **Decompose** — what does this decision depend on? (values, constraints, similar past situations,
   relevant people/facts). One reasoning-tier `generateObject` producing sub-queries.
2. **Multi-hop retrieval** — run §3 retrieval once per dimension: preference/value memories; similar
   past decisions **and their logged outcomes**; current constraints; consolidation pattern-insights.
3. **Reason** — weigh the retrieved evidence, cite every memory used, present tradeoffs.
   Output is *"here's what your own history says about X,"* not *"do X."*
4. **Outcome loop** — after a decision, later prompt "how did it go?". The logged outcome becomes a
   new memory that informs future decisions. This compounds over time.

Keep the loop bounded (max N retrieval rounds) to cap latency/cost.

---

## 5. Consolidation — nightly "sleep" (BullMQ repeatable job, `apps/worker`)

Scheduled via a BullMQ repeatable job (cron, e.g. 03:00 in the user's tz). What makes the system
feel alive over months:

1. **Entity profile rebuild** — regenerate `entities.profile` (+ re-embed) from all current facts
   about entities touched that day. Keeps "tell me about Urhan" fast and complete.
2. **Fact dedup/merge** — cluster near-duplicate facts, merge, boost confidence on repeats.
3. **Pattern mining** — detect recurring correlations across episodic memories ("low energy in 9/12
   late-night-work entries"). Store as `facts` with `origin = 'consolidation'`, provenance = the
   contributing memories. This is the fuel for decision mode.
4. **Salience scoring** — recency × frequency × emotional weight × user pins. **Never deletes**;
   salience is only a retrieval tie-breaker prior.

Consolidation is fully rebuildable from the immutable `memories` log — if logic changes, re-run it.

---

## 6. Reminder engine

- Ingestion stage 2.2/2.4 flags `intent` with a future `dueAt` → server returns a suggestion the app
  shows: "Remind you Friday to call the bank?" One tap → insert a `reminders` row
  (`origin = 'suggested'`, `sourceMemory` set).
- Manual reminders = a `reminders` row (`origin = 'manual'`), and also a memory so it's in the graph.
- A small BullMQ repeatable job scans due reminders and issues push notifications (Expo push, spec 03).

---

## 7. Evaluation (build from day one)

Retrieval accuracy **is** the product, so treat it like code:
- `eval_cases` table (spec 01 §3.7) holds `(question → expected memory IDs)` pairs harvested from
  real usage and every retrieval failure you hit.
- A `bun run eval` script in `@repo/core` runs all cases through §3 retrieval and reports
  recall@k / MRR / grounded-answer correctness.
- **Every change to extraction, ranking, or prompts must run the eval set before merge.** No
  retrieval PR merges on vibes.

---

## 8. Why accuracy doesn't degrade at scale (summary)

1. **Atomic facts > chunks** — discriminative units anchored to entities + dates, not fuzzy prose.
2. **Hard filters** — time/entity as SQL predicates; wrong candidates never enter ranking.
3. **Supersession** — stale facts marked invalid; "current truth" queries can't return outdated answers.
4. **Rerank** — precision pass over a high-recall pool.
5. **Provenance + correction** — wrong answers are traceable to a memory; fixes propagate (edit fact,
   rebuild profile).
6. **Consolidation** — dedup + profiles prevent the "40 fragments" problem entirely.

---

## 9. Cost discipline

Ingestion runs on every memory forever — it must be near-free. One structured call on the cheap tier
per memory (+ batched embeddings + optional tiny disambiguation call). Reserve the reasoning tier for
Ask/Reason only. If ingestion cost creeps, you'll hesitate to build on it — guard it.
