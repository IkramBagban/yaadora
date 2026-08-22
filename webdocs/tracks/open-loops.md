# Track: Open Loops board (`L-*`)

Kinds: `commitment | unresolved_conflict | upcoming_event | goal | thread`. Schema: `packages/db/schema/open-loops.ts`. Endpoints: `GET /open-loops`, `POST /open-loops`, `PATCH /open-loops/:id` from `../backend-api-gaps.md`.

## Checklist

- [ ] **L-1** Kanban board — AC: columns by status; cards show kind icon, title, due date; drag between statuses persists via PATCH.
- [ ] **L-2** Rows-by-kind view — AC: toggle to flat list grouped by kind; same actions available as kanban.
- [ ] **L-3** Overdue chips — AC: loops past due date get an overdue chip (red tone from theme tokens); overdue filter toggle.
- [ ] **L-4** Convert-to-reminder — AC: action converts a loop into a reminder pre-filling title/due date; original loop marked converted.
- [ ] **L-5** Manual goal planting — AC: form creates a `goal` loop via POST with title, notes, due date; appears immediately on board.
- [ ] **L-6** Loop detail/edit — AC: click card to edit fields or close loop; validation on required fields.

## Learnings

(gotcha → fix → date)
