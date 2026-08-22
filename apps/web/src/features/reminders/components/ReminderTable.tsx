import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Pencil, Trash2 } from 'lucide-react';
import type { Reminder } from '../../../api/types';
import { Badge } from '../../../components/ui/Badge';
import { dueLabel } from '../dates';
import { isOverdue, recurrenceSummary, sortReminders, statusTone, type SortDir, type SortKey } from '../model';
import { EmptyState } from './Feedback';

export interface ReminderTableProps {
  items: Reminder[];
  /** Rows with an in-flight mutation render disabled controls. */
  busyIds: ReadonlySet<string>;
  emptyTitle: string;
  emptyHint?: string;
  /** Complete for pending rows; confirm (promote) for AI-suggested rows. */
  onPrimary: (reminder: Reminder) => void;
  onEdit: (reminder: Reminder) => void;
  onDelete: (reminder: Reminder) => void;
}

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'dueAt', label: 'Due' },
  { key: 'status', label: 'Status' },
  { key: 'recurrence', label: 'Recurrence' },
] as const;

function SortHeader({
  label,
  columnKey,
  active,
  dir,
  onToggle,
}: {
  label: string;
  columnKey: SortKey;
  active: boolean;
  dir: SortDir;
  onToggle: (key: SortKey) => void;
}) {
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onToggle(columnKey)}
      className={`inline-flex items-center gap-xs rounded-sm px-xs py-xs text-micro uppercase tracking-wide transition-colors hover:text-accent ${
        active ? 'text-accent' : 'text-ink3'
      }`}
    >
      {label}
      <Icon size={12} aria-hidden />
    </button>
  );
}

export function ReminderTable({
  items,
  busyIds,
  emptyTitle,
  emptyHint,
  onPrimary,
  onEdit,
  onDelete,
}: ReminderTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'dueAt', dir: 'asc' });

  const sorted = useMemo(
    () => sortReminders(items, sort.key, sort.dir),
    [items, sort.key, sort.dir],
  );

  const toggleSort = (key: SortKey): void =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );

  if (items.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sub">
        <thead>
          <tr className="border-b border-hairline text-ink3">
            <th scope="col" className="py-sm pr-md font-medium">Reminder</th>
            {COLUMNS.map((col) => (
              <th key={col.key} scope="col" className="px-md py-sm font-medium">
                <SortHeader
                  label={col.label}
                  columnKey={col.key}
                  active={sort.key === col.key}
                  dir={sort.dir}
                  onToggle={toggleSort}
                />
              </th>
            ))}
            <th scope="col" className="py-sm pl-md text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const overdue = isOverdue(r);
            const busy = busyIds.has(r.id);
            const isSuggested = r.status === 'suggested';
            return (
              <tr
                key={r.id}
                className="border-b border-hairline/60 align-middle last:border-b-0 hover:bg-surface-alt/50"
              >
                <td className="max-w-[22rem] py-sm pr-md">
                  <p className={overdue ? 'font-medium text-danger' : 'font-medium'}>{r.text}</p>
                  {(isSuggested || overdue) && (
                    <div className="mt-xs flex gap-xs">
                      {isSuggested && <Badge tone="accent">AI suggested</Badge>}
                      {overdue && <Badge tone="danger">overdue</Badge>}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-md py-sm">
                  <span className={overdue ? 'text-danger' : 'text-ink2'}>{dueLabel(r.dueAt)}</span>
                </td>
                <td className="px-md py-sm">
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </td>
                <td className="whitespace-nowrap px-md py-sm text-ink2">
                  {recurrenceSummary(r.recurrence, r.weekdays)}
                </td>
                <td className="py-sm pl-md">
                  <div className="flex items-center justify-end gap-xs">
                    <IconAction
                      label={isSuggested ? 'Confirm suggestion' : 'Mark complete'}
                      onClick={() => onPrimary(r)}
                      disabled={busy}
                    >
                      <Check size={15} />
                    </IconAction>
                    <IconAction label="Edit" onClick={() => onEdit(r)} disabled={busy}>
                      <Pencil size={14} />
                    </IconAction>
                    <IconAction label="Dismiss" onClick={() => onDelete(r)} disabled={busy}>
                      <Trash2 size={14} />
                    </IconAction>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink3 transition-colors hover:bg-accent-soft hover:text-accent disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
