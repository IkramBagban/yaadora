import { useCallback, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listMemories, memoryKeys, setMemoryPinned } from '../../api/memories';
import type { Memory, MemoryDetail } from '../../api/types';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  applyFilters,
  emptyFilters,
  hasActiveFilters,
  type TimelineFilters,
} from './filters';
import {
  patchMemoryInList,
  patchMemoryInSearches,
  readPinned,
} from './cache';
import { QuickCapture } from './QuickCapture';
import { FilterBar } from './FilterBar';
import { TimelineFeed } from './TimelineFeed';
import { SearchResults } from './SearchResults';
import { MemoryDetailPanel } from './MemoryDetailPanel';
import { Search, X } from 'lucide-react';

const SEARCH_DEBOUNCE_MS = 350;

/** Timeline & Memory Browser. The page owns mode (feed vs search), filters,
 *  the pin mutation and the detail slide-over; children stay presentational. */
export function TimelinePage() {
  const qc = useQueryClient();

  const [filters, setFilters] = useState<TimelineFilters>(emptyFilters);
  const [searchText, setSearchText] = useState('');
  const [openMemoryId, setOpenMemoryId] = useState<string | null>(null);
  const debouncedQ = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);
  const searching = debouncedQ.trim().length > 0;

  const feedScrollRef = useRef<HTMLDivElement | null>(null);

  const {
    data: feedData,
    isPending: feedPending,
    isError: feedError,
    refetch: refetchFeed,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: memoryKeys.list,
    queryFn: ({ pageParam }) => listMemories({ cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const allMemories = useMemo(
    () => feedData?.pages.flatMap((page) => page.items) ?? [],
    [feedData],
  );
  const visibleMemories = useMemo(
    () => applyFilters(allMemories, filters),
    [allMemories, filters],
  );

  const onLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      setMemoryPinned(id, pinned),
    onMutate: async ({ id, pinned }) => {
      await qc.cancelQueries({ queryKey: memoryKeys.list });
      const prevPinned = readPinned(qc, id) ?? !pinned;
      patchMemoryInList(qc, id, { pinned });
      patchMemoryInSearches(qc, id, { pinned });
      qc.setQueryData<MemoryDetail>(memoryKeys.detail(id), (d) =>
        d ? { ...d, memory: { ...d.memory, pinned } } : d,
      );
      return { prevPinned };
    },
    onError: (_err, { id }, ctx) => {
      if (!ctx) return;
      patchMemoryInList(qc, id, { pinned: ctx.prevPinned });
      patchMemoryInSearches(qc, id, { pinned: ctx.prevPinned });
      qc.setQueryData<MemoryDetail>(memoryKeys.detail(id), (d) =>
        d ? { ...d, memory: { ...d.memory, pinned: ctx.prevPinned } } : d,
      );
    },
  });

  const onTogglePin = useCallback(
    (memory: Memory) => {
      // Optimistic temp rows from a capture still in flight have no server id.
      if (memory.id.startsWith('temp-')) return;
      pinMutation.mutate({ id: memory.id, pinned: !memory.pinned });
    },
    [pinMutation],
  );

  const onCaptured = useCallback(() => {
    requestAnimationFrame(() => {
      feedScrollRef.current?.scrollTo({ top: 0 });
    });
  }, []);

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col gap-md md:h-[calc(100dvh-6.5rem)]">
      <h1 className="sr-only">Timeline</h1>

      <QuickCapture onCaptured={onCaptured} />

      <div className="shrink-0 space-y-sm">
        <div className="relative">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-ink3"
          />
          <input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search your memories…"
            aria-label="Search memories"
            className="h-10 w-full rounded-md border border-hairline bg-surface pl-xxl pr-lg text-body text-ink placeholder:text-ink3 focus:border-accent focus:outline-none"
          />
          {searchText && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchText('')}
              className="absolute right-md top-1/2 -translate-y-1/2 cursor-pointer p-xxs text-ink3 hover:text-ink"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {!searching && <FilterBar value={filters} onChange={setFilters} />}

        {!searching && hasActiveFilters(filters) && (
          <p className="text-caption text-ink3">
            Showing {visibleMemories.length} of {allMemories.length} loaded
          </p>
        )}
      </div>

      {/* The feed stays mounted (hidden) during search so its scroll position
          and virtualizer state survive the round trip. */}
      {feedError ? (
        <div role="alert" className="flex flex-col items-center gap-md py-xxl text-center">
          <p className="text-sub text-ink2">
            The timeline failed to load. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => void refetchFeed()}
            className="cursor-pointer text-caption-medium text-accent underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : (
        <TimelineFeed
          memories={visibleMemories}
          isLoading={feedPending}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPage={hasNextPage}
          totalLoaded={allMemories.length}
          scrollRef={feedScrollRef}
          hidden={searching}
          onLoadMore={onLoadMore}
          onOpen={setOpenMemoryId}
          onTogglePin={onTogglePin}
          onClearFilters={() => setFilters(emptyFilters)}
        />
      )}

      {searching && (
        <SearchResults
          query={debouncedQ.trim()}
          onOpen={setOpenMemoryId}
          onTogglePin={onTogglePin}
          onBack={() => setSearchText('')}
        />
      )}

      <MemoryDetailPanel
        memoryId={openMemoryId}
        onClose={() => setOpenMemoryId(null)}
        onTogglePin={onTogglePin}
      />
    </div>
  );
}
