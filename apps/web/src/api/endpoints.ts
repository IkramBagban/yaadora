/**
 * Typed fetchers for the web-facing endpoints (see apps/server/src/routes).
 * Each function mirrors one route; response shapes live in types.ts.
 */

import { request } from './client';
import type {
  DigestList,
  MemoryPage,
  OpenLoopList,
  Reminder,
  ReminderList,
  StatsBucket,
  StatsOverview,
  TimeseriesResponse,
} from './types';

export function fetchStatsOverview(): Promise<StatsOverview> {
  return request<StatsOverview>('/stats/overview');
}

export function fetchTimeseries(days: number, bucket: StatsBucket): Promise<TimeseriesResponse> {
  return request<TimeseriesResponse>(`/stats/timeseries?days=${days}&bucket=${bucket}`);
}

export function fetchDigests(): Promise<DigestList> {
  return request<DigestList>('/digests');
}

export function fetchOpenLoops(status: 'open' | 'resolved' | 'expired'): Promise<OpenLoopList> {
  return request<OpenLoopList>(`/open-loops?status=${status}&limit=100`);
}

export function fetchReminders(scope: 'upcoming' | 'all' | 'suggested'): Promise<ReminderList> {
  return request<ReminderList>(`/reminders?scope=${scope}&limit=50`);
}

export function fetchRecentMemories(limit: number): Promise<MemoryPage> {
  return request<MemoryPage>(`/memories?limit=${limit}`);
}

/** POST /reminders/:id/confirm — promote a suggested chip to pending. */
export function confirmSuggestedReminder(id: string): Promise<Reminder> {
  return request<Reminder>(`/reminders/${id}/confirm`, { method: 'POST' });
}

/** DELETE /reminders/:id — soft cancel (status='dismissed'). */
export function dismissReminder(id: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/reminders/${id}`, { method: 'DELETE' });
}
