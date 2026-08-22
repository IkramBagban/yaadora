import { lastMonthKeys, monthKey } from './format'
import type { EntityReceipt } from './api'

/**
 * E-6 mention-trend series derived client-side from receipt memories.
 *
 * The shared /stats/timeseries endpoint counts memories per bucket but cannot
 * filter to a single entity, so the profile derives its own series from the
 * entity's receipts (occurredAt when known, else captured-at). Buckets are
 * UTC months; empty months stay in the series so gaps read as gaps.
 */
export function buildMentionTrend(receipts: EntityReceipt[], months = 12): {
  keys: string[]
  counts: number[]
} {
  const keys = lastMonthKeys(months)
  const counts = new Map<string, number>(keys.map((k) => [k, 0]))

  for (const r of receipts) {
    const iso = r.occurredAt ?? r.createdAt
    const key = monthKey(iso)
    const slot = counts.get(key)
    if (slot !== undefined) counts.set(key, slot + 1)
  }

  return { keys, counts: keys.map((k) => counts.get(k) ?? 0) }
}
