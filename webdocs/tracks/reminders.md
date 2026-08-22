# Track: Reminders (`M-*`)

Schema: `packages/db/schema/reminders.ts`; push delivery via `push_tokens`. Existing routes: `apps/server/src/routes/reminders.ts`, `push-tokens.ts`.

## Checklist

- [ ] **M-1** Reminders table — AC: sortable columns (due date, status, recurrence); row actions complete/edit/delete.
- [ ] **M-2** Month calendar view — AC: calendar grid with reminders on due dates; day click filters table; month navigation.
- [ ] **M-3** Suggested queue — AC: suggested reminders listed for confirm/dismiss; confirm creates real reminder; dismiss hides permanently.
- [ ] **M-4** Recurrence editing — AC: edit recurring rules (daily/weekly/custom) with clear UI; next-occurrence preview before save.
- [ ] **M-5** Device tokens — AC: manage registered push tokens (list/remove device) reachable from reminders settings.

## Learnings

(gotcha → fix → date)
