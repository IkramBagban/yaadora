# Spec 03 — API Contract, Mobile Surface & Roadmap

> Prereq: `CONTEXT.md` + specs 01–02. This defines the HTTP contract between `apps/mobile` and
> `apps/server`, the minimal mobile app surface, and the build order.

---

## 1. API contract (`apps/server`, `Bun.serve`)

Conventions: JSON over HTTPS; `Authorization: Bearer <token>`; all bodies validated with **zod**;
all data scoped to the authenticated `user_id`; errors as `{ error: { code, message } }`. Use a
light router on `Bun.serve`'s `routes` (no express).

### 1.1 Capture (the sacred fast path)

```
POST /memories
  body: { rawText: string, source?: "manual"|"voice", clientId?: string, occurredHint?: string }
  → 201 { id, status: "pending", createdAt }
```
Server does exactly: `INSERT` raw row → enqueue BullMQ `ingestion` job → return. **No LLM on this
path.** `clientId` is the mobile-generated idempotency key for offline sync (dedupe on retry).

```
GET  /memories?cursor=&limit=      → paginated raw memories (newest first) for the timeline
GET  /memories/:id                 → one memory + its derived facts + entities (for tap-through)
```
> No `PATCH`/`PUT` on `raw_text` — memories are immutable. Corrections happen at the fact layer
> (`PATCH /facts/:id` if/when a correction UI exists), never by editing raw text.

### 1.2 Ask / Reason

```
POST /ask
  body: { question: string }
  → SSE/stream: text tokens + a final { citations: [{ memoryId, snippet, occurredAt }],
                                        confidence, mode: "recall"|"reason",
                                        reminderSuggestion?: {...} }
```
Runs spec 02 §3 (recall) or §4 (decision mode, auto-detected by query understanding). Streams the
answer; ends with citations. **No persisted chat history in v0** — each call is fresh; the memory
store is the history. If confidence is low, the stream is the honest "I don't have a memory about
that."

### 1.3 Reminders

```
GET    /reminders?status=pending
POST   /reminders           { text, dueAt, origin?: "manual" }
POST   /reminders/confirm   { sourceMemory, text, dueAt }   // one-tap accept of an AI suggestion
PATCH  /reminders/:id       { status: "done"|"dismissed" }
```

### 1.4 Auth

- **Clerk** owns identity (sign-up / sign-in / session JWTs). Mobile sends
  `Authorization: Bearer <Clerk session JWT>`.
- Server verifies with `@clerk/backend`, maps `clerk_user_id` → local `users.id`
  (upsert on first request). All data remains `user_id`-scoped.
- Profile: `GET /me`, `PATCH /me { timezone }` (device IANA timezone for temporal resolution).
- Optional **bootstrap bearer** (`AUTH_ALLOW_BOOTSTRAP=true` + `AUTH_BOOTSTRAP_TOKEN`)
  exists only for local seed/eval — never enable on a public deploy.
- Register Expo push token (later): `POST /devices { expoPushToken }`.

### 1.5 Health / ops

```
GET /health   → { ok, db, redis }
```

---

## 2. Mobile app surface (`apps/mobile`, Expo)

Deliberately minimal. **Replace the starter tabs template** (`app/(tabs)/index.tsx`,
`explore.tsx`, the demo components) with the two real screens. Keep `expo-router`.

### 2.1 Screens

1. **Add** (default/home): a  text box, a Save button, done. Optimistic — save locally first,
   sync to `POST /memories` in the background (offline-first queue). Voice input can come later
   (write `source: "voice"`). This screen must feel instant; never spinner-block on the network.
2. **Ask**: a chat-style input + streamed answer view with tappable **citation chips** that open the
   source memory. **No history list** — each session starts fresh. Decision-mode answers render
   tradeoffs + cited memories.

Navigation: a 2-tab bar (Add | Ask) — or Add as home with Ask one tap away. Reminders surface as
**notifications + inline suggestion cards** on the Add screen, not a dedicated tab.

Optional later (read-only, not new features): auto-generated **entity pages** ("Urhan") as views
over the graph; a **timeline** of raw memories.

### 2.2 Offline-first capture

- Local queue (e.g. SQLite / MMKV / AsyncStorage) holds unsynced memories with a `clientId`.
- On connectivity, flush to `POST /memories`; server dedupes on `clientId`. Capture succeeds even
  fully offline — this is core to the daily-habit loop the whole product depends on.

### 2.3 Client API layer

- One typed API client module; share request/response zod types with the server (put shared types in
  `@repo/core` or a small `@repo/contracts` package so mobile and server can't drift).
- Handle SSE/streaming for `/ask`.
- Expo push notifications for reminders.

---

## 3. Environment & infra summary

| Var | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | server, worker, db | Postgres + pgvector |
| `REDIS_URL` | server, worker | BullMQ |
| `AI_PROVIDER` | server, worker | `anthropic` \| `google` |
| `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | server, worker | model access |
| `OPENAI_API_KEY` | server, worker | embeddings (1536-d) |

Local dev: `docker-compose.yml` at repo root with `pgvector/pgvector:pg16` + `redis`. Bun auto-loads
`.env` (no `dotenv`). `turbo dev` runs server + worker + mobile.

---

## 4. Build order (v0, for the owner first)

Ship the smallest thing you'll *actually use daily*, then let real usage drive the rest.

**Week 1–2 — Capture + Ingestion**
- `@repo/db`: Drizzle schema + first migration (extension, tables, tsvector, HNSW indexes).
- `@repo/core/ai`: provider layer (Claude + Gemini, embeddings).
- `apps/server`: auth + `POST /memories` (fast path) + timeline reads.
- `apps/worker`: `ingestion` queue = single-call extraction (02 §2.1–2.4) + linking + embeddings.
- `apps/mobile`: Add screen, offline-first capture.
- ✅ You can capture daily. **Start depositing memories immediately.**

**Week 3 — Recall (start living in it)**
- `@repo/core/retrieval`: query understanding + hybrid search + rerank + grounded, cited answers.
- `apps/server`: `POST /ask` (streamed). `apps/mobile`: Ask screen with citation chips.
- Seed `eval_cases` from your own questions; wire `bun run eval`.
- ✅ **Use it every day.** Your retrieval failures now drive the backlog.

**Week 4 — Trust & upkeep**
- Contradiction/supersession handling (02 §2.5).
- Nightly consolidation: entity-profile rebuild + fact dedup (02 §5.1–5.2).

**Week 5+ — The differentiators**
- Decision mode agent loop + outcome loop (02 §4).
- Reminders (suggestions + Expo push).
- Pattern mining + salience (02 §5.3–5.4).
- Optional: entity pages, timeline, voice capture.

**Discipline throughout:** capture never blocks on an LLM; every fact has provenance; every answer is
grounded or honestly declines; every retrieval change runs the eval set.

---

## 5. Task-splitting guide (for delegating to other agents)

To route work between the strong tier (hard) and cheap tier (routine):

**Hard (keep on the strong tier):** the ingestion extraction prompt + zod schema; entity linking/
disambiguation logic; hybrid retrieval SQL and reranking; the groundedness guard; decision-mode
loop; consolidation logic; the eval harness. These *are* the product — accuracy-critical.

**Routine (safe for the cheap tier):** Drizzle table boilerplate from spec 01; the `Bun.serve`
router + zod request validation; reminders CRUD; the mobile Add/Ask screens and API client; offline
queue plumbing; `docker-compose.yml`; Expo push wiring. Give each agent `CONTEXT.md` + the relevant
spec section as its brief.
