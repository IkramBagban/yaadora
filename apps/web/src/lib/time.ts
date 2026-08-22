/**
 * Timeline time helpers. Grouping uses the viewer's local timezone: these are
 * personal memories, so "Today" means the user's today. (Contrast: ingestion
 * stats charts bucket in UTC for cross-region consistency.)
 */

/** The timestamp a memory is displayed under: event time once ingestion has
 *  resolved it, otherwise capture time. */
export function displayTime(occurredAt: string | null, createdAt: string): string {
  return occurredAt ?? createdAt;
}

/** Local calendar day key (YYYY-MM-DD) for date grouping. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const dayWithYearFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "Today" / "Yesterday" / "Sat 16 Aug" (year appended when not current). */
export function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return key;
  const date = new Date(y, m - 1, d);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = today.getTime() - date.getTime();
  const days = Math.round(diffMs / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.getFullYear() === today.getFullYear()
    ? dayFormatter.format(date)
    : dayWithYearFormatter.format(date);
}

/** Compact relative age for row captions: "just now", "5m", "3h", "2d", then a date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - t) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return dayFormatter.format(new Date(iso));
}

const detailFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Full timestamp for the detail panel: "22 Aug 2026, 14:32". */
export function formatDateTime(iso: string | null): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown' : detailFormatter.format(d);
}
