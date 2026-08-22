import { request } from './client';
import type { EntityContextPayload, GraphSnapshot } from './types';

/** GET /graph/snapshot — whole-graph view for the knowledge graph page. */
export function fetchGraphSnapshot(): Promise<GraphSnapshot> {
  return request<GraphSnapshot>('/graph/snapshot');
}

/** GET /entities/:id/context — profile, facts, loops, 1-hop edges, receipts. */
export function fetchEntityContext(id: string): Promise<EntityContextPayload> {
  return request<EntityContextPayload>(`/entities/${encodeURIComponent(id)}/context`);
}
