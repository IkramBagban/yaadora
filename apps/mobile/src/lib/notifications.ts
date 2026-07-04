import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Reminder } from '../api/types';

/**
 * Local, on-device reminder notifications — no push service, no server, no
 * account, nothing paid. Each pending reminder schedules an OS-level local
 * notification at its due time; the OS fires it even if the app is closed.
 *
 * Source of truth is the server's reminder list. `syncScheduled` reconciles the
 * scheduled OS notifications against that list on every load / foreground:
 * schedule the ones that should fire, cancel the ones that shouldn't. A tiny
 * AsyncStorage map (reminderId → osNotificationId) lets us cancel precisely.
 */

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

async function readMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(MAP_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function writeMap(map: Record<string, string>): Promise<void> {
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

async function scheduleOne(reminder: Reminder): Promise<string | null> {
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Reminder',
        body: reminder.text,
        sound: 'default',
        data: { reminderId: reminder.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.dueAt),
        channelId: CHANNEL_ID,
      },
    });
  } catch {
    return null;
  }
}

async function cancelOne(osId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(osId);
  } catch {
    /* already fired or gone */
  }
}

/**
 * Reconcile scheduled OS notifications with the given reminders. Only pending,
 * future reminders should be scheduled; everything else is cancelled. Returns
 * the number currently scheduled. Never throws.
 */
export async function syncScheduled(reminders: Reminder[]): Promise<number> {
  try {
    ensureHandler();
    const granted = await hasNotificationPermission();
    if (!granted) return 0;

    const map = await readMap();
    const want = new Map(
      reminders
        .filter((r) => r.status === 'pending' && isFuture(r.dueAt))
        .map((r) => [r.id, r]),
    );

    // Cancel notifications that are no longer wanted.
    for (const [reminderId, osId] of Object.entries(map)) {
      if (!want.has(reminderId)) {
        await cancelOne(osId);
        delete map[reminderId];
      }
    }

    // Schedule any wanted reminder that isn't scheduled yet.
    for (const [reminderId, reminder] of want) {
      if (map[reminderId]) continue;
      const osId = await scheduleOne(reminder);
      if (osId) map[reminderId] = osId;
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
    if (!isFuture(reminder.dueAt)) return;
    const granted = await hasNotificationPermission();
    if (!granted) return;
    const map = await readMap();
    if (map[reminder.id]) return;
    const osId = await scheduleOne(reminder);
    if (osId) {
      map[reminder.id] = osId;
      await writeMap(map);
    }
  } catch {
    /* best-effort */
  }
}

/** Cancel a single reminder's notification immediately (e.g. on complete/cancel). */
export async function cancelScheduled(reminderId: string): Promise<void> {
  const map = await readMap();
  const osId = map[reminderId];
  if (osId) {
    await cancelOne(osId);
    delete map[reminderId];
    await writeMap(map);
  }
}
