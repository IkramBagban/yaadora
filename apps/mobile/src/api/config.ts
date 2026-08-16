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

/** Raw env as inlined at build time (empty string ≠ unset — Expo may bake ""). */
const RAW_API_URL = process.env.EXPO_PUBLIC_API_URL;
const RAW_CLERK_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

const DEFAULT_API_URL = 'https://api.yaadora.querywise.tech';
const DEFAULT_CLERK_KEY =
  'pk_test_d2lyZWQtb3dsLTk3LmNsZXJrLmFjY291bnRzLmRldiQ';

export const API_URL = resolveApiUrl(
  (RAW_API_URL && RAW_API_URL.trim()) || DEFAULT_API_URL,
);

export const CLERK_PUBLISHABLE_KEY =
  (RAW_CLERK_KEY && RAW_CLERK_KEY.trim()) || DEFAULT_CLERK_KEY;

/** True when API_URL came from EXPO_PUBLIC_API_URL (non-empty), not the default. */
export const API_URL_FROM_ENV = Boolean(RAW_API_URL && RAW_API_URL.trim());

/** True when Clerk key came from env (non-empty), not the default. */
export const CLERK_KEY_FROM_ENV = Boolean(RAW_CLERK_KEY && RAW_CLERK_KEY.trim());

/** Safe prefix for logs/UI — never the full secret key. */
export function clerkKeyPrefix(key: string = CLERK_PUBLISHABLE_KEY): string {
  if (!key) return '<missing>';
  if (key.length <= 12) return `<key len=${key.length}>`;
  return `${key.slice(0, 12)}… (len=${key.length})`;
}

/** Snapshot of build-time config for boot diagnostics (no secrets). */
export function getBootConfigSummary(): Record<string, unknown> {
  return {
    apiUrl: API_URL,
    apiUrlFromEnv: API_URL_FROM_ENV,
    rawApiUrlEmpty: RAW_API_URL === '',
    rawApiUrlUnset: RAW_API_URL == null,
    clerkKeyPrefix: clerkKeyPrefix(),
    clerkKeyFromEnv: CLERK_KEY_FROM_ENV,
    platform: Platform.OS,
    dev: typeof __DEV__ !== 'undefined' ? __DEV__ : null,
  };
}

// Always emit once at module load so production APKs show this in logcat
// (adb logcat | grep yaadora-boot) even when the spinner never clears.
// eslint-disable-next-line no-console
console.warn(
  `[yaadora-boot] config ${JSON.stringify(getBootConfigSummary())}`,
);

/** Must match server AUTH_BOOTSTRAP_TOKEN when using seed-user mobile login. */
export const AUTH_BOOTSTRAP_TOKEN = (
  process.env.EXPO_PUBLIC_AUTH_BOOTSTRAP_TOKEN ?? ''
).trim();

export const SEED_USER_EMAIL = (
  process.env.EXPO_PUBLIC_SEED_USER_EMAIL ?? 'owner@yaadora.local'
)
  .trim()
  .toLowerCase();
