import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { flushOutbox, hydrateOutbox } from './outbox';

let started = false;

/**
 * Background sync triggers: hydrate once at startup, then flush whenever
 * connectivity returns or the app comes to the foreground. Idempotent.
 */
export function startSyncEngine(): void {
  if (started) return;
  started = true;

  void hydrateOutbox();

  NetInfo.addEventListener((netState) => {
    if (netState.isConnected) void flushOutbox();
  });

  AppState.addEventListener('change', (appState) => {
    if (appState === 'active') void flushOutbox();
  });
}
