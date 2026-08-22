# Tracking — how web work is planned, done, and verified

## Model

- Work is organized into **tracks** by feature area. Each track has a checklist file in `webdocs/tracks/`.
- Every track item has:
  - an **ID** (e.g. `G-3` = graph item 3),
  - a `- [ ]` checkbox,
  - **acceptance criteria** (what "done" means),
  - an **owner issue #** (filled in when the issue is created; one issue = one agent).
- One item ≈ one small task. Never assign a whole feature to one agent.

## Workflow

1. Orchestrator/lead picks unchecked items, creates GitHub issues (one per item), writes the issue # next to the item.
2. Agent claims the issue, reads `webdocs/data.md` → this file → its track file, then implements.
3. In the SAME PR as the code, the worker must:
   - tick the checkbox (`- [ ]` → `- [x]`) for the completed item,
   - update the item status line if the track uses one,
   - append any learnings to `webdocs/tracks/<track>.md` "Learnings" section.
4. Orchestrator verifies the docs were updated before approving the PR.

## Learnings format

Strict format — `gotcha → fix → date`, few lines max:

```
- TanStack Query refetches on window focus by default in dev → set `refetchOnWindowFocus: false` or SSE updates double-fire → 2026-08-22
```

## Per-track files

| Track | File | ID prefix |
|---|---|---|
| Platform / cross-cutting infra | `tracks/platform.md` | `P` |
| Overview dashboard | `tracks/overview.md` | `O` |
| Timeline browser + search | `tracks/timeline-search.md` | `T` |
| Knowledge Graph | `tracks/graph.md` | `G` |
| Entities directory & profiles | `tracks/entities.md` | `E` |
| Facts Explorer | `tracks/facts-explorer.md` | `F` |
| Open Loops board | `tracks/open-loops.md` | `L` |
| Rules manager | `tracks/rules.md` | `R` |
| Ask on web | `tracks/ask-web.md` | `A` |
| Reminders | `tracks/reminders.md` | `M` |
| Insights & Analytics | `tracks/insights-analytics.md` | `I` |
| Settings & Privacy | `tracks/settings-export.md` | `S` |

Backend endpoint work is tracked in `backend-api-gaps.md`; reference it from the track item that needs each endpoint.

## Status vocabulary

- `[ ]` todo · `[~]` in progress (issue # assigned) · `[x]` done (merged to `web`)
