import type { Memory } from '../../api/types'

/**
 * Pure helpers + design tokens for Insights charts. Kept out of the component
 * files so fast-refresh boundaries stay clean and transforms stay testable.
 */

export const CHART = {
  accent: 'var(--c-accent)',
  success: 'var(--c-success)',
  danger: 'var(--c-danger)',
  pending: 'var(--c-pending)',
  muted: 'var(--c-ink3)',
  hairline: 'var(--c-hairline)',
  ink2: 'var(--c-ink2)',
  ink: 'var(--c-ink)',
  surface: 'var(--c-surface)',
} as const

/** snake_case kind/reason → readable label ("loop_nudge" → "Loop nudge"). */
export function humanizeToken(value: string): string {
  return value
    .split('_')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ')
}

export function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0
}

// --- Capture heatmap ---------------------------------------------------------------

export const HEAT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const HEAT_HOUR_LABELS = [0, 6, 12, 18] as const

/** 5-step intensity scale mixing the accent into the alt surface. */
export function heatCellColor(level: number): string {
  if (level === 0) return 'var(--c-surface-alt)'
  const mix = [0, 18, 38, 62, 88][level] ?? 88
  return `color-mix(in srgb, var(--c-accent) ${mix}%, var(--c-surface-alt))`
}

export interface HourGrid {
  /** counts[weekday (Mon=0 … Sun=6)][hour 0…23] */
  grid: number[][]
  bucketed: number
}

/** Bucket real memory timestamps into a weekday × hour grid (local time). */
export function buildHourGrid(memories: Memory[]): HourGrid {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  let bucketed = 0
  for (const m of memories) {
    const d = new Date(m.occurredAt ?? m.createdAt)
    if (Number.isNaN(d.getTime())) continue
    grid[(d.getDay() + 6) % 7]![d.getHours()]! += 1
    bucketed += 1
  }
  return { grid, bucketed }
}
