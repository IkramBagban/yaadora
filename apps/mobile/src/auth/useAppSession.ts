/**
 * App session = Clerk session OR local bootstrap (seed user) session.
 * Use this instead of raw `useAuth().isSignedIn` for routing and API readiness.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuth, useClerk } from '@clerk/expo';
import {
  clearBootstrapSession,
  getBootstrapAuthToken,
  getBootstrapSessionEmail,
  hydrateBootstrapSession,
  isBootstrapHydrated,
  isBootstrapSessionActive,
  subscribeBootstrapSession,
} from './bootstrapSession';
import { createMobileLogger } from '../lib/log';

const log = createMobileLogger('auth:session');

export function useAppSession(): {
  isLoaded: boolean;
  isSignedIn: boolean;
  /** Clerk user id, or null when on bootstrap session. */
  userId: string | null;
  /** True when using seed/eval bootstrap (not Clerk). */
  isBootstrap: boolean;
  bootstrapEmail: string | null;
  signOut: () => Promise<void>;
} {
  const { isLoaded: clerkLoaded, isSignedIn: clerkSignedIn, userId } = useAuth();
  const { signOut: clerkSignOut } = useClerk();
  const [boot, setBoot] = useState(() => ({
    hydrated: isBootstrapHydrated(),
    active: isBootstrapSessionActive(),
    email: getBootstrapSessionEmail(),
  }));

  useEffect(() => {
    // warn: visible in production logcat without EXPO_PUBLIC_DEBUG_AUTH.
    log.warn('hydrating bootstrap session', {
      clerkLoaded,
      clerkSignedIn: Boolean(clerkSignedIn),
    });
    void hydrateBootstrapSession().then(() => {
      log.warn('bootstrap hydrate finished', {
        hydrated: isBootstrapHydrated(),
        active: isBootstrapSessionActive(),
      });
    });
    return subscribeBootstrapSession(() => {
      setBoot({
        hydrated: isBootstrapHydrated(),
        active: isBootstrapSessionActive(),
        email: getBootstrapSessionEmail(),
      });
    });
  }, [clerkLoaded, clerkSignedIn]);

  const isBootstrap = boot.active && Boolean(getBootstrapAuthToken());
  const isSignedIn = Boolean(clerkSignedIn) || isBootstrap;
  const isLoaded = clerkLoaded && boot.hydrated;

  useEffect(() => {
    log.warn('session load state', {
      clerkLoaded,
      bootstrapHydrated: boot.hydrated,
      isLoaded,
      isSignedIn,
      isBootstrap,
    });
  }, [clerkLoaded, boot.hydrated, isLoaded, isSignedIn, isBootstrap]);

  const signOut = useCallback(async () => {
    log.info('sign out', { wasBootstrap: isBootstrap, wasClerk: Boolean(clerkSignedIn) });
    await clearBootstrapSession();
    if (clerkSignedIn) {
      await clerkSignOut();
    }
  }, [clerkSignOut, clerkSignedIn, isBootstrap]);

  return {
    isLoaded,
    isSignedIn,
    userId: isBootstrap ? null : (userId ?? null),
    isBootstrap,
    bootstrapEmail: isBootstrap ? boot.email : null,
    signOut,
  };
}
