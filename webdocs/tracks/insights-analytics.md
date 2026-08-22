# Track: Insights & Analytics (`I-*`)

Data sources: `surfacings` ledger (`suppressed_reason`), digests, consolidation outputs, AI token usage. Endpoints: `GET /surfacings/summary`, `/stats/timeseries` from `../backend-api-gaps.md`.

## Checklist

- [ ] **I-1** Engagement by nudge kind — AC: chart of engagement rates grouped by nudge kind; percentage labels.
- [ ] **I-2** Suppression breakdown — AC: pie/bar of `suppressed_reason` distribution from `/surfacings/summary`.
- [ ] **I-3** Capture habits — AC: hour-of-day histogram, source mix donut, current capture streak counter.
- [ ] **I-4** Fading-relationship alerts — AC: list entities not touched in N days with last-contact date; configurable threshold.
- [ ] **I-5** Pattern-insights feed — AC: feed of insights with origin = consolidation; each links to supporting memories/entities.
- [ ] **I-6** AI token usage — AC: token usage over time by feature (ask, ingestion, consolidation); monthly total card.

## Learnings

(gotcha → fix → date)
