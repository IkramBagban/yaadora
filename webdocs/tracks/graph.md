# Track: Knowledge Graph (`G-*`)

Global entity graph built with `@xyflow/react`. Data source: `GET /graph/snapshot` (exposes existing `getGraphSnapshot()` in `@repo/db`). Schema refs: `entities`, `entity_edges` (`strength`, `evidence`).

## Checklist

- [ ] **G-1** Graph canvas — AC: `@xyflow/react` renders nodes/edges from snapshot; pan/zoom/minimap working; performs acceptably at current graph size.
- [ ] **G-2** Node sizing — AC: node size scales with `mention_count`; legend explains mapping.
- [ ] **G-3** Node coloring — AC: node color = entity type; consistent palette from theme tokens; legend lists types.
- [ ] **G-4** Edge styling — AC: edge width ∝ `strength`; dashed style = unresolved or ended relationship; solid otherwise.
- [ ] **G-5** Click → side panel — AC: clicking a node opens panel with entity summary, top edges, mention count; link to full profile in Entities track.
- [ ] **G-6** Walk mode — AC: from a selected node, expand its neighborhood step-by-step instead of rendering whole graph; back navigation works.
- [ ] **G-7** Filters — AC: filter by entity type, min edge strength, hide isolated nodes; filters apply client-side without refetch.

## Learnings

(gotcha → fix → date)
