import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Reminder, ReminderScope } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { toDateKey } from './dates';
import {
  useCompleteReminder,
  useConfirmSuggestion,
  useDismissReminder,
  useRemindersList,
} from './useReminders';
import { MonthCalendar } from './components/MonthCalendar';
import { ReminderDialog } from './components/ReminderDialog';
import { ReminderTable } from './components/ReminderTable';
import { SuggestedQueue } from './components/SuggestedQueue';
import { ErrorNote } from './components/Feedback';
import { Segmented } from './components/Segmented';

type Tab = ReminderScope;

interface DialogState {
  open: boolean;
  editing: Reminder | null;
}

const TAB_OPTIONS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'all', label: 'All' },
  { value: 'suggested', label: 'Suggested' },
] as const;

export function RemindersPage() {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [dialog, setDialog] = useState<DialogState>({ open: false, editing: null });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // The calendar always plots the full active inventory (pending + suggested).
  const inventory = useRemindersList('all');
  const activeQuery = useRemindersList(tab);

  const complete = useCompleteReminder();
  const confirm = useConfirmSuggestion();
  const dismiss = useDismissReminder();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const items = activeQuery.data?.items ?? [];
  const filtered = selectedDay
    ? items.filter((r) => toDateKey(new Date(r.dueAt)) === selectedDay)
    : items;

  const overdueCount = (inventory.data?.items ?? []).filter(
    (r) => r.status === 'pending' && new Date(r.dueAt) < new Date(),
  ).length;

  async function runRowAction(id: string, action: (id: string) => Promise<unknown>): Promise<void> {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await action(id);
    } catch {
      // surfaced via mutation.error below
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const handlePrimary = (r: Reminder): void =>
    void runRowAction(
      r.id,
      r.status === 'suggested' ? confirm.mutateAsync : complete.mutateAsync,
    );
  const handleDelete = (r: Reminder): void =>
    void runRowAction(r.id, dismiss.mutateAsync);

  const rowError = confirm.error ?? complete.error ?? dismiss.error;
  const clearRowError = (): void => {
    confirm.reset();
    complete.reset();
    dismiss.reset();
  };

  const emptyCopy: Record<Tab, { title: string; hint: string }> = {
    upcoming: { title: 'Nothing scheduled ahead', hint: 'Add a reminder or confirm a suggestion to see it here.' },
    all: { title: 'No active reminders', hint: 'Pending and AI-suggested reminders will appear here.' },
    suggested: { title: 'No suggestions waiting', hint: 'AI-proposed reminders queue up here for your review.' },
  };

  return (
    <section className="flex flex-col gap-xl">
      <header className="flex items-start justify-between gap-md">
        <div>
          <h1 className="text-display font-bold tracking-tight">Reminders</h1>
          <p className="text-sub text-ink2">
            Everything you asked us to keep track of — plus what the AI thinks you shouldn't forget.
          </p>
        </div>
        <Button onClick={() => setDialog({ open: true, editing: null })}>
          <Plus size={16} aria-hidden /> New reminder
        </Button>
      </header>

      <SuggestedQueue />

      {overdueCount > 0 && (
        <div className="flex items-center justify-between gap-md rounded-md border border-danger/30 bg-danger/10 px-lg py-sm">
          <p className="text-caption text-danger">
            <Badge tone="danger">{overdueCount} overdue</Badge>{' '}
            <span className="ml-xs">Pending reminders past their due time sit in “All”.</span>
          </p>
          {tab !== 'all' && (
            <Button variant="ghost" size="sm" onClick={() => setTab('all')}>
              Review
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-md">
        <Segmented ariaLabel="Reminder views" options={TAB_OPTIONS} value={tab} onChange={setTab} />
        {selectedDay && (
          <button
            type="button"
            onClick={() => setSelectedDay(null)}
            className="inline-flex items-center gap-xs rounded-pill bg-accent-soft px-md py-xs text-caption-medium text-accent hover:opacity-90"
          >
            Filtered to a day <X size={12} aria-hidden />
          </button>
        )}
      </div>

      <div className="grid items-start gap-xl lg:grid-cols-[290px_1fr]">
        <MonthCalendar
          reminders={inventory.data?.items ?? []}
          selectedKey={selectedDay}
          onSelectDay={setSelectedDay}
        />

        <Card padded={false} className="p-lg">
          {activeQuery.isPending ? (
            <div className="flex justify-center py-xxl text-ink3">
              <Spinner />
            </div>
          ) : activeQuery.isError ? (
            <div className="flex flex-col items-center gap-md py-xxl">
              <p className="text-caption text-danger">{activeQuery.error.message}</p>
              <Button variant="secondary" size="sm" onClick={() => activeQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <ReminderTable
              items={filtered}
              busyIds={busyIds}
              emptyTitle={emptyCopy[tab].title}
              emptyHint={emptyCopy[tab].hint}
              onPrimary={handlePrimary}
              onEdit={(r) => setDialog({ open: true, editing: r })}
              onDelete={handleDelete}
            />
          )}
        </Card>
      </div>

      {rowError && <ErrorNote message={rowError.message} onDismiss={clearRowError} />}

      <ReminderDialog
        open={dialog.open}
        editing={dialog.editing}
        onClose={() => setDialog({ open: false, editing: null })}
      />
    </section>
  );
}
