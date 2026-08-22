import type { Recurrence, Reminder, Weekday } from '../../api/types';
import { formatDateTime, formatTime } from './dates';

/**
 * Pure helpers for the reminders feature: date math, recurrence previews,
 * calendar grid, sorting comparators. No React, no fetch — trivially testable.
 */

// ---------------------------------------------------------------------------
// Weekdays & recurrence metadata
// ---------------------------------------------------------------------------

export interface WeekdayOption {
  value: Weekday;
  /** Two-letter cell label. */
  letter: string;
  short: string;
}

export const WEEKDAY_OPTIONS: readonly WeekdayOption[] = [
  { value: 0, letter: 'Su', short: 'Sun' },
  { value: 1, letter: 'Mo', short: 'Mon' },
  { value: 2, letter: 'Tu', short: 'Tue' },
  { value: 3, letter: 'We', short: 'Wed' },
  { value: 4, letter: 'Th', short: 'Thu' },
  { value: 5, letter: 'Fr', short: 'Fri' },
  { value: 6, letter: 'Sa', short: 'Sat' },
] as const;

const weekdayShort = (n: number): string =>
  WEEKDAY_OPTIONS.find((w) => w.value === n)?.short ?? `d${n}`;

export interface RecurrenceOption {
  value: Recurrence;
  label: string;
}

export const RECURRENCE_OPTIONS: readonly RecurrenceOption[] = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
] as const;

/** "Once" | "Daily" | "Weekly · Mon, Wed" */
export function recurrenceSummary(recurrence: Recurrence, weekdays: number[] | null): string {
  if (recurrence === 'weekly') {
    const days = [...new Set(weekdays ?? [])].sort((a, b) => a - b).map(weekdayShort);
    return days.length > 0 ? `Weekly · ${days.join(', ')}` : 'Weekly';
  }
  return recurrence === 'daily' ? 'Daily' : 'Once';
}

/**
 * Next fire time for a recurring reminder, relative to `now`. For once this is
 * just dueAt. Mirrors the server convention: daily/weekly repeat at dueAt's
 * clock time-of-day.
 */
export function nextOccurrence(
  now: Date,
  recurrence: Recurrence,
  timeOfDay: Date,
  weekdays: number[] | null,
): Date {
  if (recurrence === 'once') return timeOfDay;

  const at = (base: Date): Date =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate(), timeOfDay.getHours(), timeOfDay.getMinutes());

  if (recurrence === 'daily') {
    const today = at(now);
    return today > now ? today : at(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  }

  // weekly — first selected day (today allowed if the time hasn't passed).
  const selected = new Set(weekdays ?? []);
  for (let offset = 0; offset < 8; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (!selected.has(day.getDay())) continue;
    const candidate = at(day);
    if (candidate > now) return candidate;
  }
  return at(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
}

/** One-line preview shown before save ("Every day at 09:00 · next Tue, Aug 25"). */
export function occurrencePreview(
  recurrence: Recurrence,
  timeOfDay: Date,
  weekdays: number[] | null,
  now = new Date(),
): string {
  if (recurrence === 'once') return `Fires ${formatDateTime(timeOfDay)}`;
  const when =
    recurrence === 'daily'
      ? `Every day at ${formatTime(timeOfDay)}`
      : `${recurrenceSummary('weekly', weekdays)} at ${formatTime(timeOfDay)}`;
  return `${when} · next ${formatDateTime(nextOccurrence(now, recurrence, timeOfDay, weekdays))}`;
}

// ---------------------------------------------------------------------------
// Status / emphasis
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'pending';

export function statusTone(status: Reminder['status']): BadgeTone {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'suggested':
      return 'accent';
    case 'done':
      return 'success';
    default:
      return 'neutral';
  }
}

/** Overdue = pending but past its due moment. */
export function isOverdue(reminder: Reminder, now = new Date()): boolean {
  return reminder.status === 'pending' && new Date(reminder.dueAt) < now;
}

// ---------------------------------------------------------------------------
// Sorting (table columns: due date, status, recurrence)
// ---------------------------------------------------------------------------

export type SortKey = 'dueAt' | 'status' | 'recurrence';
export type SortDir = 'asc' | 'desc';

const STATUS_RANK: Record<string, number> = { pending: 0, suggested: 1, done: 2, dismissed: 3 };
const RECURRENCE_RANK: Record<Recurrence, number> = { once: 0, daily: 1, weekly: 2 };

function compareValues(key: SortKey, a: Reminder, b: Reminder): number {
  switch (key) {
    case 'dueAt':
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    case 'status':
      return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    case 'recurrence':
      return RECURRENCE_RANK[a.recurrence] - RECURRENCE_RANK[b.recurrence];
  }
}

export function sortReminders(items: Reminder[], key: SortKey, dir: SortDir): Reminder[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => sign * compareValues(key, a, b));
}
