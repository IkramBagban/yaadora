/**
 * Date/time helpers for the reminders feature. All formatting is in the
 * user's local timezone; wire payloads are always ISO 8601 UTC strings.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const WEEKDAY_INITIALS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** Local `YYYY-MM-DD` key used to group reminders per calendar day. */
export function toDateKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/** "Aug 22" or "Aug 22, 2027" when the year differs from today's. */
export function formatDateShort(iso: string | Date): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "09:05" style clock time in the user's locale. */
export function formatTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Tue, Aug 25 at 9:00 AM" — used by the occurrence preview. */
export function formatDateTime(iso: string | Date): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} at ${formatTime(d)}`;
}

/**
 * Due label with relative flavor: "Overdue · Aug 20", "Today 3:00 PM",
 * "Tomorrow 9:00 AM", otherwise "Fri, Aug 28".
 */
export function dueLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(d) - startOf(now)) / 86_400_000);

  if (dayDiff < 0) return `Overdue · ${formatDateShort(d)}`;
  if (dayDiff === 0) return `Today ${formatTime(d)}`;
  if (dayDiff === 1) return `Tomorrow ${formatTime(d)}`;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// <input type="datetime-local"> conversions
// ---------------------------------------------------------------------------

/** ISO wire value → local "YYYY-MM-DDTHH:mm" for an editable input. */
export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Editable input value → ISO wire value; null when missing/invalid. */
export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Month grid (Sunday-first, fixed 6 rows so the layout never jumps)
// ---------------------------------------------------------------------------

export interface CalendarCell {
  key: string;
  date: Date;
  inMonth: boolean;
}

export function addMonths(anchor: Date, delta: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
}

/** "August 2026" */
export function monthTitle(anchor: Date): string {
  return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b);
}

export function monthCells(anchor: Date): CalendarCell[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { key: toDateKey(date), date, inMonth: date.getMonth() === anchor.getMonth() };
  });
}
