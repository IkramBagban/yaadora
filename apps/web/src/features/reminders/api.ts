import { request } from '../../api/client';
import type { Reminder, ReminderList, ReminderScope, Recurrence } from '../../api/types';

/**
 * Thin typed wrappers over the existing reminder endpoints
 * (apps/server/src/routes/reminders.ts). No new server surface required.
 */

/** Body shared by POST /reminders/confirm (create) and PATCH /reminders/:id. */
export interface ReminderWrite {
  text: string;
  /** ISO 8601 datetime. For daily/weekly its clock time is the fire time. */
  dueAt: string;
  recurrence: Recurrence;
  /** Required (non-empty) iff recurrence === 'weekly'. 0(Sun)..6(Sat). */
  weekdays?: number[];
}

/** Minimal ack returned by complete/delete endpoints. */
export interface ReminderAck {
  id: string;
  status: string;
}

const MAX_LIMIT = 100;

/** GET /reminders?scope=&limit= */
export function listReminders(scope: ReminderScope): Promise<ReminderList> {
  return request<ReminderList>(`/reminders?scope=${scope}&limit=${MAX_LIMIT}`);
}

/**
 * POST /reminders/confirm — create a manual reminder. The server rejects
 * `weekdays` unless recurrence is 'weekly', so only send it there.
 */
export function createReminder(input: ReminderWrite): Promise<Reminder> {
  return request<Reminder>('/reminders/confirm', {
    method: 'POST',
    body: JSON.stringify({
      text: input.text,
      dueAt: input.dueAt,
      origin: 'manual',
      recurrence: input.recurrence,
      ...(input.recurrence === 'weekly' ? { weekdays: input.weekdays ?? [] } : {}),
    }),
  });
}

/** POST /reminders/:id/confirm — promote an AI suggestion to pending. */
export function confirmSuggested(id: string): Promise<Reminder> {
  return request<Reminder>(`/reminders/${id}/confirm`, { method: 'POST' });
}

/** PATCH /reminders/:id — edit text/schedule/status. */
export function updateReminder(id: string, patch: Partial<ReminderWrite>): Promise<Reminder> {
  return request<Reminder>(`/reminders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...patch,
      ...(patch.recurrence === 'weekly' ? { weekdays: patch.weekdays ?? [] } : {}),
    }),
  });
}

/** POST /reminders/:id/complete — mark done. */
export function completeReminder(id: string): Promise<ReminderAck> {
  return request<ReminderAck>(`/reminders/${id}/complete`, { method: 'POST' });
}

/** DELETE /reminders/:id — soft-dismiss (server never hard-deletes). */
export function deleteReminder(id: string): Promise<ReminderAck> {
  return request<ReminderAck>(`/reminders/${id}`, { method: 'DELETE' });
}
