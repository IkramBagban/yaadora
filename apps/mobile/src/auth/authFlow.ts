import type { Href, useRouter } from 'expo-router';
import { syncDeviceTimezone } from './syncTimezone';

type AppRouter = ReturnType<typeof useRouter>;

/**
 * Shared "we are now signed in" side effects. Call after `setActive` resolves.
 * Kicks off a best-effort timezone sync and replaces the stack with the tabs so
 * the auth screens can't be swiped back to.
 */
export function enterApp(router: AppRouter): void {
  void syncDeviceTimezone();
  router.replace('/(tabs)' as Href);
}
