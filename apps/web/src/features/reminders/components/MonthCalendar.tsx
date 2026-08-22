import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Reminder } from '../../../api/types';
import {
  WEEKDAY_INITIALS,
  addMonths,
  isSameDay,
  monthCells,
  monthTitle,
  toDateKey,
} from '../dates';
import { isOverdue } from '../model';
import { Card } from '../../../components/ui/Card';

export interface MonthCalendarProps {
  /** Active inventory (pending + suggested) — dots only reflect actionable rows. */
  reminders: Reminder[];
  /** Local `YYYY-MM-DD` key of the filtered day, or null. */
  selectedKey: string | null;
  /** Clicking a day selects it; clicking it again clears the filter. */
  onSelectDay: (key: string | null) => void;
}

/** Dot color mirrors the status badge tones used in the table. */
function dotTone(r: Reminder): string {
  if (isOverdue(r)) return 'bg-danger';
  if (r.status === 'suggested') return 'bg-accent';
  return 'bg-pending';
}

export function MonthCalendar({ reminders, selectedKey, onSelectDay }: MonthCalendarProps) {
  const [anchor, setAnchor] = useState(() => new Date());

  const byDay = useMemo(() => {
    const map = new Map<string, Reminder[]>();
    for (const r of reminders) {
      const key = toDateKey(new Date(r.dueAt));
      const list = map.get(key);
      if (list) list.push(r);
      else map.set(key, [r]);
    }
    return map;
  }, [reminders]);

  const cells = useMemo(() => monthCells(anchor), [anchor]);
  const today = new Date();

  return (
    <Card padded={false} className="p-md">
      <div className="mb-sm flex items-center justify-between">
        <p className="text-caption-medium text-ink">{monthTitle(anchor)}</p>
        <div className="flex items-center gap-xs">
          <NavButton label="Previous month" onClick={() => setAnchor(addMonths(anchor, -1))}>
            <ChevronLeft size={14} />
          </NavButton>
          <button
            type="button"
            onClick={() => setAnchor(new Date())}
            className="rounded-pill px-xs py-xs text-micro uppercase text-ink3 hover:bg-surface-alt hover:text-ink"
          >
            Today
          </button>
          <NavButton label="Next month" onClick={() => setAnchor(addMonths(anchor, 1))}>
            <ChevronRight size={14} />
          </NavButton>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-xs" role="grid" aria-label={monthTitle(anchor)}>
        {WEEKDAY_INITIALS.map((w) => (
          <div key={w} className="pb-xs text-center text-micro uppercase text-ink3">
            {w}
          </div>
        ))}
        {cells.map((cell) => {
          const dayItems = byDay.get(cell.key) ?? [];
          const selected = cell.key === selectedKey;
          const isToday = isSameDay(cell.date, today);
          return (
            <button
              key={cell.key}
              type="button"
              disabled={!cell.inMonth}
              onClick={() => onSelectDay(selected ? null : cell.key)}
              aria-pressed={selected}
              aria-label={`${cell.date.toDateString()}${dayItems.length ? `, ${dayItems.length} reminder(s)` : ''}`}
              className={`flex h-11 flex-col items-center justify-start rounded-md px-xs pt-xs transition-colors ${
                cell.inMonth ? 'hover:bg-surface-alt' : 'opacity-35'
              } ${selected ? 'bg-accent-soft ring-1 ring-accent' : ''}`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-caption ${
                  isToday && !selected ? 'bg-accent-soft font-medium text-accent' : 'text-ink2'
                } ${selected ? 'bg-accent font-medium text-on-accent' : ''}`}
              >
                {cell.date.getDate()}
              </span>
              <span className="mt-xs flex min-h-xs items-center justify-center gap-[2px]">
                {dayItems.slice(0, 3).map((r) => (
                  <span key={r.id} className={`h-1 w-1 rounded-full ${dotTone(r)}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-sm flex items-center justify-center gap-md border-t border-hairline pt-sm text-micro text-ink3">
        <LegendDot className="bg-danger" label="overdue" />
        <LegendDot className="bg-accent" label="suggested" />
        <LegendDot className="bg-pending" label="upcoming" />
      </div>
    </Card>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink2 transition-colors hover:bg-surface-alt hover:text-ink"
    >
      {children}
    </button>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}
