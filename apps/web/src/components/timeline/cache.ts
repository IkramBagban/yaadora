import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  memoryKeys,
  type MemoryListResult,
} from '../../api/memories';
import type { Memory, MemorySearchResponse } from '../../api/types';

/** React-Query cache surgery for the memories list. All timeline mutations
 *  (pin toggle, optimistic capture) go through here so the shape of the
 *  infinite cache is edited in exactly one place. */

function mapPages(
  data: InfiniteData<MemoryListResult> | undefined,
  fn: (items: Memory[], pageIndex: number) => Memory[],
): InfiniteData<MemoryListResult> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page, pageIndex) => ({
      ...page,
      items: fn(page.items, pageIndex),
    })),
  };
}

/** Merge a field update into every occurrence of a memory in the list cache. */
export function patchMemoryInList(
  qc: QueryClient,
  id: string,
  patch: Partial<Memory>,
): void {
  qc.setQueryData<InfiniteData<MemoryListResult>>(memoryKeys.list, (data) =>
    mapPages(data, (items) => items.map((m) => (m.id === id ? { ...m, ...patch } : m))),
  );
}

/** The pin state to roll back to, read from whichever cache currently holds
 *  the row. Null when no cache knows this memory (fresh search hit). */
export function readPinned(qc: QueryClient, id: string): boolean | null {
  const list = qc.getQueryData<InfiniteData<MemoryListResult>>(memoryKeys.list);
  const inList = list?.pages.flatMap((p) => p.items).find((m) => m.id === id);
  if (inList) return inList.pinned;
  for (const [, data] of qc.getQueriesData<MemorySearchResponse>({
    queryKey: memoryKeys.searchRoot,
  })) {
    const hit = data?.memories.find((m) => m.id === id);
    if (hit) return hit.pinned;
  }
  return null;
}

/** Patch a memory inside every cached search response too, so a star toggled
 *  in the results view stays consistent. */
export function patchMemoryInSearches(
  qc: QueryClient,
  id: string,
  patch: Partial<Memory>,
): void {
  qc.setQueriesData<MemorySearchResponse>({ queryKey: memoryKeys.searchRoot }, (data) =>
    data
      ? {
          ...data,
          memories: data.memories.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        }
      : data,
  );
}

/** Put a just-captured memory at the top of page 0. */
export function prependMemoryToList(qc: QueryClient, memory: Memory): void {
  qc.setQueryData<InfiniteData<MemoryListResult>>(memoryKeys.list, (data) =>
    mapPages(data, (items, pageIndex) => (pageIndex === 0 ? [memory, ...items] : items)),
  );
}

/** Drop a memory (used to roll back a failed optimistic capture). */
export function removeMemoryFromList(qc: QueryClient, id: string): void {
  qc.setQueryData<InfiniteData<MemoryListResult>>(memoryKeys.list, (data) =>
    mapPages(data, (items) => items.filter((m) => m.id !== id)),
  );
}
