import { useEffect, useState } from 'react';
import type { Reminder, Recurrence } from '../../../api/types';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '../dates';
import {
  RECURRENCE_OPTIONS,
  WEEKDAY_OPTIONS,
  occurrencePreview,
} from '../model';
import { useCreateReminder, useUpdateReminder } from '../useReminders';
import { ErrorNote } from './Feedback';
import { Segmented } from './Segmented';

export interface ReminderDialogProps {
  open: boolean;
  /** Present → edit mode; null → create mode. */
  editing: Reminder | null;
  onClose: () => void;
}

/** Default due moment for new reminders: tomorrow at 09:00 local. */
function defaultDueValue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toDatetimeLocalValue(d);
}

export function ReminderDialog({ open, editing, onClose }: ReminderDialogProps) {
  const create = useCreateReminder();
  const update = useUpdateReminder();

  const [text, setText] = useState('');
  const [due, setDue] = useState(defaultDueValue);
  const [recurrence, setRecurrence] = useState<Recurrence>('once');
  const [weekdays, setWeekdays] = useState<number[]>([]);

  // Re-seed the form each time the dialog opens (create or edit).
  useEffect(() => {
    if (!open) return;
    setText(editing?.text ?? '');
    setDue(editing ? toDatetimeLocalValue(editing.dueAt) : defaultDueValue());
    setRecurrence(editing?.recurrence ?? 'once');
    setWeekdays([...(editing?.weekdays ?? [])].sort((a, b) => a - b));
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  if (!open) return null;

  const dueIso = fromDatetimeLocalValue(due);
  const textOk = text.trim().length > 0;
  const weekdaysOk = recurrence !== 'weekly' || weekdays.length > 0;
  const busy = create.isPending || update.isPending;
  const canSave = textOk && dueIso !== null && weekdaysOk && !busy;

  const mutationError = create.error ?? update.error;

  const toggleWeekday = (day: number): void =>
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );

  async function save(): Promise<void> {
    if (!canSave || dueIso === null) return;
    const payload = {
      text: text.trim(),
      dueAt: dueIso,
      recurrence,
      ...(recurrence === 'weekly' ? { weekdays: [...weekdays].sort((a, b) => a - b) } : {}),
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, patch: payload });
      else await create.mutateAsync(payload);
      onClose();
    } catch {
      // Error surfaces via mutation.error / <ErrorNote />.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-lg"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Edit reminder' : 'New reminder'}
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-xl border border-hairline bg-surface p-xl shadow-xl">
        <h2 className="text-title font-semibold">
          {editing ? 'Edit reminder' : 'New reminder'}
        </h2>

        <form
          className="mt-lg flex flex-col gap-md"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="flex flex-col gap-xs text-caption-medium text-ink2">
            What should you remember to do?
            <Input value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="Call the dentist…" />
          </label>

          <div className="grid grid-cols-2 gap-md">
            <label className="flex flex-col gap-xs text-caption-medium text-ink2">
              Due
              <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <div className="flex flex-col gap-xs text-caption-medium text-ink2">
              Repeats
              <Segmented
                ariaLabel="Recurrence"
                options={RECURRENCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={recurrence}
                onChange={setRecurrence}
              />
            </div>
          </div>

          {recurrence === 'weekly' && (
            <fieldset className="flex flex-col gap-xs">
              <legend className="text-caption-medium text-ink2">On days</legend>
              <div className="flex gap-xs" role="group" aria-label="Weekdays">
                {WEEKDAY_OPTIONS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    aria-pressed={weekdays.includes(w.value)}
                    title={w.short}
                    onClick={() => toggleWeekday(w.value)}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-sm border text-caption-medium transition-colors ${
                      weekdays.includes(w.value)
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-hairline bg-surface text-ink2 hover:bg-surface-alt'
                    }`}
                  >
                    {w.letter}
                  </button>
                ))}
              </div>
              {!weekdaysOk && (
                <p className="text-caption text-danger">Pick at least one day.</p>
              )}
            </fieldset>
          )}

          {dueIso !== null && (
            <p className="rounded-md bg-surface-alt px-md py-xs text-caption text-ink2">
              {occurrencePreview(recurrence, new Date(dueIso), weekdays)}
            </p>
          )}

          {!textOk && (
            <p className="text-caption text-danger">Give the reminder a short description.</p>
          )}
          {mutationError && (
            <ErrorNote message={mutationError.message} onDismiss={() => (editing ? update.reset() : create.reset())} />
          )}

          <div className="mt-sm flex justify-end gap-sm">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSave}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add reminder'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
