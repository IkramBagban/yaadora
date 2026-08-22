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
