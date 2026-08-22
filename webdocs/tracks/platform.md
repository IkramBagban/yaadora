# Track: Platform & cross-cutting (`P-*`)

App shell and shared infrastructure in `apps/web`. Stack is locked: Vite React TS SPA, TanStack Router + Query, Tailwind with mobile tokens, `@xyflow/react`, Recharts. See `../data.md` LOCKED DECISIONS.

## Checklist

- [x] **P-1** Vite scaffold — AC: `apps/web` Vite React TS app boots; dev server runs. (done on `web`: f07bf53)
- [x] **P-2** Tailwind setup — AC: Tailwind v4 via `@tailwindcss/vite`; base styles in `index.css`. (done with scaffold)
- [ ] **P-3** Routing — AC: TanStack Router file-based routes; shell layout with nav; 404 page.
- [ ] **P-4** Data layer — AC: TanStack Query client configured (sensible defaults: no window-focus refetch storms); query key conventions documented here.
- [ ] **P-5** Theme port — AC: mobile design tokens from `apps/mobile/src/theme/tokens.ts` mapped to Tailwind/CSS vars; light+dark both working (NOT dark-first).
- [ ] **P-6** API client + auth — AC: shared fetch client attaching Clerk bearer token like `apps/mobile/src/api/client.ts`; typed per `apps/mobile/src/api/types.ts`; 401 handling.
- [ ] **P-7** App shell & responsiveness — AC: desktop-first layout, sidebar/topbar, usable down to tablet; content max-widths consistent.
- [ ] **P-8** cmd-K palette — AC: global command palette (cmd-K) for navigation + actions; fuzzy match; keyboard-only operable.
- [ ] **P-9** Unified global search — AC: one search entry point across memories/entities/facts routing to the right view with filters applied.
- [ ] **P-10** Empty states — AC: shared EmptyState component used by all list views; friendly copy + primary action per context.
- [ ] **P-11** Deploy config — AC: `vercel.json` at `apps/web` with SPA rewrite; Root Directory set per Vercel project settings; preview deploys green.
- [ ] **P-12** Typecheck/lint wiring — AC: web workspace included in repo typecheck/lint scripts; CI-clean baseline established.

## Learnings

(gotcha → fix → date)
