import type { GraphSnapshotEdge, GraphSnapshotEntity } from '../../api/types';

export interface Point {
  x: number;
  y: number;
}

export interface LayoutOptions {
  /** Simulation iterations; ~150 settles a 400-node graph. */
  iterations?: number;
  /** Logical canvas area the layout spreads over. */
  width?: number;
  height?: number;
}

const DEFAULTS = { iterations: 150, width: 1600, height: 1000 } as const;

const REPULSION = 120_000;
const SPRING = 0.06;
const GRAVITY = 0.012;
const COOLING = 0.92;
const PADDING = 60;
/**
 * Repulsion cutoff: at 350px the force (REPULSION/d² ≈ 0.98px) falls below
 * the temperature floor (≥ 1px), so farther pairs can be skipped entirely.
 */
const CUTOFF2 = 350 * 350;

/**
 * Deterministic force-directed layout (Fruchterman–Reingold style):
 * pairwise repulsion + link springs (stronger edges settle closer) +
 * gentle centering gravity under a cooling temperature schedule.
 *
 * Pure — no DOM and no randomness (nodes seed on a golden-angle spiral),
 * so the same dataset always produces the same positions. Compute once
 * per dataset; drag afterwards only moves individual nodes.
 */
export function computeLayout(
  entities: readonly GraphSnapshotEntity[],
  edges: readonly GraphSnapshotEdge[],
  options: LayoutOptions = {},
): Map<string, Point> {
  const { iterations, width, height } = { ...DEFAULTS, ...options };
  const positions = new Map<string, Point>();
  const n = entities.length;
  if (n === 0) return positions;

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  const radius = (Math.min(width, height) / 2 - PADDING) / Math.sqrt(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = radius * Math.sqrt(i + 0.5);
    const a = i * golden;
    xs[i] = width / 2 + r * Math.cos(a);
    ys[i] = height / 2 + r * Math.sin(a);
  }

  const index = new Map<string, number>();
  for (let i = 0; i < n; i++) index.set(entities[i].id, i);

  let maxStrength = 0;
  const springs: Array<[ai: number, bi: number, t: number]> = [];
  for (const e of edges) {
    const ai = index.get(e.aId);
    const bi = index.get(e.bId);
    if (ai === undefined || bi === undefined) continue;
    maxStrength = Math.max(maxStrength, e.strength);
    springs.push([ai, bi, e.strength]);
  }
  // Stronger edges target shorter rest lengths.
  const restLength = (s: number) =>
    maxStrength > 0 ? 100 + (1 - s / maxStrength) * 160 : 180;

  const cx = width / 2;
  const cy = height / 2;
  let temperature = Math.min(width, height) / 8;

  for (let iter = 0; iter < iterations && temperature >= 0.5; iter++) {
    dx.fill(0);
    dy.fill(0);

    for (let i = 0; i < n; i++) {
      const xi = xs[i];
      const yi = ys[i];
      for (let j = i + 1; j < n; j++) {
        let fx = xi - xs[j];
        let fy = yi - ys[j];
        let d2 = fx * fx + fy * fy;
        if (d2 > CUTOFF2) continue;
        if (d2 < 1) {
          // Coincident pair: nudge apart deterministically by index order.
          fx = i < j ? 1 : -1;
          fy = 0;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const force = Math.min(REPULSION / d2, 4 * temperature);
        const scale = force / d;
        const ux = fx * scale;
        const uy = fy * scale;
        dx[i] += ux;
        dy[i] += uy;
        dx[j] -= ux;
        dy[j] -= uy;
      }
    }

    for (const [ai, bi, s] of springs) {
      const fx = xs[ai] - xs[bi];
      const fy = ys[ai] - ys[bi];
      const d = Math.max(Math.hypot(fx, fy), 1);
      const force = (d - restLength(s)) * SPRING;
      const ux = fx / d;
      const uy = fy / d;
      dx[ai] -= ux * force;
      dy[ai] -= uy * force;
      dx[bi] += ux * force;
      dy[bi] += uy * force;
    }

    for (let i = 0; i < n; i++) {
      dx[i] += (cx - xs[i]) * GRAVITY;
      dy[i] += (cy - ys[i]) * GRAVITY;

      const disp = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      if (disp > temperature) {
        dx[i] = (dx[i] / disp) * temperature;
        dy[i] = (dy[i] / disp) * temperature;
      }
      xs[i] = Math.min(Math.max(xs[i] + dx[i], PADDING), width - PADDING);
      ys[i] = Math.min(Math.max(ys[i] + dy[i], PADDING), height - PADDING);
    }

    // Movement is bounded by temperature; once it is sub-pixel the layout
    // has settled and remaining iterations provably change nothing.
    temperature *= COOLING;
  }

  for (let i = 0; i < n; i++) {
    positions.set(entities[i].id, { x: Math.round(xs[i]), y: Math.round(ys[i]) });
  }
  return positions;
}

/** Ids of `focusId` plus everything connected by an edge (1-hop neighborhood). */
export function neighborhoodIds(
  edges: readonly GraphSnapshotEdge[],
  focusId: string,
): Set<string> {
  const ids = new Set<string>([focusId]);
  for (const e of edges) {
    if (e.aId === focusId) ids.add(e.bId);
    else if (e.bId === focusId) ids.add(e.aId);
  }
  return ids;
}
