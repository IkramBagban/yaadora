import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import type { Reminder } from '../../../api/types';
import { dueLabel } from '../dates';
import { useConfirmSuggestion, useDismissReminder, useRemindersList } from '../useReminders';
import { ErrorNote, SectionHeader } from './Feedback';

/**
 * Queue of AI-proposed reminders awaiting review (status = 'suggested').
 * Bulk confirm promotes rows to pending; bulk dismiss soft-deletes them.
 * Renders nothing while loading or when the queue is empty.
 */
export function SuggestedQueue() {
  const query = useRemindersList('suggested');
  const confirm = useConfirmSuggestion();
  const dismiss = useDismissReminder();

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const items = query.data?.items ?? [];
  const busy = confirm.isPending || dismiss.isPending;

  if (query.isLoading || items.length === 0) return null;

  const allSelected = selected.size === items.length;

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (): void =>
    setSelected(allSelected ? new Set() : new Set(items.map((r) => r.id)));

  async function runAll(action: (id: string) => Promise<unknown>): Promise<void> {
    setActionError(null);
    const results = await Promise.allSettled([...selected].map((id) => action(id)));
    setSelected(new Set());
    const failure = results.find((r) => r.status === 'rejected');
    if (failure && failure.status === 'rejected') {
      setActionError(
        failure.reason instanceof Error ? failure.reason.message : 'Something went wrong.',
      );
    }
  }

  const confirmSelected = (): void => {
    void runAll((id) => confirm.mutateAsync(id));
  };
  const dismissSelected = (): void => {
    void runAll((id) => dismiss.mutateAsync(id));
  };

  return (
    <Card>
      <SectionHeader
        title={
          <span className="flex items-center gap-sm">
            Suggested by AI <Badge tone="accent">{items.length} to review</Badge>
          </span>
        }
      >
        <label className="flex cursor-pointer items-center gap-xs text-caption text-ink2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={busy}
            aria-label="Select all suggestions"
            className="h-4 w-4 accent-[color:var(--c-accent)]"
          />
          Select all
        </label>
      </SectionHeader>

      <ul className="mt-md divide-y divide-hairline">
        {items.map((r) => (
          <SuggestionRow
            key={r.id}
            reminder={r}
            checked={selected.has(r.id)}
            onToggle={() => toggle(r.id)}
          />
        ))}
      </ul>

      {actionError && (
        <div className="mt-md">
          <ErrorNote message={actionError} onDismiss={() => setActionError(null)} />
        </div>
      )}

      <div className="mt-lg flex justify-end gap-sm">
        <Button variant="secondary" size="sm" disabled={selected.size === 0 || busy} onClick={dismissSelected}>
          <X size={14} aria-hidden /> Dismiss ({selected.size})
        </Button>
        <Button size="sm" disabled={selected.size === 0 || busy} onClick={confirmSelected}>
          <Check size={14} aria-hidden /> Confirm ({selected.size})
        </Button>
      </div>
    </Card>
  );
}

function SuggestionRow({
  reminder,
  checked,
  onToggle,
}: {
  reminder: Reminder;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-md py-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select "${reminder.text}"`}
          className="h-4 w-4 shrink-0 accent-[color:var(--c-accent)]"
        />
        <span className="min-w-0 flex-1 truncate text-body">{reminder.text}</span>
        <span className="shrink-0 text-caption text-ink3">{dueLabel(reminder.dueAt)}</span>
      </label>
    </li>
  );
}
