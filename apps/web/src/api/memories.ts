import { request } from './client';
import type {
  CreatedMemory,
  Memory,
  MemoryDetail,
  MemorySearchResponse,
} from './types';

/**
 * Memory endpoints (apps/server/src/routes/memories.ts + search.ts).
 * Shapes are verified against those routes; do not invent fields.
 */

/** Central query keys so cache patches and invalidations never drift. */
export const memoryKeys = {
  list: ['memories'] as const,
  detail: (id: string) => ['memory', id] as const,
  searchRoot: ['memory-search'] as const,
  search: (q: string) => ['memory-search', q] as const,
};

/** GET /memories */
export interface MemoryListResult {
  items: Memory[];
  nextCursor: string | null;
}

export interface MemoryListParams {
  /** createdAt ISO string from a previous page's nextCursor. */
  cursor?: string;
  /** Server clamps to 1..100 (default 20). */
  limit?: number;
}

export function listMemories(params: MemoryListParams = {}): Promise<MemoryListResult> {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  const qs = search.toString();
  return request<MemoryListResult>(`/memories${qs ? `?${qs}` : ''}`);
}

export function getMemoryDetail(id: string): Promise<MemoryDetail> {
  return request<MemoryDetail>(`/memories/${id}`);
}

export interface CreateMemoryInput {
  rawText: string;
  source: 'manual' | 'voice';
  /** Per-draft uuid; makes offline replays idempotent server-side. */
  clientId?: string;
}

export function createMemory(input: CreateMemoryInput): Promise<CreatedMemory> {
  return request<CreatedMemory>('/memories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function searchMemories(q: string, limit = 20): Promise<MemorySearchResponse> {
  const search = new URLSearchParams({ q });
  if (limit !== 20) search.set('limit', String(limit));
  return request<MemorySearchResponse>(`/memories/search?${search.toString()}`);
}

export function setMemoryPinned(id: string, pinned: boolean): Promise<{ id: string; pinned: boolean }> {
  return request<{ id: string; pinned: boolean }>(`/memories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ pinned }),
  });
}
