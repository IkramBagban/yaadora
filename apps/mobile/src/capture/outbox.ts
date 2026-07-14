import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ApiError, type ApiErrorDetails } from '../api/client';
import { getAuthToken } from '../api/token';
import { newClientId } from '../lib/ids';

/**
 * The offline-first capture queue. Saving a memory writes here first —
 * synchronously from the UI's point of view — and syncing to the server
 * happens in the background. Capture never waits on the network.
 *
 * A tiny module-level store (subscribe/getSnapshot) keeps this framework-free;
 * `useOutbox` bridges it into React via useSyncExternalStore.
 */

export interface OutboxItem {
  clientId: string;
  rawText: string;
  source: 'manual';
  createdAt: string;
  attempts: number;
  lastError?: string;
  errorDetails?: ApiErrorDetails | null;
}

export interface OutboxState {
  items: OutboxItem[];
  syncing: boolean;
  hydrated: boolean;
  /** Set when a flush drains the queue — drives the "Synced" flash. */
  lastSyncedAt: number | null;
  /** A non-retryable server rejection (e.g. bad token); shown quietly, retried manually. */
  blockedError: string | null;
  /** Full error details for the debug modal. */
  lastErrorDetails: ApiErrorDetails | null;
}

const STORAGE_KEY = 'yaadora.outbox.v1';
const MAX_RETRY_DELAY_MS = 30_000;

let state: OutboxState = {
  items: [],
  syncing: false,
  hydrated: false,
  lastSyncedAt: null,
  blockedError: null,
  lastErrorDetails: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<OutboxState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOutboxState(): OutboxState {
  return state;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  } catch {
    // Storage write failed; items remain in memory for this session.
  }
}

/** Load queued items from disk. Called once by the sync engine at startup. */
export async function hydrateOutbox(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    setState({ items, hydrated: true });
  } catch {
    setState({ hydrated: true });
  }
  if (state.items.length > 0) void flushOutbox();
}

/** Local-first save. Returns immediately; sync happens in the background. */
export function enqueueMemory(rawText: string): OutboxItem {
  const item: OutboxItem = {
    clientId: newClientId(),
    rawText,
    source: 'manual',
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  setState({ items: [...state.items, item], blockedError: null });
  void persist();
  void flushOutbox();
  return item;
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRetry(): void {
  if (retryTimer) return;
  const attempts = state.items[0]?.attempts ?? 0;
  const delay = Math.min(MAX_RETRY_DELAY_MS, 2000 * 2 ** Math.min(attempts, 4));
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushOutbox();
  }, delay);
}

/**
 * Drain the queue serially (FIFO — capture order is chronology). The server
 * dedupes on clientId, so retrying a request that actually landed is safe.
 */
export async function flushOutbox(): Promise<void> {
  if (state.syncing || !state.hydrated || state.items.length === 0) return;

  // Wait until the user is signed in — don't burn retries on 401s.
  const token = await getAuthToken();
  if (!token) return;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  setState({ syncing: true });

  let drained = false;
  try {
    while (state.items.length > 0) {
      const item = state.items[0]!;
      try {
        await api.createMemory({
          rawText: item.rawText,
          clientId: item.clientId,
          source: item.source,
        });
        setState({ items: state.items.slice(1), blockedError: null });
        await persist();
        drained = state.items.length === 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed.';
        const details = err instanceof ApiError ? err.details : null;
        setState({
          items: state.items.map((it, i) =>
            i === 0 ? { ...it, attempts: it.attempts + 1, lastError: message, errorDetails: details } : it,
          ),
          lastErrorDetails: details,
        });
        void persist();
        if (err instanceof ApiError && err.status === 401) {
          setState({ blockedError: 'Sign in to sync your memories.' });
          break;
        }
        if (err instanceof ApiError && !err.retryable) {
          setState({ blockedError: message });
        } else {
          scheduleRetry();
        }
        break;
      }
    }
  } finally {
    setState({
      syncing: false,
      lastSyncedAt: drained ? Date.now() : state.lastSyncedAt,
    });
  }
}
