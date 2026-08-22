import { request } from './client'
import type { Entity, EntityListItem, Fact, Memory } from './types'

/**
 * Wire types + fetchers for the Insights page.
 * Shapes mirror @repo/db query returns exactly (see packages/db/queries/stats.ts
 * and the server routes that serialize them). Do not invent fields here.
 *
 * NOTE: /facts has no `origin` filter param yet — consolidation facts are
 * filtered client-side via `origin === 'consolidation'`.
 */

// --- GET /surfacings/summary ------------------------------------------------

export interface SurfacingKindSummary {
  /** every ledger row of this kind, suppressed ones included (analytics view) */
  kind: string
  total: number
  /** rows blocked by a gate — never shown to the user */
  suppressed: number
  /** shown but not yet reacted to */
  pending: number
  reactionCounts: Record<string, number>
}

export interface SuppressionReasonRow {
  kind: string
  reason: string
  count: number
}

export interface SurfacingsSummary {
  summaries: SurfacingKindSummary[]
  suppressionReasons: SuppressionReasonRow[]
}

// --- GET /stats/timeseries --------------------------------------------------

export type StatsBucket = 'day' | 'week' | 'month'

export interface TimeseriesPoint {
  /** ISO start of the bucket (UTC) */
  bucketStart: string
  total: number
  bySource: Record<string, number>
}

export interface StatsTimeseries {
  days: number
  bucket: StatsBucket
  points: TimeseriesPoint[]
}

// --- GET /entities ------------------------------------------------------------

export interface EntityListResponse {
  entities: EntityListItem[]
}

// --- GET /facts ----------------------------------------------------------------

export interface FactPage {
  items: Fact[]
  nextCursor: string | null
}

// --- GET /memories -------------------------------------------------------------

export interface MemoryPage {
  items: Memory[]
  nextCursor: string | null
}

/** Recent memories for habit charts; `truncated` = sample hit the page cap. */
export interface MemorySample {
  items: Memory[]
  truncated: boolean
}

// --- Fetchers -------------------------------------------------------------------

export function fetchSurfacingsSummary(): Promise<SurfacingsSummary> {
  return request<SurfacingsSummary>('/surfacings/summary')
}

export function fetchStatsTimeseries(days = 90): Promise<StatsTimeseries> {
  return request<StatsTimeseries>(`/stats/timeseries?days=${days}&bucket=day`)
}

export function fetchEntities(): Promise<EntityListResponse> {
  return request<EntityListResponse>('/entities')
}

/** Current facts, newest first (used to pick consolidation-origin patterns). */
export function fetchCurrentFacts(limit = 200): Promise<FactPage> {
  return request<FactPage>(`/facts?view=current&limit=${limit}`)
}

export function fetchMemoryPage(cursor?: string, limit = 100): Promise<MemoryPage> {
  const qs = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
  return request<MemoryPage>(`/memories?limit=${limit}${qs}`)
}

export function fetchMemoryDetail(id: string): Promise<{
  memory: Memory
  facts: Fact[]
  entities: Entity[]
}> {
  return request(`/memories/${id}`)
}

// --- Helpers --------------------------------------------------------------------

const SUPPORTED_BY_RE = /^supported_by:\s*([0-9a-f-]+(?:,\s*[0-9a-f-]+)*)$/i

/**
 * Consolidation facts keep their multi-memory provenance in `objectText`
 * as `supported_by: <uuid>, <uuid>, …` (packages/core/consolidation). The
 * `sourceMemory` column holds only the first id. Returns every cited id.
 */
export function supportingMemoryIds(fact: Fact): string[] {
  const m = SUPPORTED_BY_RE.exec(fact.objectText ?? '')
  if (!m) return fact.sourceMemory ? [fact.sourceMemory] : []
  return m[1]!.split(',').map((s) => s.trim()).filter(Boolean)
}
