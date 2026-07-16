import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { setAuthTokenGetter } from '../api/token';
import { flushOutbox } from '../capture/outbox';
import { createMobileLogger } from '../lib/log';
import { registerPushTokenOnLogin } from '../lib/pushRegistration';

const log = createMobileLogger('auth:token');

/**
 * Registers Clerk's session token getter for the API layer.
 * Must render under `<ClerkProvider>`.
 *
 * Registers during render (not only in useEffect) so child effects that fire
 * on the same frame as sign-in can already read a token.
 */
export function ClerkTokenBridge() {
  const { getToken, isSignedIn, isLoaded, userId } = useAuth();
  const lastSignedIn = useRef<boolean | null>(null);

  // Keep the getter current every render while signed in.
  if (isLoaded) {
    setAuthTokenGetter(async () => {
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
    if (!isLoaded) return;
    if (lastSignedIn.current === isSignedIn) return;
    lastSignedIn.current = isSignedIn;
    log.info('session state changed', {
      isSignedIn,
      clerkUserId: userId ?? null,
    });
  }, [isLoaded, isSignedIn, userId]);

  useEffect(() => {
    if (isSignedIn) {
      log.info('flushing outbox after sign-in');
      void flushOutbox();
      // Server-initiated push (P2): register device token + request permission.
      void registerPushTokenOnLogin();
    }
  }, [isSignedIn]);

  useEffect(() => {
    return () => setAuthTokenGetter(null);
  }, []);

  return null;
}
