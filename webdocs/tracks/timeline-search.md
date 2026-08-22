# Track: Timeline browser & search (`T-*`)

Primary memory browsing surface. Read `packages/db/schema/memories.ts` first — memories are immutable.

## Checklist

- [ ] **T-1** Grouped infinite scroll timeline — AC: memories grouped by day; cursor pagination via `GET /memories`; loads next page on scroll; no dup keys.
- [ ] **T-2** Semantic + lexical search — AC: search box hits `GET /memories/search?q=`; results ranked; empty-query falls back to plain timeline.
- [ ] **T-3** Filters bar — AC: filter by source, status, date range, entity, pinned; composable with search; state reflected in URL params.
- [ ] **T-4** Pin/unpin — AC: pin toggle calls `PATCH /memories/:id`; pinned badge visible; pinned sort option works.
- [ ] **T-5** Failed-retry — AC: failed ingestions show error state; retry action re-enqueues; status updates on success.
- [ ] **T-6** Memory-detail view — AC: shows the memory plus everything derived: entities, facts, edges, surfacings, related digests; read-only (memories immutable).
- [ ] **T-7** Quick-capture composer — AC: **TEXT INPUT ONLY** (no file upload — locked decision); submits to ingestion endpoint; appears at top of timeline optimistically.

## Learnings

(gotcha → fix → date)
