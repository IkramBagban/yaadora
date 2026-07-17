# Yaadora — Project Walkthrough & Architecture Reference

Yaadora is a personal AI memory system ("second brain") designed as a Bun + Turborepo monorepo. It records raw episodic memory entries verbatim (immutable ground truth) and derives semantic indexes (facts, entities, graph edges) asynchronously to support sub-second ingestion and hybrid retrieval queries.

This document walks through what is currently implemented, how it works, and the frontend flow.

---

## 1. System Architecture & Component Mapping

```
                                 HTTPS (JSON)
       ┌────────────────┐ ────────────────────────▶ ┌────────────────────────┐
       │  apps/mobile   │                           │      apps/server       │
       │ (Expo / React  │ ◀──────────────────────── │      (Bun.serve)       │
       │    Native)     │       SSE (Streaming)     │ auth · capture · ask   │
       └──────┬─────────┘                           └───────────┬────────────┘
              │                                                 │
              │ local queue (SQLite / MMKV)                     │ read/write
              ▼                                                 ▼
       ┌──────────────┐         enqueue job (BullMQ)    ┌────────────────────┐
       │    Redis     │ ◀───────────────────────────────│    Postgres DB     │
       │   (BullMQ)   │                                 │    + pgvector      │
       └──────┬───────┘                                 └─────────▲──────────┘
              │                                                   │
              │ consume jobs                                      │ read/write
              ▼                                                   │
       ┌──────────────────────────────────────────────────────────┴──────────┐
       │                            apps/worker                              │
       │  ingestion pipeline (per memory)                                     │
       │  nightly consolidation cron                                         │
       └─────────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure:
1. **`apps/server` (Bun)**: Fast HTTP API. Handles authentication, raw memory capture, and streaming search/QA (`/ask`). Writes to DB and enqueues background jobs. (Reminders CRUD is planned for a later wave).
2. **`apps/worker` (Bun)**: Background processing via BullMQ. Runs the async ingestion pipeline on new memories and schedules nightly consolidation (profiling, merging, and cleanup).
3. **`packages/db`**: Database layer. Configured with Drizzle ORM, `pgvector`, and Postgres full-text search. Exposes schema definitions and raw SQL query builders for hybrid retrieval.
4. **`packages/core`**: The intelligence center. Houses Vercel AI SDK wrappers, prompt schemas, retrieval/ranking orchestration, and seed utilities.

---

## 2. Technical Implementation Details

### 2.1 The Data Model (`packages/db/schema/*`)
All tables are partitioned and queried using `user_id` scopes:
- **`users`**: Timezone and email config (timezone is critical for resolving relative dates like "yesterday").
- **`memories`** (Episodic log): Verbatim raw entries written by the user. These are **immutable**; they are never updated or deleted.
- **`entities`**: Consolidated nodes (people, places, topics, projects) representing the user's network. Mentions are tracked and nightly consolidated.
- **`memory_entities`**: Joins `memories` and `entities` (an entity-mention graph).
- **`facts`** (Semantic log): Atomic, natural-language statements derived from memories (e.g., `"Subject lives in Pune"`). Fully mutable using **supersession** (`valid_from`, `valid_to`, `superseded_by`) instead of hard deletion.
- **`reminders`**: Actionable reminder slots (table structure exists; full API and notification services are planned for a later wave).
- **`eval_cases`**: RAG regression evaluation tests.

### 2.2 Ingestion Pipeline (`apps/worker`)
Ingestion runs asynchronously using BullMQ to guarantee sub-second capture on the client. It executes in a single structured extraction call using the cheap LLM tier (Gemini Flash / Groq) to extract:
1. **Temporal Resolution**: Resolves relative time words ("tomorrow", "last weekend") against the user's local timezone.
2. **Classification**: Labels the entry (episodic, preference, intent, etc.).
3. **Entity Extraction & Linking**: Identifies mentions, checks existing entity embeddings to match or disambiguate, and upserts entity nodes.
4. **Fact Deconstruction**: Breaks prose down into atomic facts (Subject ➔ Predicate ➔ Object).
5. **Deduplication & Supersession**: Checks if a new fact conflicts with an existing one. If it updates older information, `valid_to` is populated with `occurred_at` on the old fact and linked to the new fact.
6. **Multi-representation Embeddings**: Generates embeddings at three levels (raw memory, individual atomic facts, and entity profiles) for vector search.

### 2.3 Retrieval & Reasoning (`packages/core/retrieval`)
When the user asks a question, retrieval runs synchronously:
1. **Query Understanding**: Classifies the query and extracts filters (entity links, temporal constraints).
2. **Hybrid Search Channels**: Queries are issued in parallel in a single Postgres transaction:
   - *Vector Cosine Similarity*: Finds matches on `facts.embedding` and `memories.embedding`.
   - *Lexical Full-Text Search*: Uses GIN indexes over `tsvector` on `memories.fts`.
   - *Graph Edge Joins*: Traverses entity hops from matched nodes.
   - *Hard Filters*: Enforces exact entity and date-range conditions directly in SQL (critical accuracy win).
3. **Reranking**: Scores candidates using the LLM.
4. **Grounded Answer Generation**: Streams the answer with inline citations. If confidence is low, refuses to answer rather than hallucinating.

---

## 3. Frontend Architecture & Screen Flow (`apps/mobile`)

The mobile client is built with Expo (React Native) using a 2-tab navigation layout with floating action elements.

### 3.1 Screen Layouts

```
   ┌────────────────────────────────┐         ┌────────────────────────────────┐
   │ 09:41 AM                Status │         │ 09:41 AM                       │
   │                                │         │  What was on my mind last... ? │
   │  Something worth keeping..._   │         │                                │
   │                                │         │  You wrote about planning      │
   │                                │         │  the new project UI with       │
   │                                │         │  the design team last          │
   │                                │         │  Tuesday [1].                  │
   │                                │         │                                │
   │ ┌────────────────────────────┐ │         │  [Reasoned]                    │
   │ │ Recent                     │ │         │                                │
   │ │ • Met Urhan...    (Saved)  │ │         │  Sources                       │
   │ │ • Sleep at 11pm.. (Pending)│ │         │  ┌──────────────┐              │
   │ └────────────────────────────┘ │         │  │ [1] UI Plan  │              │
   │                      [ Save ]  │         │  └──────────────┘              │
   │                                │         │                   [Ask Again]  │
   │ ┌────────────────────────────┐ │         │ ┌────────────────────────────┐ │
   │ │   [Add]           [Ask]    │ │         │ │ Ask anything...        [^] │ │
   │ └────────────────────────────┘ │         │ └────────────────────────────┘ │
   └────────────────────────────────┘         └────────────────────────────────┘
               ADD TAB                                     ASK TAB
```

#### 1. Add (Default Home Screen) — `app/(tabs)/index.tsx`
- **Purpose**: Low-friction capture.
- **Header**: Displays today's date, network status pill, and a clock icon linking to the `timeline` history screen.
- **Composer**: A large, distraction-free serif `TextInput` showing random prompt placeholders (e.g. *"What happened today?"*, *"Something worth keeping..."*).
- **Recent List**: Rendered below the input when the keyboard is closed. Lists recent entries, displaying their sync status (pending, processing, processed) using status pills. Clicking a row navigates to `app/memory/[id].tsx`.
- **Action**: A floating "Save" button. Clicking triggers a medium haptic impact and clears the screen using a Reanimated "commit" spring animation that simulates the text settling downward into safe custody.
- **Offline Queue**: Saves the entry immediately to the local outbox (SQLite/MMKV) with a `clientId` and triggers a background sync when online.

#### 2. Ask (QA & Analysis Screen) — `app/(tabs)/ask.tsx`
- **Purpose**: Natural-language lookup and recall.
- **Idle State**: Displays a clean display header *"Ask your memory."* and a vertical stack of suggestion chips (e.g. *"What was on my mind last week?"*).
- **Active State**: Shows the asked question italicized followed by a streaming text box containing a pulsing cursor (`<Caret />`).
- **Citation Chips**: Once streaming completes, source citations appear as horizontal card buttons. Clicking a citation navigates directly to the raw memory details screen.
- **Reasoning Badge**: Highlights decision-tier outcomes with a soft colored badge (UI visual design is implemented; deep multi-hop reasoning loops are planned for a later wave).
- **Action Pill**: A rounded input box at the bottom. During streaming, it shows a "stop" button. When idle, it shows a "send" feather arrow.

#### 3. Memory Detail Screen — `app/memory/[id].tsx`
- **Purpose**: Tap-through view for inspecting a specific memory.
- **Content**: Shows the raw episodic text in full, the resolved `occurredAt` time, extraction status, and a list of derived facts & entities generated during the ingestion phase.

#### 4. Timeline Screen — `app/timeline.tsx`
- **Purpose**: Paginated chronological feed of raw memories. Allows searching and scrolling back through the historical record.

---

## 4. Frontend Flow & Interaction Sequence

```
[ User types memory ] ➔ [ Press Save (Instant) ] ➔ [ Write to local queue ]
                                                            │
                                                     (Network Online)
                                                            │
                                                            ▼
                                                   [ POST /memories ]
                                                            │
                                                   [ Enqueue BullMQ ]
                                                            │
                                                      (Background)
                                                            │
                                                            ▼
                                                   [ Ingestion Job ]
                                                            │
                                            ┌───────────────┴───────────────┐
                                            ▼                               ▼
                                    [ Temporal/Facts ]             [ Vector Embed ]
                                            │                               │
                                            └───────────────┬───────────────┘
                                                            ▼
                                                   [ Ready for Ask ]
```

1. **Deposit**: User opens the app (focuses instantly on **Add** text box). Writes a thought, hits **Save**. The text animates down, haptics trigger, and a "Saved" toast displays.
2. **Background Upload**: The client writes to the local database, generates a `clientId` (UUID), and sends it to the server. If online, the client retries exponentially.
3. **Processing**: The server inserts the memory as `pending` and pushes it to BullMQ. The worker extracts structures, builds the semantic links, generates embeddings, and marks it `processed`. The UI status pill shifts to checkmark.
4. **Recall**: User shifts to the **Ask** tab. Types a question. The server parses the intent, queries vectors + lexical matches in parallel, reranks them, and streams the answer using Server-Sent Events (SSE). Inline citations link back to the memories deposited in step 1.
