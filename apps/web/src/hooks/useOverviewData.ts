/**
 * React Query hooks backing the Overview dashboard. One query per endpoint,
 * keyed under ['overview', …] so reminder mutations can invalidate the stat
 * cards that echo suggested/pending counts.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  confirmSuggestedReminder,
  dismissReminder,
  fetchDigests,
  fetchOpenLoops,
  fetchRecentMemories,
  fetchReminders,
  fetchStatsOverview,
  fetchTimeseries,
} from '../api/endpoints';
import type { OpenLoopItem, TimeseriesPoint } from '../api/types';

export const overviewKeys = {
  all: ['overview'] as const,
  stats: ['overview', 'stats'] as const,
  timeseries: (days: number, bucket: string) => ['overview', 'timeseries', days, bucket] as const,
  digests: ['overview', 'digests'] as const,
  openLoops: ['overview', 'open-loops'] as const,
  suggestedReminders: ['overview', 'reminders', 'suggested'] as const,
  recentMemories: ['overview', 'recent-memories'] as const,
};

/** Daily buckets covering the heatmap window (~15 weeks) and week trends. */
export const HEATMAP_DAYS = 105;

export function useStatsOverview() {
  return useQuery({
    queryKey: overviewKeys.stats,
    queryFn: fetchStatsOverview,
    staleTime: 60_000,
  });
}

/** Daily counts for the heatmap calendar and the "+N this week" trend. */
export function useDailyTimeseries() {
  return useQuery({
    queryKey: overviewKeys.timeseries(HEATMAP_DAYS, 'day'),
    queryFn: () => fetchTimeseries(HEATMAP_DAYS, 'day'),
    staleTime: 60_000,
  });
}

export type ChartRange = 'daily' | 'weekly';

const CHART_RANGE: Record<ChartRange, { days: number; bucket: 'day' | 'week' }> = {
  daily: { days: 30, bucket: 'day' },
  weekly: { days: 84, bucket: 'week' },
};

export function useChartTimeseries(range: ChartRange) {
  const { days, bucket } = CHART_RANGE[range];
  return useQuery({
    queryKey: overviewKeys.timeseries(days, bucket),
    queryFn: () => fetchTimeseries(days, bucket),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

/** The weekly digest entry (kind === 'week'), if consolidation has written one. */
export function useWeekDigest() {
  const query = useQuery({
    queryKey: overviewKeys.digests,
    queryFn: fetchDigests,
    staleTime: 5 * 60_000,
  });
  const week = useMemo(
    () => query.data?.digests.find((d) => d.kind === 'week') ?? null,
    [query.data],
  );
  return { ...query, week };
}

export function useOpenLoops() {
  return useQuery({
    queryKey: overviewKeys.openLoops,
    queryFn: () => fetchOpenLoops('open'),
    staleTime: 60_000,
  });
}

export function useSuggestedReminders() {
  return useQuery({
    queryKey: overviewKeys.suggestedReminders,
    queryFn: () => fetchReminders('suggested'),
    staleTime: 15_000,
  });
}

/** One-tap confirm/dismiss for suggested reminder chips. */
export function useReminderActions() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: overviewKeys.suggestedReminders });
    void queryClient.invalidateQueries({ queryKey: overviewKeys.stats });
  };

  const confirm = useMutation({ mutationFn: confirmSuggestedReminder, onSuccess: invalidate });
  const dismiss = useMutation({ mutationFn: dismissReminder, onSuccess: invalidate });
  return { confirm, dismiss };
}

export function useRecentMemories() {
  return useQuery({
    queryKey: overviewKeys.recentMemories,
    queryFn: () => fetchRecentMemories(8),
    staleTime: 30_000,
  });
}

// --- pure derivations shared by widgets --------------------------------------

/** Memories captured in the trailing 7 daily buckets, and the week before. */
export function weekTrend(points: TimeseriesPoint[]): { thisWeek: number; lastWeek: number } {
  const daily = points.map((p) => p.total);
  const thisWeek = daily.slice(-7).reduce((a, b) => a + b, 0);
  const lastWeek = daily.slice(-14, -7).reduce((a, b) => a + b, 0);
  return { thisWeek, lastWeek };
}

/** Open loops due within `days` (overdue included), soonest first. */
export function dueSoonLoops(items: OpenLoopItem[], days: number, now = new Date()): OpenLoopItem[] {
  const horizon = now.getTime() + days * 86_400_000;
  return items
    .filter((l) => l.dueAt !== null && new Date(l.dueAt).getTime() <= horizon)
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
}
