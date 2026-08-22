# Track: Settings & Privacy (`S-*`)

Existing routes: `apps/server/src/routes/settings.ts`, `me.ts`. Theme must match mobile's light+dark tokens (`apps/mobile/src/theme/useTheme.ts`).

## Checklist

- [x] **S-1** Settings shell — AC: routed settings page with nav sections; saves via settings endpoints; dirty-state guard. (issue #16)
- [x] **S-2** Privacy form — AC: privacy preferences form matching mobile options; validation + success/error feedback. (issue #16)
- [x] **S-3** Data export — AC: export account data as JSON or Markdown download; large exports show progress and stream if needed. (issue #16)
- [~] **S-4** Device tokens — AC: list registered push/device tokens with remove action. (issue #16 — UI shipped against planned `GET/DELETE /push-tokens`; endpoints not on the server yet, section degrades to an honest notice)
- [~] **S-5** Danger zone: derived rebuild — AC: clearly separated destructive action rebuilding derived data; double-confirm dialog; job status feedback. (issue #16 — dialog + status UI shipped against planned `POST /settings/rebuild`; endpoint not on the server yet)
- [x] **S-6** Theme toggle — AC: light/dark toggle using ported mobile tokens for both themes (NOT dark-first — locked decision); preference persisted. (issue #16)

## Learnings

(gotcha → fix → date)

- No server endpoints for device-token list/remove or derived-state rebuild exist yet → web feature ships full UI wired to the planned wire shapes (`{items:[{id,deviceId,expoToken,updatedAt}]}`, `DELETE /push-tokens/:id` 204, `POST /settings/rebuild` → `{jobId,status}`), detects 404 via `ApiError.status` and shows a "not available yet" notice; backend issue should add rows to `backend-api-gaps.md` and the UI works unchanged → 2026-08-22
- Data export needs "everything" but only read endpoints exist → export is composed client-side: memories + facts keyset-paginated to completion (limit 100/200), entities/open-loops/reminders/rules/digests single-shot at server caps (500/500/100/—/—) with per-phase progress callbacks → 2026-08-22
- Initializing form drafts from TanStack Query data via `useEffect(setState)` trips oxlint's `react(set-state-in-effect)` → derive draft as `edits ?? toDraft(saved)` during render; "discard" just clears `edits` → 2026-08-22
