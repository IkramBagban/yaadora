# Track: Open Loops board (`L-*`)

Kinds: `commitment | unresolved_conflict | upcoming_event | goal | thread`. Schema: `packages/db/schema/open-loops.ts`. Endpoints: `GET /open-loops`, `POST /open-loops`, `PATCH /open-loops/:id` from `../backend-api-gaps.md`.

## Checklist

- [x] **L-1** Kanban board — AC: columns by status; cards show kind icon, title, due date; drag between statuses persists via PATCH. (#11)
- [x] **L-2** Rows-by-kind view — AC: toggle to flat list grouped by kind; same actions available as kanban. (#11)
- [x] **L-3** Overdue chips — AC: loops past due date get an overdue chip (red tone from theme tokens); overdue filter toggle. (#11)
- [x] **L-4** Convert-to-reminder — AC: action converts a loop into a reminder pre-filling title/due date; original loop marked converted. (#11 — see learnings: marked `resolved`, no `converted` status exists)
- [x] **L-5** Manual goal planting — AC: form creates a `goal` loop via POST with title, notes, due date; appears immediately on board. (#11 — see learnings: no notes column in schema)
- [x] **L-6** Loop detail/edit — AC: click card to edit fields or close loop; validation on required fields. (#11)

## Learnings

(gotcha → fix → date)

- PATCH /open-loops/:id accepted only status/dueAt/title, so "this memory closes it" had nowhere to persist → added nullable `resolvedBy` (+ ownership check) to PATCH body in the loops-owned endpoint files (`apps/server/src/routes/open-loops.ts`, `packages/db/queries/open-loops.ts`) → 2026-08-22
- open_loops lifecycle has no `converted` status → convert-to-reminder POSTs /reminders/confirm then marks the loop `resolved`; a dedicated marker would need a schema change → 2026-08-22
- open_loops has no notes column → L-5 planting captures title/kind/due only; don't invent wire fields → 2026-08-22
- TanStack Query refetchOnWindowFocus fights optimistic kanban drags mid-flight → set `refetchOnWindowFocus: false` on the loops query → 2026-08-22
- oxlint react(set-state-in-effect) flags sync setState in effects → derive short-query state during render and move setLoading into the debounced timeout → 2026-08-22
