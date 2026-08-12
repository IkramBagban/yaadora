/**
 * Dev/eval bootstrap session — sign in as the seed user without Clerk.
 *
 * When enabled, mobile accepts SEED_USER_EMAIL + any non-empty password and
 * authenticates API calls with EXPO_PUBLIC_AUTH_BOOTSTRAP_TOKEN (must match
 * server AUTH_BOOTSTRAP_TOKEN with AUTH_ALLOW_BOOTSTRAP=true).
 *
 * Never enable EXPO_PUBLIC_ALLOW_BOOTSTRAP_LOGIN on production builds.
 */

import * as SecureStore from 'expo-secure-store';
import { createMobileLogger } from '../lib/log';

const log = createMobileLogger('auth:bootstrap');

const STORAGE_KEY = 'yaadora.bootstrapSession.v1';

const SEED_EMAIL = (
  process.env.EXPO_PUBLIC_SEED_USER_EMAIL ?? 'owner@yaadora.local'
)
  .trim()
  .toLowerCase();

const BOOTSTRAP_TOKEN = (process.env.EXPO_PUBLIC_AUTH_BOOTSTRAP_TOKEN ?? '').trim();

/** __DEV__ always allows the path when a token is configured; prod needs an explicit flag. */
export function isBootstrapLoginEnabled(): boolean {
  if (!BOOTSTRAP_TOKEN) return false;
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  return process.env.EXPO_PUBLIC_ALLOW_BOOTSTRAP_LOGIN === '1';
}

export function getSeedUserEmail(): string {
  return SEED_EMAIL;
}

export function isSeedUserEmail(email: string): boolean {
  return email.trim().toLowerCase() === SEED_EMAIL;
}

type Listener = () => void;
const listeners = new Set<Listener>();

let hydrated = false;
let activeEmail: string | null = null;

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeBootstrapSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isBootstrapHydrated(): boolean {
  return hydrated;
}

export function isBootstrapSessionActive(): boolean {
  return Boolean(activeEmail && BOOTSTRAP_TOKEN && isBootstrapLoginEnabled());
}

export function getBootstrapSessionEmail(): string | null {
  return isBootstrapSessionActive() ? activeEmail : null;
}

/** Bearer token for API when bootstrap session is active. */
export function getBootstrapAuthToken(): string | null {
  if (!isBootstrapSessionActive()) return null;
  return BOOTSTRAP_TOKEN || null;
}

export async function hydrateBootstrapSession(): Promise<void> {
  if (hydrated) return;
  try {
    if (!isBootstrapLoginEnabled()) {
      activeEmail = null;
      return;
    }
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) {
      activeEmail = null;
      return;
    }
    const parsed = JSON.parse(raw) as { email?: string };
    const email = parsed.email?.trim().toLowerCase() ?? '';
    if (email && isSeedUserEmail(email)) {
      activeEmail = email;
      log.info('bootstrap session restored', { email });
    } else {
      activeEmail = null;
      await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
    }
  } catch (err) {
    log.warn('bootstrap hydrate failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    activeEmail = null;
  } finally {
    hydrated = true;
    emit();
  }
}

/**
 * Activate bootstrap session for the seed email. Password must be non-empty
 * (any value) — there is no real password check; server trusts the bearer.
 */
export async function activateBootstrapSession(params: {
  email: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isBootstrapLoginEnabled()) {
    return {
      ok: false,
      error: 'Bootstrap login is not enabled on this build.',
    };
  }
  if (!BOOTSTRAP_TOKEN) {
    return {
      ok: false,
      error: 'Missing EXPO_PUBLIC_AUTH_BOOTSTRAP_TOKEN (must match server AUTH_BOOTSTRAP_TOKEN).',
    };
  }
  const email = params.email.trim().toLowerCase();
  if (!isSeedUserEmail(email)) {
    return { ok: false, error: 'Not the seed/eval account.' };
  }
  if (!params.password) {
    return { ok: false, error: 'Enter any password to continue.' };
  }

  activeEmail = email;
  hydrated = true;
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ email }));
  } catch (err) {
    log.warn('bootstrap persist failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  log.info('bootstrap session activated', { email });
  emit();
  return { ok: true };
}

export async function clearBootstrapSession(): Promise<void> {
  activeEmail = null;
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  hydrated = true;
  log.info('bootstrap session cleared');
  emit();
}
