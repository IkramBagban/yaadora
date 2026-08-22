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

/** Compact relative time: "5m ago", "3d ago", "in 2h". Empty for unset/invalid. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const future = diff < 0;

  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`;

  const months = Math.round(days / 30);
  if (months < 12) return future ? `in ${months}mo` : `${months}mo ago`;

  const years = Math.round(months / 12);
  return future ? `in ${years}y` : `${years}y ago`;
}
