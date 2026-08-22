# Backend API gaps — new endpoints needed by the web app

Backend stays Bun.serve; every new endpoint is a **thin wrapper over `@repo/db`** (locked decision). All routes use Clerk bearer auth like existing `apps/server/src/routes/*.ts`. Response shapes must match `apps/mobile/src/api/types.ts` conventions.

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /graph/snapshot` | Full entity/edge graph for the Knowledge Graph view | `getGraphSnapshot()` ALREADY EXISTS in `@repo/db` — just expose it |
| `GET /stats/overview` | Headline counters for dashboard stat cards | memories, entities, open loops, pending reminders counts |
| `GET /stats/timeseries?days&bucket` | Timeseries for charts + capture heatmap/trends | bucket = day/week; reuse across Overview and Insights tracks |
| `GET /facts` | Facts table data | support current-vs-history mode param; include confidence/origin/conflict flags |
| `PATCH /facts/:id` | Resolve/update fact state | conflicts resolution writes here; keep bitemporal invariants (never delete history) |
| `GET /open-loops` | List loops for board/board-rows views | filterable by status/kind/due |
| `POST /open-loops` | Create loop (manual goal planting) | kind defaults per payload; validate against open-loop kinds enum |
| `PATCH /open-loops/:id` | Update status/edit fields | used by drag-and-drop status changes + convert-to-reminder bookkeeping |
| `GET /memories/search?q=` | Semantic + lexical search for timeline/global search | reuse retrieval subsystem from `packages/core/retrieval` |
| `PATCH /memories/:id` | Pin/unpin a memory | ONLY pinned flag — memory content stays immutable |
| `GET /digests` | Weekly digests list/detail | powers digest card on Overview |
| `POST /entities/merge` | Merge duplicate entities | remap mentions/edges; keep supersession-style audit trail |
| `GET /surfacings/summary` | Surfacing engagement summary incl. `suppressed_reason` breakdown | feeds Insights track charts |
| `POST /rules/:id/test` | Trigger playground: dry-run a rule | returns would-be matches without side effects |

Rules for implementers:

1. Check the route doesn't already exist in `apps/server/src/routes/` before adding.
2. One endpoint per small task/issue; wire types updated in the same PR.
3. Keep handlers thin — query logic belongs in `@repo/db`, orchestration in `packages/core`.
