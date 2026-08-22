/** Small display helpers shared by the rules feature components. */

/** Compact relative time for "last applied" / "created" stamps. */
export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return 'never'
  if (ms < 0) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

/** Cosine similarity (-1..1, practically 0..1 here) as a percentage string. */
export function formatScore(score: number): string {
  return `${Math.round(Math.max(0, score) * 100)}%`
}

/**
 * Width (%) of an apply-count bar relative to the busiest rule in the list.
 * A nonzero count always shows a sliver so the bar never disappears.
 */
export function applyBarWidth(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.max(6, Math.round((count / max) * 100))
}
