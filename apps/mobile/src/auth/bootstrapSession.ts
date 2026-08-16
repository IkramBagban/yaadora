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

/** Don't let a hung SecureStore block the whole app boot forever. */
const SECURE_STORE_TIMEOUT_MS = 2500;

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
/** In-flight hydrate so concurrent callers share one pass. */
let hydratePromise: Promise<void> | null = null;

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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

/**
 * Load any persisted bootstrap session. Always marks hydrated (even when
 * bootstrap is disabled or SecureStore fails) so the auth gate cannot hang.
 *
 * Safe to call multiple times; concurrent calls share one in-flight promise.
 */
export async function hydrateBootstrapSession(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      if (!isBootstrapLoginEnabled()) {
        activeEmail = null;
        log.warn('bootstrap hydrate skipped (disabled on this build)');
        return;
      }
      const raw = await withTimeout(
        SecureStore.getItemAsync(STORAGE_KEY),
        SECURE_STORE_TIMEOUT_MS,
        'SecureStore.getItemAsync',
      );
      if (!raw) {
        activeEmail = null;
        return;
      }
      const parsed = JSON.parse(raw) as { email?: string };
      const email = parsed.email?.trim().toLowerCase() ?? '';
      if (email && isSeedUserEmail(email)) {
        activeEmail = email;
        log.warn('bootstrap session restored', { email });
      } else {
        activeEmail = null;
        await withTimeout(
          SecureStore.deleteItemAsync(STORAGE_KEY),
          SECURE_STORE_TIMEOUT_MS,
          'SecureStore.deleteItemAsync',
        ).catch(() => {});
      }
    } catch (err) {
      log.warn('bootstrap hydrate failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      activeEmail = null;
    } finally {
      hydrated = true;
      hydratePromise = null;
      emit();
    }
  })();

  return hydratePromise;
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
    await withTimeout(
      SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ email })),
      SECURE_STORE_TIMEOUT_MS,
      'SecureStore.setItemAsync',
    );
  } catch (err) {
    log.warn('bootstrap persist failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  log.warn('bootstrap session activated', { email });
  emit();
  return { ok: true };
}

export async function clearBootstrapSession(): Promise<void> {
  activeEmail = null;
  try {
    await withTimeout(
      SecureStore.deleteItemAsync(STORAGE_KEY),
      SECURE_STORE_TIMEOUT_MS,
      'SecureStore.deleteItemAsync',
    );
  } catch {
    /* ignore */
  }
  hydrated = true;
  log.warn('bootstrap session cleared');
  emit();
}
