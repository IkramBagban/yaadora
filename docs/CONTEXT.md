# Yaadora — Complete Project Context

> **Read this first.** This file is the shared context and single source of truth for every agent (human or AI) working on Yaadora. It defines exactly what Yaadora is, its architecture, screens, and features.

---

## 1. What Yaadora is

Yaadora is a **personal AI memory system** — a "second brain" that remembers everything you feed it and reasons over it like a human brain does. The user deliberately deposits anything worth remembering (events, people, learnings, thoughts, end-of-day journals), and the app provides three core capabilities that mirror human memory:

1. **Capture** — Friction-free memory input. One tap, write, done. Sub-second, works offline via a local outbox.
2. **Recall** — Ask anything, get answers grounded *only* in your own memories, with direct citations.
3. **Reason** — Use the user's own history to help make decisions by weighing relevant past experiences, values, and patterns through multi-turn, tool-driven reasoning.

Plus **lightweight reminders** — fully manual, or AI-suggested automatically when a raw memory implies a future action.

### The Core Principle (Never Violate)
**Raw memories are immutable ground truth. All structure is derived and rebuildable.**
Every entry is stored verbatim, forever (the *episodic* layer / "hippocampus"). Extraction, entity linking, facts, and consolidation build *indexes over* the raw log (the *semantic* layer / "cortex"). If extraction is wrong, ground truth is intact and the index can be rebuilt. Every derived fact carries **provenance** back to its source memory. Answers cite sources. The app must **never invent a memory** — if retrieval confidence is low, it says "I don't have a memory about that."

---

## 2. Screens and Flow

The mobile client (built with Expo / React Native) relies on a tab-based navigation layout with floating elements.

1. **Add (Capture Screen)**: The default home screen (`app/(tabs)/index.tsx`). Designed for low-friction capture with a large, distraction-free input. Typing a memory and hitting "Save" instantly writes to the local SQLite/MMKV queue and triggers a Reanimated "commit" spring animation that simulates the text settling downward into custody. Network upload happens in the background.
2. **Ask (QA & Analysis Screen)**: Natural-language lookup and recall (`app/(tabs)/ask.tsx`). An ephemeral conversation with your memory. Includes multi-turn follow-ups, a live thinking trace, and AI-asks-back clarification. It shows the streaming answer with inline citations that link back to the raw memories.
3. **Timeline**: A chronologically paginated feed (`app/timeline.tsx`) of raw memories, allowing the user to search and scroll back through their historical record.
4. **Reminders**: A dedicated hub (`app/(tabs)/reminders.tsx`) to view and manage upcoming actionable items, automatically grouped by due date ("Today", "Tomorrow", "This week"). It handles AI-suggested reminders and manual creation/editing.
5. **Memory Details**: A tap-through view (`app/memory/[id].tsx`) for inspecting a specific memory, showing the raw episodic text, the resolved time, extraction status, and derived facts/entities.

---

## 3. Architecture of Ingestion (The Worker)

Ingestion is asynchronous to guarantee sub-second capture on the client. `apps/worker` consumes BullMQ jobs.
The pipeline (`packages/core/ingestion/pipeline.ts`) processes each new memory:
1. **Load**: The raw memory and user timezone are loaded.
2. **Extraction**: A single structured LLM call (e.g., Gemini Flash) extracts temporal resolution (resolving "tomorrow"), classifies the intent, links entities, and breaks prose down into atomic facts (Subject ➔ Predicate ➔ Object).
3. **Suggested Reminders**: If the intent parsing detects a future action ("call the bank Friday") or a prospective event, it automatically creates a reminder in a "suggested" status for the user to confirm later.
4. **Fact Supersession**: Checks if a new fact conflicts with an existing one. If it updates older information, `valid_to` is set on the old fact and linked to the new fact. Facts are mutable; raw memories are not.
5. **Multi-representation Embeddings**: Embeddings are generated at three levels (raw memory, atomic facts, entity profiles) using Vercel AI SDK `embedMany`.

---

## 4. Architecture of Retrieval & The Ask Agent

When a user asks a question, the reasoning tier (e.g., Gemini Pro) in `apps/server` (via `packages/core/retrieval/agent.ts`) acts as an intelligent conversational agent:
1. **Bounded Tool-Use Loop**: Instead of a blind single-pass retrieval, the reasoning model drives a loop (up to a max step count). It rewrites follow-ups into standalone queries based on session history.
2. **Hybrid Search**: It executes tools like `search_memories`, which performs parallel hybrid searches via Postgres:
   - *Vector Cosine Similarity* on facts and memories.
   - *Lexical Full-Text Search* using GIN indexes.
   - *Graph Edge Joins* and *Hard SQL Filters* (e.g., date ranges).
3. **Live Trace**: As the agent searches, clarifies, or synthesizes, it streams a live trace (the `AskStep`) so the UI can show the user what it's thinking and eliminate dead pre-answer gaps.
4. **Grounded Answer**: The final text is streamed with inline citations. The prompt mandates the model to rely *only* on retrieved context and answer naturally.
5. **Clarification**: If a question is genuinely ambiguous, the agent uses a `clarify` tool to ask the user back instead of guessing.

---

## 5. Memory & Reminders in Detail

- **Episodic vs Semantic Memory**: The `memories` table holds immutable raw text (episodic). The `facts` table holds mutable atomic statements derived from memories (semantic). This split ensures safety and speed.
- **Reminders Lifecycle**: When an actionable intent is found in a memory, a reminder is "suggested" (`status = 'suggested'`). The user sees this as a chip in the mobile app and can accept or dismiss it. Users can also manually create reminders through the Reminders tab. Background jobs handle sending notifications (if enabled).

---

## 6. Folder Structure & Tech Stack

```text
yaadora/
├─ apps/
│  ├─ server/   Bun.serve HTTP API — auth, capture, ask/reason streaming, routes. Thin & fast.
│  ├─ worker/   BullMQ workers — async ingestion pipeline, nightly consolidation.
│  └─ mobile/   Expo app — Add (Capture), Ask (QA), Reminders, Timeline.
├─ packages/
│  ├─ core/     Intelligence center — Vercel AI SDK, retrieval/agent logic, ingestion pipeline, queues.
│  ├─ db/       Drizzle ORM schema, migrations, pgvector, queries, hybrid search logic.
│  ├─ ui/       Shared React components (web-oriented, though mobile has its own components).
│  ├─ eslint-config/
│  └─ typescript-config/
└─ docs/
   ├─ CONTEXT.md                         ← You are reading this.
   └─ architecture/                      ← Deeper technical specs.
```

### Tech Stack Choices
- **Monorepo**: Turborepo + Bun workspaces.
- **Language**: Strict TypeScript.
- **API/Workers**: Bun runtime natively (`Bun.serve()`, `Bun.sql`).
- **Queue**: Redis via BullMQ.
- **Database**: PostgreSQL + `pgvector`. Drizzle ORM.
- **AI Calls**: Vercel AI SDK. Swappable providers (Claude / Gemini).
  - *Ingestion tier*: Cheaper, fast models (Gemini Flash).
  - *Reasoning tier*: Advanced models (Gemini Pro) for Ask.
- **Mobile**: Expo (React Native), React Compiler enabled.
