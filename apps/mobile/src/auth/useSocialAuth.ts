import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useSSO } from '@clerk/expo';
import { createMobileLogger } from '../lib/log';
import { clerkErrorMessage } from './clerkError';
import { enterApp } from './authFlow';

const log = createMobileLogger('auth:social');

// Required so the auth browser tab can hand control back to the app on web.
// Harmless on native.
WebBrowser.maybeCompleteAuthSession();

export type SocialStrategy = 'oauth_google' | 'oauth_apple' | 'oauth_x';

/**
 * Warm the in-app browser on native so the OAuth tab opens instantly, and cool
 * it down on unmount. No-op on web.
 */
function useWarmUpBrowser(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

/**
 * Drives Clerk's hosted OAuth flow (Google / Apple / X) via `useSSO`. The same
 * flow both signs in existing users and signs up new ones. On success it
 * activates the session and enters the app; on cancel it resolves quietly.
 */
export function useSocialAuth() {
  useWarmUpBrowser();
  const router = useRouter();
  const { startSSOFlow } = useSSO();
  const [pending, setPending] = useState<SocialStrategy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signInWith = useCallback(
    async (strategy: SocialStrategy) => {
      setError(null);
      setPending(strategy);
      log.info('starting SSO flow', { strategy });
      try {
        const { createdSessionId, setActive } = await startSSOFlow({
          strategy,
          redirectUrl: Linking.createURL('sso-callback'),
        });

        if (createdSessionId && setActive) {
          await setActive({ session: createdSessionId });
          log.info('SSO session activated', { strategy });
          enterApp(router);
          return;
        }

        // No session usually means the user dismissed the browser, or the
        // account needs extra steps (e.g. an unverified email) that Clerk's
        // hosted pages don't finish here.
        log.warn('SSO returned no session', { strategy, createdSessionId });
      } catch (err) {
        const message = clerkErrorMessage(err, 'Could not continue with that provider.');
        log.error('SSO flow failed', {
          strategy,
          message,
          raw: err instanceof Error ? err.message : String(err),
        });
        setError(message);
      } finally {
        setPending(null);
      }
    },
    [router, startSSOFlow],
  );

  return {
    signInWith,
    pending,
    error,
    clearError: useCallback(() => setError(null), []),
  };
}
