# yaadora-web — Agent Data Hub (master file)

Every agent working on the web app starts here, then reads `webdocs/tracking.md` and its track file in `webdocs/tracks/`.

## What yaadora-web is

yaadora-web is the web companion/dashboard for the **yaadora personal-memory system**: an Expo mobile app plus a Bun.serve API server, a BullMQ worker, and a Postgres/pgvector engine that ingests, retrieves, consolidates, and proactively surfaces memories. The web app is a desktop-first Vite React SPA that gives users richer views over the same data — dashboards, timeline search, knowledge graph, facts/open-loops management, ask-on-web chat — talking to the same Bun.serve backend via thin endpoints over `@repo/db`.

## REQUIRED READING for every agent

Before writing any code:

1. `packages/db/schema/*.ts` — data model. Key invariants:
   - `memories` are **immutable** (never UPDATE content).
   - `facts` are **bitemporal SPO** rows (`valid_from` / `valid_to`, `superseded_by`, `conflicts_with`) — history is never deleted.
   - `entities`, `entity_edges` (with `strength` / `evidence`).
   - `open_loops` kinds: `commitment | unresolved_conflict | upcoming_event | goal | thread`.
   - `reminders`; `rules` with `apply_count`; `surfacings` ledger with `suppressed_reason`; `digests`.
2. `packages/core/` — subsystems: `ingestion/`, `retrieval/`, `proactive/`, `consolidation/`.
3. `apps/server/src/routes/*.ts` — existing API surface (Clerk bearer auth on every route).
4. `apps/mobile/src/api/types.ts` — wire types; the response-shape source of truth for any endpoint you touch.
5. `apps/mobile/src/theme/*` (`tokens.ts`, `motion.ts`, `useTheme.ts`) — design tokens to port into the web theme.

## Feature catalog

Each block maps to one checklist file in `webdocs/tracks/`.

### Overview dashboard → `tracks/overview.md`
Stat cards (memories, entities, open loops…), capture heatmap, timeseries charts, weekly digest card, due loops list, suggested-reminders queue.

### Timeline browser → `tracks/timeline-search.md`
Grouped infinite scroll, semantic + lexical search, filters (source/status/date/entity/pinned), pin/unpin, failed-retry, memory-detail showing everything derived, quick-capture composer (**TEXT INPUT ONLY**).

### Knowledge Graph → `tracks/graph.md`
`@xyflow/react` global entity graph: node size = `mention_count`, color = entity type; edge width = `strength`, dashed = unresolved/ended; click → side panel; walk from node; filters.

### Entities directory & profiles → `tracks/entities.md`
Directory listing + rich profiles: validity bars, collapsed supersession history, conflicts highlighted, mention-trend sparkline, receipts, merge UI.

### Facts Explorer → `tracks/facts-explorer.md`
Current-vs-history toggle, supersession-chain timeline viz, Conflicts Inbox with resolve actions, confidence/origin badges, provenance click-through.

### Open Loops board → `tracks/open-loops.md`
Kanban by status or rows by kind, overdue chips, convert-to-reminder action, manual goal planting.

### Rules manager → `tracks/rules.md`
Active/paused toggle, `apply_count` bars, edit-as-correction flow, trigger playground.

### Ask on web → `tracks/ask-web.md`
Conversation sidebar, SSE thread using the same frames as mobile, citations drawer, tool trace, nudge engage/dismiss, voice input via MediaRecorder → `/transcribe`.

### Reminders → `tracks/reminders.md`
Table + month calendar views, suggested queue confirm/dismiss, recurrence editing.

### Insights & Analytics → `tracks/insights-analytics.md`
Engagement rates by nudge kind, `suppressed_reason` breakdown, capture habits (hour-of-day, source mix, streaks), fading-relationship alerts, pattern-insights feed (origin = consolidation), AI token usage.

### Settings & Privacy → `tracks/settings-export.md`
Privacy form, data export (json | md), device tokens, danger-zone derived-data rebuild, theme toggle matching mobile light+dark.

### Cross-cutting → `tracks/platform.md`
cmd-K palette, unified global search, empty states, responsive desktop-first layout, shared fetch/client/theme infra.

## LOCKED DECISIONS (append-only, dated)

Do not relitigate these. New decisions get appended at the bottom with a date; existing lines are never edited.

- 2026-08-22 · Design: port MOBILE theme tokens (`apps/mobile/src/theme/*`). NOT dark-first — both light and dark themes supported.
- 2026-08-22 · No phases/milestones — tracks are organized by feature area only.
- 2026-08-22 · Import: text-input composer only (no file upload).
- 2026-08-22 · Branch strategy: `web` is the integration branch. ALL PRs target `web`. Merge `main`→`web` regularly; `web`→`staging`→`main` when stable.
- 2026-08-22 · Execution: work via GitHub issues. ONE agent per issue. SMALL tasks per agent — never a whole feature per agent.
- 2026-08-22 · Deploy: Vercel free static hosting, Root Directory `apps/web`, `vercel.json` SPA rewrite.
- 2026-08-22 · Stack: Vite React TS SPA, TanStack Router + Query, Tailwind with mobile tokens, `@xyflow/react` graph, Recharts charts.
- 2026-08-22 · Backend stays Bun.serve; new endpoints are thin wrappers over `@repo/db`.
- 2026-08-22 · Execution refinement (supersedes the SMALL-tasks wording above): issues are mid-sized and FEATURE-scoped — roughly one page/experience per frontend issue and five batched endpoint issues on the backend. Conflict safety comes from each issue owning disjoint file paths, not from micro-slicing.

## CODING STANDARDS (mandatory)

- Modular files ≤ 200–300 lines each.
- DRY; extract reusable components/utils instead of copying.
- Fully typed — no `any`, ever.
- Conventional commits: `feat(web): …`, `fix(server): …`, etc.
- Never leave typecheck or lint broken.
