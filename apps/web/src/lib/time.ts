/**
 * Shared time helpers. Day grouping uses the viewer's local timezone: these are
 * personal memories, so "Today" means the user's today. (Contrast: ingestion
 * stats charts bucket in UTC for cross-region consistency — see the UTC label
 * helpers at the bottom.)
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

// --- overview dashboard: due labels + UTC bucket labels -----------------------

const DAY = 86_400_000;

/**
 * Compact due label for upcoming things: "overdue 2d", "today", "tomorrow",
 * "in 3d", "in 2w", "Mar 14".
 */
export function relativeDue(iso: string, now: Date = new Date()): { label: string; overdue: boolean } {
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return { label: '', overdue: false };

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const dayDiff = Math.round((startOfDue - startOfToday) / DAY);

  if (dayDiff < 0) return { label: `overdue ${Math.abs(dayDiff)}d`, overdue: true };
  if (dayDiff === 0) return { label: 'today', overdue: false };
  if (dayDiff === 1) return { label: 'tomorrow', overdue: false };
  if (dayDiff < 14) return { label: `in ${dayDiff}d`, overdue: false };
  if (dayDiff < 60) return { label: `in ${Math.round(dayDiff / 7)}w`, overdue: false };
  return {
    label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(due),
    overdue: false,
  };
}

/** "Fri, Aug 22" style label from a UTC date key ("2026-08-22"). */
export function utcDayLabel(utcDayKey: string): string {
  const [y, m, d] = utcDayKey.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)));
}

/** Short month label ("Aug") for heatmap column headers, from a UTC day key. */
export function utcMonthLabel(utcDayKey: string): string {
  const [y, m] = utcDayKey.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y!, (m ?? 1) - 1, 1)),
  );
}
