# Track: Entities directory & rich profiles (`E-*`)

Schema refs: `packages/db/schema/entities.ts`, `entity-edges.ts`, `memory-entities.ts`. Endpoints: existing `apps/server/src/routes/entities.ts` + `POST /entities/merge` from `../backend-api-gaps.md`.

## Checklist

- [x] **E-1** Entities directory — card grid; search (name/type), filter by type chips, sort by mentions/recency/name; mention counts + last-seen on every card.
- [x] **E-2** Entity profile page — routed `/entities/$id` dossier: header (name, type, mentions, last seen), AI profile summary, facts, loops, relations, receipts sections below.
- [x] **E-3** Validity bars — per-fact `valid_from→valid_to` span positioned inside the entity observation window; closed spans muted vs accent for current.
- [x] **E-4** Supersession history — collapsed-by-default section; per-predicate chains oldest→newest showing what replaced what.
- [x] **E-5** Conflicts highlighted — conflicted facts get a danger badge + section banner linking to the Facts Explorer inbox (`/facts`).
- [x] **E-6** Mention-trend sparkline — 12-month SVG sparkline on the profile, derived from receipt memory dates.
- [x] **E-7** Receipts — provenance memories listed as tappable sources; expand inline, deep-link to `/timeline?memory=<id>` (focus honoured when the timeline track ships detail view).
- [x] **E-8** Merge UI — tick two entities on the directory → floating bar → dialog previews remaps (mention fold, alias union, edge rebuild) → confirm calls `POST /entities/merge`; success shows the audit summary with undo-safe messaging.

## Learnings

(gotcha → fix → date)

- `GET /entities` and `/entities/:id/context` don't project `aliases`; directory/profile render without them until the server adds one line to each projection. → tracked as follow-up, not worked around client-side. → 2026-08-22
- `/stats/timeseries` counts memories per bucket but cannot filter to an entity → profile derives its mention trend client-side from receipt `occurredAt ?? createdAt`, bucketed into UTC months. → 2026-08-22
- `GET /facts` history view exposes bitemporal spans + `conflicted` flag but not the raw `superseded_by` uuid → supersession chains are rendered per-predicate (oldest→newest), which reconstructs what-replaced-what without inventing fields. → 2026-08-22
- Entity context edges carry evidence receipt counts, not the raw `strength` real → relations meter scales over a 5-receipt ceiling instead of faking a strength score. → 2026-08-22
