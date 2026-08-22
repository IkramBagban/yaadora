# Track: Overview dashboard (`O-*`)

Landing dashboard summarizing the whole system. Needs endpoints from `../backend-api-gaps.md` (`GET /stats/overview`, `/stats/timeseries`, `/digests`, open-loops, surfacings).

## Checklist

- [ ] **O-1** Stat cards row — AC: memories count, entities count, open loops, pending reminders; live from `GET /stats/overview`; loading skeletons.
- [ ] **O-2** Capture heatmap — AC: per-day capture counts (calendar style), last ~90 days, tooltip per cell.
- [ ] **O-3** Timeseries charts (Recharts) — AC: captures/memories over time from `GET /stats/timeseries?days&bucket`; bucket switcher (day/week).
- [ ] **O-4** Weekly digest card — AC: latest digest from `GET /digests`; renders digest content; links to full history.
- [ ] **O-5** Due loops list — AC: open loops due today/overdue from open-loops endpoint; overdue chips; link into Open Loops board.
- [ ] **O-6** Suggested-reminders queue — AC: suggested reminders surfaced inline; confirm/dismiss actions hit reminders endpoints; optimistic update.
- [ ] **O-7** Dashboard composition — AC: sections arranged responsively using app shell; each section lazy-loaded; empty states handled.

## Learnings

(gotcha → fix → date)
