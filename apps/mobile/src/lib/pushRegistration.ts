import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '../api/client';
import { createMobileLogger } from './log';
import { ensureNotificationPermission } from './notifications';

const log = createMobileLogger('push');
const DEVICE_ID_KEY = 'push:device-id:v1';

/**
 * Register the device's Expo push token with the server on login
 * (spec 02 §6, P2). Requests notification permission first. Best-effort —
 * never throws into the auth path.
 */
export async function registerPushTokenOnLogin(): Promise<void> {
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) {
      log.info('notification permission not granted; skip push registration');
      return;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

    const tokenRes = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const expoToken = tokenRes.data;
    if (!expoToken) return;

    const deviceId = await getOrCreateDeviceId();
    await api.registerPushToken({ deviceId, expoToken });
    log.info('push token registered', {
      deviceId: deviceId.slice(0, 8),
      platform: Platform.OS,
    });
  } catch (err) {
    log.warn('push registration failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
  } catch {
    /* continue */
  }
  const id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    /* ephemeral for this session */
  }
  return id;
}
