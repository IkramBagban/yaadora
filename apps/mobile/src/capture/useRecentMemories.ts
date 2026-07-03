import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Memory } from '../api/types';
import { useOutbox } from './useOutbox';
import type { RowStatus } from '../components/MemoryRow';

export interface RecentRow {
  key: string;
  id: string | null;
  text: string;
  timestamp: string;
  status: RowStatus;
}

const MAX_ROWS = 3;

/**
 * The "Recent" strip on Capture: unsynced local items first, then the latest
 * server memories. Server fetch is strictly best-effort — offline or a dead
 * backend just means we show what's on this device, silently.
 */
export function useRecentMemories(enabled: boolean): RecentRow[] {
  const { items: outboxItems, pendingCount } = useOutbox();
  const [serverItems, setServerItems] = useState<Memory[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api
      .listMemories({ limit: MAX_ROWS })
      .then((page) => {
        if (alive) setServerItems(page.items);
      })
      .catch(() => {
        // Best-effort only: keep whatever we last had.
      });
    return () => {
      alive = false;
    };
    // Refetch when the queue drains so freshly synced items appear server-side.
  }, [enabled, pendingCount]);

  const local: RecentRow[] = [...outboxItems]
    .reverse()
    .map((item) => ({
      key: item.clientId,
      id: null,
      text: item.rawText,
      timestamp: item.createdAt,
      status: 'local',
    }));

  const remote: RecentRow[] = serverItems.map((memory) => ({
    key: memory.id,
    id: memory.id,
    text: memory.rawText,
    timestamp: memory.createdAt,
    status: memory.status,
  }));

  return [...local, ...remote].slice(0, MAX_ROWS);
}
