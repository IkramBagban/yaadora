# Track: Entities directory & rich profiles (`E-*`)

Schema refs: `packages/db/schema/entities.ts`, `entity-edges.ts`, `memory-entities.ts`. Endpoints: existing `apps/server/src/routes/entities.ts` + `POST /entities/merge` from `../backend-api-gaps.md`.

## Checklist

- [ ] **E-1** Entities directory — AC: paginated, searchable list of entities; columns for type, mention_count; sort by mentions/recency.
- [ ] **E-2** Entity profile page — AC: routed page per entity with overview header (name, type, mention count) and sections below.
- [ ] **E-3** Validity bars — AC: visual bar per fact/relationship showing valid_from→valid_to spans; expired segments visually distinct.
- [ ] **E-4** Supersession history — AC: collapsed-by-default history of superseded facts; expandable chain showing what replaced what (`superseded_by`).
- [ ] **E-5** Conflicts highlighted — AC: facts with `conflicts_with` render a conflict badge linking to Facts Explorer inbox.
- [ ] **E-6** Mention-trend sparkline — AC: sparkline of mentions over time on the profile; data from timeseries endpoint filtered to entity.
- [ ] **E-7** Receipts — AC: "receipts" section listing the memories that mention the entity (source evidence), each linking to memory detail.
- [ ] **E-8** Merge UI — AC: select two+ entities → merge dialog previewing result; confirm calls `POST /entities/merge`; handles undo-safe messaging.

## Learnings

(gotcha → fix → date)
