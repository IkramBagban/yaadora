import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Reminder } from '../api/types';

/**
 * Local, on-device reminder notifications — no push service, no server, no
 * account, nothing paid. Each pending reminder schedules one or more OS-level
 * local notifications; the OS fires them even if the app is closed.
 *
 * Source of truth is the server's reminder list. `syncScheduled` reconciles the
 * scheduled OS notifications against that list on every load / foreground:
 * schedule the ones that should fire, cancel the ones that shouldn't. A tiny
 * AsyncStorage map (reminderId → osNotificationId[]) lets us cancel precisely.
 *
 * Recurrence: a reminder is 'once' (a single DATE trigger at `dueAt`), 'daily'
 * (a repeating DAILY trigger at `dueAt`'s time-of-day), or 'weekly' (one
 * repeating WEEKLY trigger per selected weekday, all at `dueAt`'s time-of-day).
 * That's why the map value is an array — a weekly reminder owns multiple OS
 * notification ids.
 */

/**
 * `Reminder` as it will look once the shared `recurrence`/`weekdays` contract
 * lands in `api/types.ts` (see docs/superpowers/specs/2026-07-15-reminder-
 * recurrence-design.md). Declared locally with optional fields so this file
 * compiles against the current wire type too, and so the runtime defensively
 * treats an absent `recurrence` as `'once'` (see `resolveRecurrence` below) —
 * that covers older server responses that predate the field.
 */
type Recurrence = 'once' | 'daily' | 'weekly';
type ReminderWithRecurrence = Reminder & {
  recurrence?: Recurrence;
  weekdays?: number[] | null;
};

const MAP_KEY = 'reminders:notif-map:v1';
const CHANNEL_ID = 'reminders';

let handlerReady = false;

/** Show reminders as banners while the app is foregrounded, too. */
function ensureHandler(): void {
  if (handlerReady) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  handlerReady = true;
}

async function readMap(): Promise<Record<string, string[]>> {
  try {
    const raw = await AsyncStorage.getItem(MAP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

async function writeMap(map: Record<string, string[]>): Promise<void> {
  try {
    await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    /* best-effort */
  }
}

/**
 * Ask for notification permission (idempotent). Returns whether it's granted.
 * Also creates the Android channel. Safe to call every time the screen mounts.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    ensureHandler();
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

/** Whether permission is already granted (no prompt). */
export async function hasNotificationPermission(): Promise<boolean> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted;
  } catch {
    return false;
  }
}

function isFuture(iso: string): boolean {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t > Date.now() + 1000;
}

/** Defensive read of `recurrence`: missing/unrecognized → 'once'. */
function resolveRecurrence(reminder: ReminderWithRecurrence): Recurrence {
  const r = reminder.recurrence;
  return r === 'daily' || r === 'weekly' ? r : 'once';
}

/**
 * Map our 0..6 (JS `Date.getDay()`, 0=Sunday) weekday convention to Expo's
 * 1..7 (1=Sunday) convention used by `WeeklyTriggerInput.weekday`.
 */
function toExpoWeekday(jsWeekday: number): number {
  return jsWeekday + 1;
}

/**
 * Schedule the OS notification(s) for one reminder according to its
 * recurrence, returning the created OS notification ids. Never throws.
 */
async function scheduleOne(reminder: ReminderWithRecurrence): Promise<string[]> {
  const recurrence = resolveRecurrence(reminder);
  const due = new Date(reminder.dueAt);
  const hour = due.getHours();
  const minute = due.getMinutes();

  const content = {
    title: 'Reminder',
    body: reminder.text,
    sound: 'default' as const,
    data: { reminderId: reminder.id },
  };

  if (recurrence === 'once') {
    if (!isFuture(reminder.dueAt)) return [];
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: due,
          channelId: CHANNEL_ID,
        },
      });
      return [id];
    } catch {
      return [];
    }
  }

  if (recurrence === 'daily') {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          channelId: CHANNEL_ID,
        },
      });
      return [id];
    } catch {
      return [];
    }
  }

  // recurrence === 'weekly'
  const weekdays = reminder.weekdays;
  if (!weekdays || weekdays.length === 0) {
    // No weekdays selected — nothing safe to schedule on a recurring basis.
    // Rather than guess a day, schedule nothing; the reminder simply won't
    // fire until the server-side data is corrected.
    return [];
  }

  const ids: string[] = [];
  for (const jsWeekday of weekdays) {
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: toExpoWeekday(jsWeekday),
          hour,
          minute,
          channelId: CHANNEL_ID,
        },
      });
      ids.push(id);
    } catch {
      /* skip this weekday, keep the rest */
    }
  }
  return ids;
}

async function cancelOne(osId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(osId);
  } catch {
    /* already fired or gone */
  }
}

async function cancelMany(osIds: string[]): Promise<void> {
  for (const osId of osIds) {
    await cancelOne(osId);
  }
}

/**
 * Reconcile scheduled OS notifications with the given reminders. Only pending
 * reminders (future for 'once'; any pending 'daily'/'weekly') should be
 * scheduled; everything else is cancelled. Returns the number of reminders
 * currently scheduled. Never throws.
 */
export async function syncScheduled(reminders: Reminder[]): Promise<number> {
  try {
    ensureHandler();
    const granted = await hasNotificationPermission();
    if (!granted) return 0;

    const map = await readMap();
    const want = new Map(
      (reminders as ReminderWithRecurrence[])
        .filter((r) => {
          if (r.status !== 'pending') return false;
          // 'once' reminders in the past are done; daily/weekly are always
          // eligible since they recur regardless of dueAt's date.
          return resolveRecurrence(r) === 'once' ? isFuture(r.dueAt) : true;
        })
        .map((r) => [r.id, r] as const),
    );

    // Cancel notifications that are no longer wanted.
    for (const [reminderId, osIds] of Object.entries(map)) {
      if (!want.has(reminderId)) {
        await cancelMany(osIds);
        delete map[reminderId];
      }
    }

    // Schedule any wanted reminder that isn't scheduled yet.
    for (const [reminderId, reminder] of want) {
      if (map[reminderId]?.length) continue;
      const osIds = await scheduleOne(reminder);
      if (osIds.length) map[reminderId] = osIds;
    }

    await writeMap(map);
    return Object.keys(map).length;
  } catch {
    return 0;
  }
}

/**
 * Schedule ONE reminder (e.g. right after confirming a live chip) without
 * touching any others. Idempotent per reminder id. Never throws.
 */
export async function scheduleReminder(reminder: Reminder): Promise<void> {
  try {
    const r = reminder as ReminderWithRecurrence;
    const recurrence = resolveRecurrence(r);
    if (recurrence === 'once' && !isFuture(r.dueAt)) return;
    const granted = await hasNotificationPermission();
    if (!granted) return;
    const map = await readMap();
    if (map[r.id]?.length) return;
    const osIds = await scheduleOne(r);
    if (osIds.length) {
      map[r.id] = osIds;
      await writeMap(map);
    }
  } catch {
    /* best-effort */
  }
}

/** Cancel a single reminder's notification(s) immediately (e.g. on complete/cancel). */
export async function cancelScheduled(reminderId: string): Promise<void> {
  const map = await readMap();
  const osIds = map[reminderId];
  if (osIds?.length) {
    await cancelMany(osIds);
    delete map[reminderId];
    await writeMap(map);
  }
}
