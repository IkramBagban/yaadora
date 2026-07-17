# Recall — Memory Architecture Spec

**Goal:** A personal memory system with brain-like structure: perfect episodic recall, consolidated semantic knowledge, time-aware and entity-aware retrieval, and decision reasoning grounded in the user's own history. Accuracy must not degrade as memory count grows.

**Stack assumption:** TypeScript, Node, PostgreSQL + pgvector, Redis + BullMQ, mobile app (React Native / Expo). Everything below maps to this stack.

---

## 0. The Core Principle

**Raw memories are immutable ground truth. Structure is derived, never destructive.**

Every entry the user writes is stored verbatim, forever (episodic layer). Extraction, entity linking, and consolidation build *indexes* over the raw log (semantic layer). If extraction makes a mistake, the ground truth is intact and the index can be rebuilt. This is the hippocampus/cortex split, and it's also what makes the system debuggable.

---

## 1. System Overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  CAPTURE     │ ──▶ │ INGESTION        │ ──▶ │ MEMORY STORE     │
│  (app, <2s)  │     │ PIPELINE (async) │     │ (Postgres)       │
└─────────────┘     └──────────────────┘     └─────────────────┘
                                                     │
        ┌────────────────────────────────────────────┤
        ▼                        ▼                   ▼
┌───────────────┐     ┌──────────────────┐   ┌──────────────────┐
│ CONSOLIDATION │     │ RETRIEVAL ENGINE │   │ REMINDER ENGINE  │
│ (nightly job) │     │ (hybrid, ranked) │   │ (intent-driven)  │
└───────────────┘     └──────────────────┘   └──────────────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ ASK / REASON     │
                      │ (agent loop)     │
                      └──────────────────┘
```

Write path is dumb and instant. All intelligence happens async (ingestion) or at read time (retrieval/reasoning). The user never waits on an LLM to save a memory.

---

## 2. Capture Layer

- One screen, one text box, one save button. Save = insert raw row + enqueue BullMQ job. Sub-second, works offline (local queue, sync later).
- Capture device context automatically: timestamp (with timezone), optional location, entry method.
- No structure demanded from the user. They write one line or two pages; the pipeline adapts.

```sql
CREATE TABLE memories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  raw_text      text NOT NULL,          -- verbatim, never modified
  occurred_at   timestamptz,            -- resolved event time (may differ from created_at)
  created_at    timestamptz DEFAULT now(),
  source        text DEFAULT 'manual',  -- manual | voice | import
  embedding     vector(1536),           -- embedding of raw text
  status        text DEFAULT 'pending'  -- pending | processed | failed
);
```

---

## 3. Ingestion Pipeline (async, per memory)

BullMQ job, runs within seconds of save. Stages:

### 3.1 Temporal resolution
Resolve all relative time expressions against `created_at` + user timezone.
- "today" → 2026-07-03; "last Tuesday" → absolute date; "next month" → interval.
- Distinguish `created_at` (when written) from `occurred_at` (when the event happened). "Writing about last week's trip" — these differ, and queries need both.

### 3.2 Classification
Each memory gets one or more types:
- **episodic** — an event that happened ("met Urhan at the library")
- **semantic** — a fact/concept ("neurons transmit via synapses", "Urhan is from Pune")
- **preference/value** — about the user ("I hate working past midnight")
- **intent/plan** — future-oriented ("need to call the bank Friday") → feeds Reminder Engine
- **reflection** — opinions, feelings, journal-style

Types drive retrieval strategy and consolidation behavior.

### 3.3 Entity extraction & linking (the accuracy backbone)
Extract entity mentions (people, places, orgs, topics, projects). Then **link, don't just extract**:

1. Candidate lookup: alias table match + embedding similarity against existing entities.
2. Disambiguation: if confident match → link. If ambiguous (two Urhans) → LLM disambiguates using entity profiles + memory context. If no match → create new entity.
3. Every mention creates a `memory_entities` edge.

```sql
CREATE TABLE entities (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL,
  type          text,                -- person | place | org | topic | project
  canonical_name text,
  aliases       text[],
  profile       text,               -- consolidated summary, rebuilt by consolidation
  profile_embedding vector(1536),
  first_seen    timestamptz,
  last_seen     timestamptz,
  mention_count int DEFAULT 0
);

CREATE TABLE memory_entities (
  memory_id uuid REFERENCES memories(id),
  entity_id uuid REFERENCES entities(id),
  PRIMARY KEY (memory_id, entity_id)
);
```

### 3.4 Atomic fact extraction
Decompose the entry into atomic facts — the smallest independently-true statements:

> "Met Urhan today at the library, he's doing his masters in AI at Pune University"

→ facts:
- (user) met (Urhan) — occurred 2026-07-03, at library
- (Urhan) studies (Masters in AI) — valid from ~2026
- (Urhan) attends (Pune University)

```sql
CREATE TABLE facts (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL,
  subject_id    uuid REFERENCES entities(id),
  predicate     text,
  object_text   text,
  object_id     uuid REFERENCES entities(id),  -- nullable
  fact_text     text,                 -- natural language form
  embedding     vector(1536),
  valid_from    timestamptz,
  valid_to      timestamptz,          -- null = currently true
  superseded_by uuid REFERENCES facts(id),
  confidence    real,
  source_memory uuid REFERENCES memories(id)   -- PROVENANCE, always
);
```

**Provenance is non-negotiable.** Every fact points to its source memory. Answers cite sources; extraction errors are traceable and fixable.

One-line entries still go through this — a one-liner might produce one fact, or zero (a pure reflection gets embedded and typed, no facts). Extraction adapts to input size; it never blocks capture.

### 3.5 Contradiction & update detection
For each new fact, query existing facts with the same subject + similar predicate:
- **Duplicate** → increment confidence/mention count, don't store twice.
- **Update** ("Urhan moved to Pune" vs "Urhan lives in Mumbai") → set old fact `valid_to = occurred_at`, `superseded_by = new fact`. Nothing deleted — "where did Urhan live in January?" still answerable.
- **Genuine conflict** (same time period, incompatible) → keep both flagged, surface to user: "You mentioned X earlier — has this changed?" This turns your accuracy risk into an engagement feature.

### 3.6 Embedding strategy (multi-representation)
Embed at three granularities:
1. Raw memory text (episodic recall: "that time I wrote about...")
2. Each atomic fact (precise QA)
3. Entity profiles (entity-level questions)

This is the direct fix for "similar memories collide": 50 near-identical gym entries produce discriminative facts anchored to distinct dates, not 50 fuzzy interchangeable chunks.

---

## 4. Retrieval Engine (where accuracy lives)

### 4.1 Query understanding (first LLM call)
Classify the question and extract filters:
- Query type: episodic lookup | entity question | factual | temporal | decision
- Entities mentioned → resolve via alias table
- Time constraints → absolute range
- Rewritten search queries (multi-query expansion)

### 4.2 Hybrid candidate retrieval (parallel)
Run all applicable channels and union:

| Channel | Mechanism | Catches |
|---|---|---|
| Vector | pgvector cosine over facts + memories | semantic similarity |
| Lexical | Postgres `tsvector` / BM25 | exact names, rare terms embeddings miss |
| Graph | resolved entities → their facts + linked memories + 1-hop neighbors | "everything about Urhan" completeness |
| Temporal | `occurred_at` / `valid_from` range filters | "last March", "when I was at Libra" |

Temporal and entity filters are applied as **hard SQL predicates**, not similarity hopes. This is the single biggest accuracy win over naive RAG.

### 4.3 Rerank & assemble
- Candidates (~50–100) → rerank (LLM rerank or cross-encoder like bge-reranker) → top 10–15.
- Prefer currently-valid facts unless the query is historical.
- Assemble context: relevant facts + their **source memory snippets** + entity profiles + timestamps.
- Answer generation cites sources: "You met Urhan on July 3rd *(memory: 'Met Urhan today at the library…')*". Tap-through to the raw memory. Trust comes from provenance.

### 4.4 Failure honesty
If retrieval confidence is low, say "I don't have a memory about that" — never hallucinate a memory. A memory app that invents memories is dead on arrival. Enforce via a groundedness check: every claim in the answer must map to a retrieved source.

---

## 5. Consolidation ("sleep") — nightly BullMQ job

What actual brains do during sleep; what makes this feel alive over months:

1. **Entity profile rebuild** — regenerate `entities.profile` from all facts about entities touched that day. Keeps "tell me about Urhan" fast and complete.
2. **Fact dedup/merge** — cluster near-duplicate facts, merge, boost confidence on repeated observations.
3. **Pattern mining** — detect recurring correlations across episodic memories ("low energy mentioned in 9 of 12 late-night-work entries"). Store as derived insights (facts with `source = consolidation`, provenance = the contributing memories). Surfaced during decision reasoning — this is your differentiator's fuel.
4. **Salience scoring** — recency × frequency × emotional weight × user pins. Never delete; salience is a retrieval prior (tie-breaker in reranking), not forgetting.

---

## 6. Ask / Reason (decision mode)

Simple questions: single-pass retrieval → grounded answer.

Decisions ("should I take this offer?") trigger an agent loop:
1. **Decompose** — what does this decision depend on? (values, constraints, past similar situations, relevant people/facts)
2. **Multi-hop retrieval** — one retrieval round per dimension: preference/value memories, similar past decisions *and their outcomes*, current constraints, pattern insights from consolidation.
3. **Reason** — weigh retrieved evidence, cite every memory used, present tradeoffs. Not "do X" — "here's what your own history says about X."
4. **Outcome loop** — after a decision, later prompt: "how did it go?" Logged outcomes become memories that inform future decisions. This compounds; nothing on the market does it.

---

## 7. Reminder Engine

- Ingestion stage 3.2 flags `intent/plan` memories with a future time → app suggests: "Remind you Friday to call the bank?" One tap to confirm.
- Manual reminders are just intent memories with explicit time.
- Reminders live in the memory graph — "did I call the bank?" is answerable because the reminder and its completion are memories too.

---

## 8. App Surface (deliberately minimal)

- **Add** (default screen): text box, save, done. Voice input later.
- **Ask**: chat-style Q&A, no persisted history UI (each session fresh — the memory store *is* the history).
- That's it. Reminders appear as notifications + inline suggestions. Optional later: entity pages (auto-generated "Urhan" page) — read-only views over the graph, not new features.

---

## 9. Why Accuracy Doesn't Degrade at Scale

Direct answers to the memory-A-vs-memory-B problem:

1. **Atomic facts > chunks** — discriminative units anchored to entities and dates, not fuzzy prose blobs.
2. **Hard filters** — time and entity constraints are SQL predicates; wrong-time/wrong-person candidates never enter ranking.
3. **Supersession** — stale facts are marked invalid, so "current truth" queries can't retrieve outdated answers.
4. **Reranking** — final precision pass over a high-recall candidate pool.
5. **Provenance + user correction** — wrong answers are traceable to a memory; user fixes propagate (edit fact, rebuild profile).
6. **Consolidation** — dedup and profiles prevent the "40 fragments about Urhan" problem entirely.

---

## 10. Build Order (for v0, for yourself)

1. **Week 1–2:** memories table, capture screen, ingestion pipeline stages 3.1–3.4 (single LLM call can do classify + entities + facts + temporal in one structured output), embeddings.
2. **Week 3:** retrieval — query understanding + hybrid search + LLM rerank + grounded answers with citations. Ship Ask screen. **Start using it daily immediately.**
3. **Week 4:** contradiction handling + nightly consolidation (profiles + dedup).
4. **Week 5+:** decision mode agent loop, reminders, pattern mining.

Model choice: one strong cheap model (Gemini Flash / Haiku-class) for ingestion at scale; a stronger model only for the Ask/Reason path. Ingestion cost per memory must be near-zero or you'll hesitate to build features on it.

**Eval from day one:** keep a growing set of (question → expected memory) pairs from your own usage. Every retrieval change runs against it. You already know this discipline from QueryWise — apply it here; retrieval accuracy is the entire product.