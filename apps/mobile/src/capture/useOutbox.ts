import { useSyncExternalStore } from 'react';
import { flushOutbox, getOutboxState, subscribeOutbox, type OutboxItem } from './outbox';

export interface Outbox {
  items: OutboxItem[];
  pendingCount: number;
  syncing: boolean;
  lastSyncedAt: number | null;
  blockedError: string | null;
  flush: () => Promise<void>;
}

export function useOutbox(): Outbox {
  const state = useSyncExternalStore(subscribeOutbox, getOutboxState);
  return {
    items: state.items,
    pendingCount: state.items.length,
    syncing: state.syncing,
    lastSyncedAt: state.lastSyncedAt,
    blockedError: state.blockedError,
    flush: flushOutbox,
  };
}
