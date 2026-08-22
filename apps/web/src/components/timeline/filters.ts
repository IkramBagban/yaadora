import type { Memory } from '../../api/types';
import { dayKey, displayTime } from '../../lib/time';

/** Timeline-wide filter state. The list API has no server-side filter
 *  params (cursor + limit only), so all of this is applied client-side
 *  over loaded pages. */
export interface TimelineFilters {
  sources: Set<'manual' | 'voice' | 'import'>;
  status: 'all' | 'processing' | 'processed' | 'failed';
  dateFrom: string | null;
  dateTo: string | null;
  pinnedOnly: boolean;
}

export const emptyFilters: TimelineFilters = {
  sources: new Set(),
  status: 'all',
  dateFrom: null,
  dateTo: null,
  pinnedOnly: false,
};

export function hasActiveFilters(f: TimelineFilters): boolean {
  return (
    f.sources.size > 0 ||
    f.status !== 'all' ||
    f.dateFrom !== null ||
    f.dateTo !== null ||
    f.pinnedOnly
  );
}

/** True while ingestion has not finished (covers both worker states). */
export function isInFlight(m: Memory): boolean {
  return m.status === 'pending' || m.status === 'processing';
}

function matchesStatus(m: Memory, status: TimelineFilters['status']): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'processing':
      return isInFlight(m);
    case 'processed':
      return m.status === 'processed';
    case 'failed':
      return m.status === 'failed';
  }
}

export function applyFilters(items: Memory[], f: TimelineFilters): Memory[] {
  if (!hasActiveFilters(f)) return items;
  return items.filter((m) => {
    if (f.pinnedOnly && !m.pinned) return false;
    if (f.sources.size > 0 && !f.sources.has(m.source as 'manual' | 'voice' | 'import')) {
      return false;
    }
    if (!matchesStatus(m, f.status)) return false;
    const day = dayKey(displayTime(m.occurredAt, m.createdAt));
    if (f.dateFrom && day < f.dateFrom) return false;
    if (f.dateTo && day > f.dateTo) return false;
    return true;
  });
}
