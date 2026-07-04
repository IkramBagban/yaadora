/** Human time formatting. All inputs are ISO strings from the API or outbox. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "just now" · "12m" · "3h" · "yesterday" · "Jun 24" · "Jun 24, 2025" */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY && startOfDay(now) === startOfDay(then)) {
    return `${Math.floor(diff / HOUR)}h`;
  }
  const dayDelta = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (dayDelta === 1) return 'yesterday';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (then.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return then.toLocaleDateString(undefined, opts);
}

/** Section label for the timeline: "Today" · "Yesterday" · "June 24" · "June 24, 2025" */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const dayDelta = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (dayDelta === 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
  if (then.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return then.toLocaleDateString(undefined, opts);
}

/** Capture header: "THURSDAY · JULY 3" (uppercasing is done by the micro type style). */
export function todayHeading(now: Date = new Date()): string {
  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' });
  const date = now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  return `${weekday} · ${date}`;
}

/** Memory detail: "Thursday, July 3 · 9:41 PM" */
export function formatDateLong(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function startOfDayD(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Reminder due time: "Today · 3:00 PM" · "Tomorrow · 9:00 AM" · "Sun · 3:00 PM" · "Jul 12 · 3:00 PM". */
export function dueLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const delta = Math.round((startOfDayD(d) - startOfDayD(now)) / DAY);
  let day: string;
  if (delta === 0) day = 'Today';
  else if (delta === 1) day = 'Tomorrow';
  else if (delta === -1) day = 'Yesterday';
  else if (delta > 1 && delta < 7) day = d.toLocaleDateString(undefined, { weekday: 'long' });
  else {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    day = d.toLocaleDateString(undefined, opts);
  }
  return `${day} · ${time}`;
}

/** Section bucket for grouping upcoming reminders. */
export function dueGroup(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const delta = Math.round((startOfDayD(d) - startOfDayD(now)) / DAY);
  if (delta < 0) return 'Overdue';
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta < 7) return 'This week';
  if (delta < 30) return 'Later';
  return 'Someday';
}

/** Short countdown: "overdue" · "in 40m" · "in 3h" · "in 2d". */
export function dueCountdown(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  if (diff <= 0) return 'overdue';
  if (diff < HOUR) return `in ${Math.max(1, Math.round(diff / MINUTE))}m`;
  if (diff < DAY) return `in ${Math.round(diff / HOUR)}h`;
  return `in ${Math.round(diff / DAY)}d`;
}
