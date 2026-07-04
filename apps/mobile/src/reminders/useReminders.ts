import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '../api/client';
import type { Reminder } from '../api/types';
import {
  cancelScheduled,
  ensureNotificationPermission,
  syncScheduled,
} from '../lib/notifications';

export interface RemindersState {
  upcoming: Reminder[];
  suggested: Reminder[];
  loading: boolean;
  error: string | null;
  refreshing: boolean;
}

/**
 * The reminders data layer: loads upcoming (pending & future) and suggested
 * (awaiting a tap) reminders, exposes optimistic actions, and keeps on-device
 * notifications in sync with the pending set after every change and whenever the
 * app returns to the foreground.
 */
export function useReminders() {
  const [state, setState] = useState<RemindersState>({
    upcoming: [],
    suggested: [],
    loading: true,
    error: null,
    refreshing: false,
  });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    setState((s) => ({
      ...s,
      loading: mode === 'initial' ? true : s.loading,
      refreshing: mode === 'refresh',
      error: null,
    }));
    try {
      const [up, sug] = await Promise.all([
        api.listReminders('upcoming'),
        api.listReminders('suggested'),
      ]);
      if (!mounted.current) return;
      setState({
        upcoming: up.items,
        suggested: sug.items,
        loading: false,
        refreshing: false,
        error: null,
      });
      // Keep OS notifications aligned with the freshly-loaded pending set.
      void syncScheduled(up.items);
    } catch (err) {
      if (!mounted.current) return;
      setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: err instanceof Error ? err.message : 'Could not load reminders.',
      }));
    }
  }, []);

  // Initial load + ask for permission once, and re-sync on foreground.
  useEffect(() => {
    void ensureNotificationPermission();
    void load('initial');
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load('refresh');
    });
    return () => sub.remove();
  }, [load]);

  const refresh = useCallback(() => load('refresh'), [load]);

  /** Accept a suggestion → it becomes a pending reminder and gets scheduled. */
  const accept = useCallback(async (id: string) => {
    const promoted = await api.acceptSuggestion(id);
    if (!mounted.current) return;
    setState((s) => {
      const upcoming = [...s.upcoming, promoted].sort(
        (a, b) => +new Date(a.dueAt) - +new Date(b.dueAt),
      );
      void syncScheduled(upcoming);
      return { ...s, suggested: s.suggested.filter((r) => r.id !== id), upcoming };
    });
  }, []);

  /** Dismiss a suggestion (never scheduled, so nothing to cancel). */
  const dismissSuggestion = useCallback(async (id: string) => {
    setState((s) => ({ ...s, suggested: s.suggested.filter((r) => r.id !== id) }));
    try {
      await api.cancelReminder(id);
    } catch {
      /* optimistic; a refresh will reconcile */
    }
  }, []);

  /** Mark an upcoming reminder done. */
  const complete = useCallback(async (id: string) => {
    setState((s) => ({ ...s, upcoming: s.upcoming.filter((r) => r.id !== id) }));
    void cancelScheduled(id);
    try {
      await api.completeReminder(id);
    } catch {
      /* optimistic */
    }
  }, []);

  /** Cancel an upcoming reminder. */
  const cancel = useCallback(async (id: string) => {
    setState((s) => ({ ...s, upcoming: s.upcoming.filter((r) => r.id !== id) }));
    void cancelScheduled(id);
    try {
      await api.cancelReminder(id);
    } catch {
      /* optimistic */
    }
  }, []);

  return { ...state, refresh, accept, dismissSuggestion, complete, cancel };
}
