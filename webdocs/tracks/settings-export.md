# Track: Settings & Privacy (`S-*`)

Existing routes: `apps/server/src/routes/settings.ts`, `me.ts`. Theme must match mobile's light+dark tokens (`apps/mobile/src/theme/useTheme.ts`).

## Checklist

- [ ] **S-1** Settings shell — AC: routed settings page with nav sections; saves via settings endpoints; dirty-state guard.
- [ ] **S-2** Privacy form — AC: privacy preferences form matching mobile options; validation + success/error feedback.
- [ ] **S-3** Data export — AC: export account data as JSON or Markdown download; large exports show progress and stream if needed.
- [ ] **S-4** Device tokens — AC: list registered push/device tokens with remove action.
- [ ] **S-5** Danger zone: derived rebuild — AC: clearly separated destructive action rebuilding derived data; double-confirm dialog; job status feedback.
- [ ] **S-6** Theme toggle — AC: light/dark toggle using ported mobile tokens for both themes (NOT dark-first — locked decision); preference persisted.

## Learnings

(gotcha → fix → date)
