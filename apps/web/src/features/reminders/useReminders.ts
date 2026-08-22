import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReminderScope } from '../../api/types';
import { createReminder, completeReminder, confirmSuggested, deleteReminder, listReminders, updateReminder, type ReminderWrite } from './api';

/** Query-key factory — every reminders query lives under the `['reminders']` prefix. */
export const remindersKeys = {
  all: ['reminders'] as const,
  list: (scope: ReminderScope) => ['reminders', 'list', scope] as const,
};

/** GET /reminders for one scope (upcoming | all | suggested). */
export function useRemindersList(scope: ReminderScope) {
  return useQuery({
    queryKey: remindersKeys.list(scope),
    queryFn: () => listReminders(scope),
  });
}

function useInvalidateReminders() {
  const qc = useQueryClient();
  // Any write changes several scopes at once (all ⊃ pending/suggested), so
  // invalidate the whole prefix and let active queries refetch.
  return () => qc.invalidateQueries({ queryKey: remindersKeys.all });
}

export function useCreateReminder() {
  const invalidate = useInvalidateReminders();
  return useMutation({
    mutationFn: (input: ReminderWrite) => createReminder(input),
    onSettled: invalidate,
  });
}

interface UpdateArgs {
  id: string;
  patch: Partial<ReminderWrite>;
}

export function useUpdateReminder() {
  const invalidate = useInvalidateReminders();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateArgs) => updateReminder(id, patch),
    onSettled: invalidate,
  });
}

export function useCompleteReminder() {
  const invalidate = useInvalidateReminders();
  return useMutation({
    mutationFn: (id: string) => completeReminder(id),
    onSettled: invalidate,
  });
}

/** DELETE /reminders/:id — the server's soft-dismiss. */
export function useDismissReminder() {
  const invalidate = useInvalidateReminders();
  return useMutation({
    mutationFn: (id: string) => deleteReminder(id),
    onSettled: invalidate,
  });
}

/** POST /reminders/:id/confirm — accept one AI suggestion. */
export function useConfirmSuggestion() {
  const invalidate = useInvalidateReminders();
  return useMutation({
    mutationFn: (id: string) => confirmSuggested(id),
    onSettled: invalidate,
  });
}
