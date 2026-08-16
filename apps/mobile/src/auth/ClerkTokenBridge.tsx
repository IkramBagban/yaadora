import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { setAuthTokenGetter } from '../api/token';
import { flushOutbox } from '../capture/outbox';
import { createMobileLogger } from '../lib/log';
import { registerPushTokenOnLogin } from '../lib/pushRegistration';
import {
  getBootstrapAuthToken,
  hydrateBootstrapSession,
  isBootstrapSessionActive,
  subscribeBootstrapSession,
} from './bootstrapSession';

const log = createMobileLogger('auth:token');

/**
 * Registers the session token getter for the API layer (Clerk JWT or bootstrap
 * bearer). Must render under `<ClerkProvider>`.
 *
 * Registers during render (not only in useEffect) so child effects that fire
 * on the same frame as sign-in can already read a token.
 */
export function ClerkTokenBridge() {
  const { getToken, isSignedIn, isLoaded, userId } = useAuth();
  const lastSignedIn = useRef<boolean | null>(null);
  const bootstrapActive = isBootstrapSessionActive();
  const effectivelySignedIn = Boolean(isSignedIn) || bootstrapActive;

  // Keep the getter current every render while signed in (Clerk or bootstrap).
  if (isLoaded) {
    setAuthTokenGetter(async () => {
      const boot = getBootstrapAuthToken();
      if (boot) {
        log.debug('getToken: bootstrap bearer');
        return boot;
      }
      if (!isSignedIn) {
        log.debug('getToken: skipped (not signed in)');
        return null;
      }
      try {
        const token = (await getToken()) ?? null;
        log.debug('getToken: result', {
          clerkUserId: userId ?? null,
          token: log.tokenSummary(token),
        });
        return token;
      } catch (err) {
        log.warn('getToken: failed', {
          clerkUserId: userId ?? null,
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    });
  }

  useEffect(() => {
    // Subscribe before hydrate so a sync completion cannot miss the listener.
    const unsub = subscribeBootstrapSession(() => {
      // Force re-register getter when bootstrap toggles.
      setAuthTokenGetter(async () => {
        const boot = getBootstrapAuthToken();
        if (boot) return boot;
        if (!isSignedIn) return null;
        try {
          return (await getToken()) ?? null;
        } catch {
          return null;
        }
      });
    });
    void hydrateBootstrapSession();
    return unsub;
  }, [getToken, isSignedIn]);

  useEffect(() => {
    if (!isLoaded) return;
    if (lastSignedIn.current === effectivelySignedIn) return;
    lastSignedIn.current = effectivelySignedIn;
    log.info('session state changed', {
      isSignedIn: effectivelySignedIn,
      clerkUserId: userId ?? null,
      bootstrap: bootstrapActive,
    });
  }, [isLoaded, effectivelySignedIn, userId, bootstrapActive]);

  useEffect(() => {
    if (effectivelySignedIn) {
      log.info('flushing outbox after sign-in');
      void flushOutbox();
      // Server-initiated push (P2): register device token + request permission.
      // Bootstrap/eval user may not need push; still best-effort.
      void registerPushTokenOnLogin();
    }
  }, [effectivelySignedIn]);

  useEffect(() => {
    return () => setAuthTokenGetter(null);
  }, []);

  return null;
}
