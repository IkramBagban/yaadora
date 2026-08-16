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

function readBootState() {
  return {
    hydrated: isBootstrapHydrated(),
    active: isBootstrapSessionActive(),
    email: getBootstrapSessionEmail(),
  };
}

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
  const [boot, setBoot] = useState(readBootState);

  useEffect(() => {
    // Subscribe FIRST so a synchronous hydrate completion cannot miss emit().
    // (When bootstrap is disabled, hydrate finishes without awaiting SecureStore
    // and used to emit before any listener was registered → spinner forever.)
    const unsub = subscribeBootstrapSession(() => {
      setBoot(readBootState());
    });

    log.warn('hydrating bootstrap session', {
      clerkLoaded,
      clerkSignedIn: Boolean(clerkSignedIn),
      alreadyHydrated: isBootstrapHydrated(),
    });

    void hydrateBootstrapSession()
      .catch((err) => {
        log.warn('hydrateBootstrapSession rejected', {
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        // Always sync React state from module state — covers emit races and
        // early-return when already hydrated.
        setBoot(readBootState());
        log.warn('bootstrap hydrate finished', readBootState());
      });

    return unsub;
    // Run once on mount. Re-running on clerkLoaded caused subscribe/emit races.
  }, []);

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
