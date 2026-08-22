import type { Edge, Node } from '@xyflow/react';
import type { GraphSnapshot, GraphSnapshotEntity } from '../../api/types';
import type { Point } from './layout';
import { neighborhoodIds } from './layout';

/** Canonical entity types from ingestion, ordered for display. */
const KNOWN_TYPES = ['person', 'place', 'org', 'topic', 'project', 'event'] as const;

const TYPE_COLOR_VARS: Record<string, string> = {
  person: 'var(--g-person)',
  place: 'var(--g-place)',
  org: 'var(--g-org)',
  topic: 'var(--g-topic)',
  project: 'var(--g-project)',
  event: 'var(--g-event)',
};

/** Any unrecognized type falls back to the neutral dot. */
export function typeColorVar(type: string): string {
  return TYPE_COLOR_VARS[type] ?? 'var(--g-other)';
}

export function typeLabel(type: string): string {
  return KNOWN_TYPES.includes(type as (typeof KNOWN_TYPES)[number]) ? type : 'other';
}

export interface GraphMetrics {
  maxMentions: number;
  maxStrength: number;
}

export function computeMetrics(snapshot: GraphSnapshot): GraphMetrics {
  let maxMentions = 1;
  let maxStrength = 0;
  for (const e of snapshot.entities) maxMentions = Math.max(maxMentions, e.mentionCount);
  for (const e of snapshot.edges) maxStrength = Math.max(maxStrength, e.strength);
  return { maxMentions, maxStrength };
}

/** Avatar diameter: 34–72px, sqrt-scaled so hubs stand out without dwarfing the tail. */
export function nodeDiameter(mentionCount: number, metrics: GraphMetrics): number {
  const norm = Math.min(mentionCount / metrics.maxMentions, 1);
  return Math.round(34 + 38 * Math.sqrt(norm));
}

/** Stroke width: 1–5px scaled linearly against the dataset's strongest edge. */
export function edgeWidth(strength: number, metrics: GraphMetrics): number {
  const norm = metrics.maxStrength > 0 ? Math.min(strength / metrics.maxStrength, 1) : 0;
  return 1 + 4 * norm;
}

export interface GraphFilters {
  enabledTypes: ReadonlySet<string>;
  minStrength: number;
  /** Keep only edges mentioned within the last N months; null = all time. */
  withinMonths: number | null;
  /** Drop nodes with no visible edge (the focused node always stays). */
  hideIsolated: boolean;
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function withinTimeWindow(lastMentioned: string | null, withinMonths: number | null): boolean {
  if (withinMonths === null) return true;
  if (!lastMentioned) return false;
  return new Date(lastMentioned).getTime() >= Date.now() - withinMonths * MONTH_MS;
}

export type EntityNodeData = {
  entity: GraphSnapshotEntity;
  diameter: number;
};

export type RelationEdgeData = {
  relType: string;
  status: string;
  strength: number;
  width: number;
  lastMentioned: string | null;
};

export type EntityFlowNode = Node<EntityNodeData, 'entity'>;
export type RelationFlowEdge = Edge<RelationEdgeData, 'relation'>;

export interface VisibleGraph {
  nodes: EntityFlowNode[];
  edges: RelationFlowEdge[];
}

/**
 * Pure derivation from snapshot + precomputed layout to the xyflow arrays:
 * entity-type toggles hide nodes (and their edges); the strength floor and
 * last-mentioned time window hide edges only; hideIsolated then drops
 * degree-0 nodes (the focus anchor always stays); a focus id swaps in the
 * 1-hop neighborhood subgraph.
 */
export function buildVisibleGraph(
  snapshot: GraphSnapshot,
  layout: ReadonlyMap<string, Point>,
  metrics: GraphMetrics,
  filters: GraphFilters,
  focusId: string | null,
): VisibleGraph {
  const allowed = focusId ? neighborhoodIds(snapshot.edges, focusId) : null;

  const nodes: EntityFlowNode[] = [];
  const visible = new Set<string>();
  for (const entity of snapshot.entities) {
    if (!filters.enabledTypes.has(entity.type)) continue;
    if (allowed && !allowed.has(entity.id)) continue;
    visible.add(entity.id);
    const at = layout.get(entity.id) ?? { x: 0, y: 0 };
    nodes.push({
      id: entity.id,
      type: 'entity',
      position: at,
      data: { entity, diameter: nodeDiameter(entity.mentionCount, metrics) },
    });
  }

  const edges: RelationFlowEdge[] = [];
  const seen = new Set<string>();
  for (const e of snapshot.edges) {
    if (!visible.has(e.aId) || !visible.has(e.bId)) continue;
    if (e.strength < filters.minStrength) continue;
    if (!withinTimeWindow(e.lastMentioned, filters.withinMonths)) continue;
    const id = `${e.aId}:${e.bId}:${e.relType}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      id,
      source: e.aId,
      target: e.bId,
      type: 'relation',
      data: {
        relType: e.relType,
        status: e.status,
        strength: e.strength,
        width: edgeWidth(e.strength, metrics),
        lastMentioned: e.lastMentioned,
      },
    });
  }

  if (filters.hideIsolated) {
    const connected = new Set<string>(focusId ? [focusId] : []);
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    return { nodes: nodes.filter((n) => connected.has(n.id)), edges };
  }

  return { nodes, edges };
}

/** Entity types present in the dataset: canonical order first, then any extras. */
export function orderedTypes(entities: readonly GraphSnapshotEntity[]): string[] {
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const known = KNOWN_TYPES.filter((t) => counts.has(t));
  const extras = [...counts.keys()]
    .filter((t) => !KNOWN_TYPES.includes(t as (typeof KNOWN_TYPES)[number]))
    .sort();
  return [...known, ...extras];
}

export function typeCounts(entities: readonly GraphSnapshotEntity[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return counts;
}

/** Prefix search over canonical names, best matches (mentions) first. */
export function searchEntities(
  entities: readonly GraphSnapshotEntity[],
  query: string,
  limit = 8,
): GraphSnapshotEntity[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return entities
    .filter((e) => e.canonicalName.toLowerCase().includes(q))
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, limit);
}
