# Track: Facts Explorer (`F-*`)

Facts are bitemporal SPO rows: `valid_from` / `valid_to`, `superseded_by`, `conflicts_with`. History is never deleted. Schema: `packages/db/schema/facts.ts`. Endpoints: `GET /facts`, `PATCH /facts/:id` from `../backend-api-gaps.md`.

## Checklist

- [ ] **F-1** Facts table — AC: subject-predicate-object table with pagination; current view excludes superseded rows.
- [ ] **F-2** Current-vs-history toggle — AC: toggle switches between current snapshot and full bitemporal history; history shows valid ranges per row.
- [ ] **F-3** Supersession chain viz — AC: timeline visualization of a chain (original → replacements) via `superseded_by`; click-through between chain members.
- [ ] **F-4** Conflicts Inbox — AC: dedicated view of conflicted facts (`conflicts_with` non-null); grouped by pair; counters in nav.
- [ ] **F-5** Resolve actions — AC: resolve flow lets user pick winning side or keep both; writes via `PATCH /facts/:id`; resolved conflicts leave inbox.
- [ ] **F-6** Confidence & origin badges — AC: each row badges confidence and origin; sortable/filterable by both.
- [ ] **F-7** Provenance click-through — AC: every fact links to its source memory/receipt; opens memory detail.

## Learnings

(gotcha → fix → date)
