# Track: Reminders (`M-*`)

Schema: `packages/db/schema/reminders.ts`; push delivery via `push_tokens`. Existing routes: `apps/server/src/routes/reminders.ts`, `push-tokens.ts`.

## Checklist

- [x] **M-1** Reminders table — AC: sortable columns (due date, status, recurrence); row actions complete/edit/delete. *(issue #14)*
- [x] **M-2** Month calendar view — AC: calendar grid with reminders on due dates; day click filters table; month navigation. *(issue #14)*
- [x] **M-3** Suggested queue — AC: suggested reminders listed for confirm/dismiss; confirm creates real reminder; dismiss hides permanently. *(issue #14 — bulk confirm/dismiss with select-all)*
- [x] **M-4** Recurrence editing — AC: edit recurring rules (daily/weekly/custom) with clear UI; next-occurrence preview before save. *(issue #14 — schema supports once/daily/weekly; weekday picker + live next-occurrence preview in editor)*
- [ ] **M-5** Device tokens — AC: manage registered push tokens (list/remove device) reachable from reminders settings.

## Learnings

(gotcha → fix → date)
- Server rejects `weekdays` unless recurrence is 'weekly' (create) / nulls it otherwise (update) → web api layer sends weekdays only when recurrence === 'weekly' → 2026-08-22
- GET /reminders?scope=upcoming excludes past-due pending rows (gte now server-side), so overdue rows are only visible via scope=all → overdue emphasis lives on the All view plus a global banner + red calendar dots → 2026-08-22
- No scope returns done/dismissed rows; DELETE /reminders/:id is a soft-dismiss (status='dismissed') → table shows active inventory only, delete = dismiss semantics in the UI → 2026-08-22
- apps/web Tailwind theme defines spacing tokens xs..huge only (`2xs`/`3xs` don't exist) → stick to the declared token scale or arbitrary values like gap-[2px] → 2026-08-22
