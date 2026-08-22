const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'unknown' : dateFmt.format(d)
}

/** 0..1 → "72%" (confidence display; null treated as unknown). */
export function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

/** Compact relative time for list rows ("just now", "3h ago", "Aug 12"). */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(then).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** 0…1 confidence rendered as a quiet percentage label. */
export function formatConfidence(confidence: number | null): string {
  if (confidence === null || Number.isNaN(confidence)) return ''
  return `${Math.round(confidence * 100)}%`
}
