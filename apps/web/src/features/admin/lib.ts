import { ApiError } from '../../api/client'
import { cn } from '../../lib/cn'
import type { UsageGranularity, UsageRow } from './types'

/**
 * Pure helpers for the admin panel. Formatting mirrors lib/format.ts; the
 * chart palette mirrors components/insights/lib.ts (kept local so the feature
 * stays self-contained — same CSS variables, both themes ride them).
 */

export const CHART = {
  accent: 'var(--c-accent)',
  success: 'var(--c-success)',
  danger: 'var(--c-danger)',
  pending: 'var(--c-pending)',
  muted: 'var(--c-ink3)',
  hairline: 'var(--c-hairline)',
  ink2: 'var(--c-ink2)',
  surface: 'var(--c-surface)',
} as const

/** Palette for stacked series (tiers, phases) in usage charts. */
export const SERIES_PALETTE = [
  CHART.accent,
  CHART.success,
  CHART.pending,
  CHART.danger,
  'var(--g-project)',
  CHART.muted,
] as const

// --- Shared style constants (kept out of ui.tsx for fast refresh) -----------------

const tabBaseClasses =
  'rounded-pill px-md py-1.5 text-caption-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export { tabBaseClasses }

export const tabLinkClasses = cn(
  tabBaseClasses,
  'data-[status=active]:bg-accent-soft data-[status=active]:text-accent',
)

export const tableClasses = 'w-full border-collapse text-left'
export const thClasses =
  'border-b border-hairline px-xl py-sm text-micro font-medium uppercase tracking-wide text-ink3 whitespace-nowrap'
export const tdClasses = 'border-b border-hairline px-xl py-sm align-middle text-sub'

/** 1234 → "1.2k", 3_400_000 → "3.4M". Falls back to full number below 1000. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) < 1000) return String(n)
  if (Math.abs(n) < 1_000_000) {
    const v = n / 1000
    return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}k`
  }
  const v = n / 1_000_000
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}M`
}

/** 12.3 → "$12.30"; rounds to cents. Null/NaN → "—". */
export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

/** "Est." prefix helper for AI cost figures — always labelled as estimates. */
export function costLabel(usd: number | null | undefined): string {
  return `≈ ${formatUsd(usd)}`
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
}

/** HTTP status → Badge tone family used across admin tables. */
export function httpStatusTone(status: number): 'success' | 'pending' | 'danger' | 'neutral' {
  if (status >= 200 && status < 300) return 'success'
  if (status >= 400 && status < 500) return 'pending'
  if (status >= 500) return 'danger'
  return 'neutral'
}

/**
 * True when an error came from the API as a 403 — i.e. this signed-in user is
 * not an admin. Used to swap page error states for the "Admins only" notice.
 */
export function isForbidden(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 403
}

// --- tool-trace extraction from opaque turn meta ---------------------------------

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * Defensive parse of a turn's meta JSON into displayable trace chips.
 * Accepts several plausible shapes ({searches}, {tools:{…}}, {steps:[…]}) and
 * yields empty arrays when nothing recognizable exists.
 */
export function parseToolTrace(meta: unknown) {
  if (meta == null || typeof meta !== 'object') {
    return { searches: [] as string[], citationCount: 0, rulesApplied: [] as string[] }
  }
  const m = meta as Record<string, unknown>
  const tools = typeof m.tools === 'object' && m.tools !== null ? (m.tools as Record<string, unknown>) : m
  return {
    searches: asStringArray(tools.searches ?? m.searchQueries ?? m.queries),
    citationCount:
      countArray(tools.citations ?? m.citations) ||
      (typeof tools.citationCount === 'number' ? tools.citationCount : 0),
    rulesApplied: asStringArray(tools.rulesApplied ?? m.rules),
  }
}

// --- usage aggregation ------------------------------------------------------------

export interface AggregatedColumn {
  key: string
  inputTokens: number
  outputTokens: number
}

/** Sum usage rows into one stacked-bar column per period. */
export function aggregateByPeriod(rows: UsageRow[]): AggregatedColumn[] {
  const byPeriod = new Map<string, AggregatedColumn>()
  for (const r of rows) {
    const col = byPeriod.get(r.period) ?? { key: r.period, inputTokens: 0, outputTokens: 0 }
    col.inputTokens += r.inputTokens
    col.outputTokens += r.outputTokens
    byPeriod.set(r.period, col)
  }
  return [...byPeriod.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export interface AggregatedGroup extends AggregatedColumn {
  calls: number
}

/** Sum usage rows grouped by an arbitrary field ("model", "phase", "tier"). */
export function aggregateByField(rows: UsageRow[], field: 'model' | 'phase' | 'tier'): AggregatedGroup[] {
  const map = new Map<string, AggregatedGroup>()
  for (const r of rows) {
    const key = r[field] || '—'
    const g = map.get(key) ?? { key, inputTokens: 0, outputTokens: 0, calls: 0 }
    g.inputTokens += r.inputTokens
    g.outputTokens += r.outputTokens
    g.calls += r.calls
    map.set(key, g)
  }
  return [...map.values()].sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
}

/** "2026-08-07" / "2026-W32" / "2026-08" → short human label. */
export function periodLabel(period: string, granularity: UsageGranularity): string {
  if (granularity === 'month') {
    const [y, m] = period.split('-').map(Number)
    if (!y || !m) return period
    return new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' }).format(
      new Date(Date.UTC(y, m - 1, 1)),
    )
  }
  if (granularity === 'week') {
    const match = /(\d{4})-?W(\d{2})/.exec(period)
    if (!match) return period
    // ISO week → Monday of that week (rough anchor is fine for a label).
    const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4))
    const day = jan4.getUTCDay() || 7
    const monday = new Date(jan4)
    monday.setUTCDate(jan4.getUTCDate() - day + 1 + (Number(match[2]) - 1) * 7)
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(monday)
  }
  return period.slice(5) // "MM-DD" for days
}
