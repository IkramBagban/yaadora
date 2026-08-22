import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Memory } from '../../api/types';
import { dayKey, dayLabel, displayTime } from '../../lib/time';
import { MemoryRow } from './MemoryRow';
import { FeedSkeleton } from './Skeletons';
import { Spinner } from '../ui/Spinner';
import { Button } from '../ui/Button';

/** Interleaved virtual row: a day header or a memory card. */
type FeedRow =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'memory'; key: string; memory: Memory };

function buildRows(memories: Memory[]): FeedRow[] {
  const rows: FeedRow[] = [];
  let currentDay = '';
  for (const memory of memories) {
    const key = dayKey(displayTime(memory.occurredAt, memory.createdAt));
    if (key !== currentDay) {
      currentDay = key;
      rows.push({ kind: 'header', key: `header-${key}`, label: dayLabel(key) });
    }
    rows.push({ kind: 'memory', key: memory.id, memory });
  }
  return rows;
}

/** Cap consecutive automatic fetches when filters hide everything loaded
 *  so far; past this the user decides with the explicit button. */
const MAX_FILTERED_AUTO_FETCHES = 5;

interface TimelineFeedProps {
  memories: Memory[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  /** Rows loaded so far, before the active filters hid them. */
  totalLoaded: number;
  /** Owned by the page: virtualizer reads it, the page scrolls it to top
   *  after a capture. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** While search results are shown the feed stays mounted but hidden. */
  hidden: boolean;
  onLoadMore: () => void;
  onOpen: (id: string) => void;
  onTogglePin: (memory: Memory) => void;
  onClearFilters: () => void;
}

export function TimelineFeed({
  memories,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  totalLoaded,
  scrollRef,
  hidden,
  onLoadMore,
  onOpen,
  onTogglePin,
  onClearFilters,
}: TimelineFeedProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const autoFetchesRef = useRef(0);
  // Last known scroll offset; display:none can clobber element.scrollTop, so
  // restore from this ref whenever the feed becomes visible again.
  const scrollTopRef = useRef(0);

  const rows = useMemo(() => buildRows(memories), [memories]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].kind === 'header' ? 38 : 132),
    overscan: 8,
    getItemKey: (index) => rows[index].key,
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const save = () => {
      scrollTopRef.current = el.scrollTop;
    };
    el.addEventListener('scroll', save, { passive: true });
    return () => el.removeEventListener('scroll', save);
  }, [scrollRef]);

  useEffect(() => {
    if (hidden) return;
    const raf = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollTopRef.current;
    });
    return () => cancelAnimationFrame(raf);
  }, [hidden, scrollRef]);

  // Natural infinite scroll: a sentinel just past the virtual container.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage || hidden) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) {
          autoFetchesRef.current = 0;
          onLoadMore();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore, hidden]);

  // When filters hide every loaded row but older pages may match, keep
  // fetching a bounded number of times before falling back to a button.
  useEffect(() => {
    if (
      rows.length === 0 &&
      hasNextPage &&
      !isLoading &&
      !isFetchingNextPage &&
      autoFetchesRef.current < MAX_FILTERED_AUTO_FETCHES
    ) {
      autoFetchesRef.current += 1;
      onLoadMore();
    }
  }, [rows.length, hasNextPage, isLoading, isFetchingNextPage, onLoadMore]);

  return (
    <div ref={scrollRef} hidden={hidden} className="min-h-0 flex-1 overflow-y-auto px-xs">
      {isLoading ? (
        <FeedSkeleton />
      ) : rows.length === 0 ? (
        <EmptyFeed
          totalLoaded={totalLoaded}
          hasNextPage={hasNextPage}
          onLoadMore={onLoadMore}
          onClearFilters={onClearFilters}
        />
      ) : (
        <>
          <div
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            className="w-full"
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    transform: `translateY(${item.start}px)`,
                    width: '100%',
                  }}
                  className={row.kind === 'header' ? 'py-sm' : 'pb-sm'}
                >
                  {row.kind === 'header' ? (
                    <h2 className="px-xs text-caption-medium uppercase tracking-wide text-ink2">
                      {row.label}
                    </h2>
                  ) : (
                    <MemoryRow
                      memory={row.memory}
                      onOpen={onOpen}
                      onTogglePin={onTogglePin}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div ref={sentinelRef} aria-hidden className="h-px" />

          <div className="flex justify-center py-lg">
            {isFetchingNextPage ? (
              <Spinner size={18} className="text-ink3" />
            ) : hasNextPage ? (
              <p className="text-caption text-ink3">
                Scroll to load older memories ({memories.length} loaded)
              </p>
            ) : (
              <p className="text-caption text-ink3">
                You have reached the beginning.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyFeed({
  totalLoaded,
  hasNextPage,
  onLoadMore,
  onClearFilters,
}: {
  totalLoaded: number;
  hasNextPage: boolean;
  onLoadMore: () => void;
  onClearFilters: () => void;
}) {
  if (totalLoaded === 0) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-sm px-lg py-xxl text-center">
        <p className="text-title font-semibold text-ink">Nothing captured yet</p>
        <p className="max-w-sm text-sub text-ink2">
          Type a thought, a moment, or a plan into the box above. Everything you
          capture becomes part of your memory.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-md px-lg py-xxl text-center">
      <p className="text-title font-semibold text-ink">
        No memories match these filters
      </p>
      <p className="max-w-sm text-sub text-ink2">
        {totalLoaded} loaded {totalLoaded === 1 ? 'memory is' : 'memories are'}{' '}
        currently hidden.
        {hasNextPage ? ' Older matches may exist beyond what has loaded.' : ''}
      </p>
      <div className="flex gap-sm">
        {hasNextPage && (
          <Button variant="secondary" size="sm" onClick={onLoadMore}>
            Load older
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    </div>
  );
}
