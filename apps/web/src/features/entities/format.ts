/**
 * Date/number formatting helpers for the entities feature.
 * All timestamps over the wire are ISO strings (or null).
 */

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** "Mar 12, 2026" — empty string for null input. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : DATE_FMT.format(d)
}

/** "3d ago" / "in 2w" style coarse relative time. Falls back to the date. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = d.getTime() - Date.now()
  const abs = Math.abs(diffMs)
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  const WEEK = 7 * DAY

  let value: string
  if (abs < HOUR) value = `${Math.max(1, Math.round(abs / MIN))}m`
  else if (abs < DAY) value = `${Math.round(abs / HOUR)}h`
  else if (abs < WEEK) value = `${Math.round(abs / DAY)}d`
  else if (abs < 5 * WEEK) value = `${Math.round(abs / WEEK)}w`
  else return formatDate(iso)

  return diffMs >= 0 ? `in ${value}` : `${value} ago`
}

/**
 * Bucket an ISO timestamp into its UTC month key ("2026-03").
 */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/**
 * The last `months` UTC month keys, oldest first, ending with the current one.
 * Empty months are included so trend charts don't collapse gaps.
 */
export function lastMonthKeys(months: number): string[] {
  const keys: string[] = []
  const now = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    keys.push(d.toISOString().slice(0, 7))
  }
  return keys
}

/** Short month label from a "2026-03" key → "Mar". */
export function shortMonthLabel(key: string): string {
  const [year, month] = key.split('-')
  if (!year || !month) return key
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
  return Number.isNaN(d.getTime())
    ? key
    : new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(d)
}
