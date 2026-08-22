import { useQuery } from '@tanstack/react-query'
import {
  fetchCurrentFacts,
  fetchEntities,
  fetchMemoryPage,
  fetchStatsTimeseries,
  fetchSurfacingsSummary,
  type MemorySample,
} from '../../api/insights'
import type { Fact, Memory } from '../../api/types'

/**
 * React Query hooks for the Insights page. All read-only; 60s staleness keeps
 * drawer open/close from hammering the API while staying reasonably fresh.
 */

const STALE = 60_000

export function useSurfacingsSummary() {
  return useQuery({
    queryKey: ['surfacings-summary'],
    queryFn: fetchSurfacingsSummary,
    staleTime: STALE,
  })
}

export function useStatsTimeseries(days = 90) {
  return useQuery({
    queryKey: ['stats-timeseries', days],
    queryFn: () => fetchStatsTimeseries(days),
    staleTime: STALE,
  })
}

export function useEntities() {
  return useQuery({
    queryKey: ['entities'],
    queryFn: fetchEntities,
    staleTime: STALE,
  })
}

/**
 * Pattern-insight candidates: current facts filtered to consolidation origin
 * (the server has no origin param yet — see api/insights.ts).
 */
export function usePatternFacts() {
  return useQuery({
    queryKey: ['facts', 'patterns'],
    queryFn: async (): Promise<Fact[]> => {
      const page = await fetchCurrentFacts(200)
      return page.items.filter((f) => f.origin === 'consolidation')
    },
    staleTime: STALE,
  })
}

const SAMPLE_PAGES = 4 // 4 × 100 = up to 400 recent memories for habit charts

/**
 * Recent memories (newest first) for the capture-habits heatmap. The timeseries
 * endpoint only buckets by day, so hour-of-day must come from real timestamps.
 */
export function useMemoriesSample() {
  return useQuery({
    queryKey: ['memories', 'sample'],
    queryFn: async (): Promise<MemorySample> => {
      const items: Memory[] = []
      let cursor: string | undefined
      let truncated = false
      for (let i = 0; i < SAMPLE_PAGES; i++) {
        const page = await fetchMemoryPage(cursor, 100)
        items.push(...page.items)
        if (!page.nextCursor) break
        cursor = page.nextCursor
        truncated = i === SAMPLE_PAGES - 1 // still more pages beyond the cap
      }
      return { items, truncated }
    },
    staleTime: STALE,
  })
}
