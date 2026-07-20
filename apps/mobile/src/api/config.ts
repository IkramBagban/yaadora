import { Platform } from 'react-native';

/**
 * Resolve the API base URL for the current runtime.
 *
 * On the Android emulator, `localhost` / `127.0.0.1` point at the emulator
 * itself — not your Mac. Map them to `10.0.2.2` (the host loopback alias).
 * iOS Simulator can use localhost as-is. Physical devices still need your
 * machine's LAN IP in EXPO_PUBLIC_API_URL.
 */
function resolveApiUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  if (
    Platform.OS === 'android' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(trimmed)
  ) {
    return trimmed.replace(/:\/\/(localhost|127\.0\.0\.1)/i, '://10.0.2.2');
  }
  return trimmed;
}

export const API_URL = resolveApiUrl(
  process.env.EXPO_PUBLIC_API_URL ?? 'https://api.yaadora.querywise.tech',
);

export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? 'pk_test_d2lyZWQtb3dsLTk3LmNsZXJrLmFjY291bnRzLmRldiQ';
