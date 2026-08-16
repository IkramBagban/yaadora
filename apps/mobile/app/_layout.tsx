import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import {
  InstrumentSans_400Regular,
  InstrumentSans_400Regular_Italic,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
  useFonts,
} from '@expo-google-fonts/instrument-sans';
import { startSyncEngine } from '../src/capture/sync';
import { ClerkTokenBridge } from '../src/auth/ClerkTokenBridge';
import { useAppSession } from '../src/auth/useAppSession';
import {
  API_URL,
  API_URL_FROM_ENV,
  CLERK_KEY_FROM_ENV,
  CLERK_PUBLISHABLE_KEY,
  clerkKeyPrefix,
  getBootConfigSummary,
} from '../src/api/config';
import { createMobileLogger } from '../src/lib/log';
import { useTheme } from '../src/theme/useTheme';
import { AppText } from '../src/components/AppText';

const log = createMobileLogger('auth:gate');

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Keep the Stack mounted always. Redirect via router after load so auth
 * screens can render (unmounting the navigator breaks Expo Router).
 */
function AuthRedirect() {
  const { isLoaded, isSignedIn, userId, isBootstrap } = useAppSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) {
      log.debug('auth gate waiting for session to load');
      return;
    }
    const root = segments[0] as string | undefined;
    const inAuthGroup = root === '(auth)';

    log.info('auth gate evaluate', {
      isSignedIn,
      isBootstrap,
      clerkUserId: userId ?? null,
      segmentRoot: root ?? null,
      inAuthGroup,
      apiUrl: API_URL,
      publishableKeySet: Boolean(CLERK_PUBLISHABLE_KEY),
      publishableKeyPrefix: clerkKeyPrefix(),
    });

    if (!isSignedIn && !inAuthGroup) {
      log.info('redirect → sign-in', { from: root ?? '(none)', apiUrl: API_URL });
      router.replace('/(auth)/sign-in' as Href);
    } else if (isSignedIn && inAuthGroup) {
      log.info('redirect → tabs', {
        clerkUserId: userId ?? null,
        isBootstrap,
        apiUrl: API_URL,
      });
      router.replace('/(tabs)' as Href);
    }
  }, [isLoaded, isSignedIn, isBootstrap, segments, router, userId]);

  return null;
}

/**
 * Full-screen boot spinner (sienna/chocolate accent). Shows while Clerk and/or
 * bootstrap SecureStore hydrate. On-device text so a production APK can reveal
 * the baked-in API URL without Metro.
 */
function BootLoadingScreen(props: {
  clerkLoaded: boolean;
  sessionLoaded: boolean;
}) {
  const { colors } = useTheme();
  const { clerkLoaded, sessionLoaded } = props;
  const [stuckMs, setStuckMs] = useState(0);
  const started = useRef(Date.now());

  useEffect(() => {
    // warn so production logcat always includes it (prod logger threshold = warn).
    log.warn('boot spinner showing', {
      clerkLoaded,
      sessionLoaded,
      ...getBootConfigSummary(),
    });
  }, [clerkLoaded, sessionLoaded]);

  useEffect(() => {
    const id = setInterval(() => {
      const ms = Date.now() - started.current;
      setStuckMs(ms);
      if (ms > 0 && ms % 5000 < 1100) {
        log.warn('still waiting on boot', {
          ms,
          clerkLoaded,
          sessionLoaded,
          waitingOn: !clerkLoaded
            ? 'clerk'
            : !sessionLoaded
              ? 'session/bootstrap'
              : 'none',
          apiUrl: API_URL,
          clerkKeyPrefix: clerkKeyPrefix(),
        });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [clerkLoaded, sessionLoaded]);

  const waiting: string[] = [];
  if (!clerkLoaded) waiting.push('Clerk');
  if (!sessionLoaded) waiting.push('session');

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.bg,
        paddingHorizontal: 28,
      }}
    >
      <ActivityIndicator color={colors.accent} size="large" />
      <AppText
        variant="caption"
        tone="ink2"
        style={{ marginTop: 16, textAlign: 'center' }}
      >
        Waiting for {waiting.length ? waiting.join(' + ') : 'app'}…
      </AppText>
      <AppText
        variant="caption"
        tone="ink3"
        style={{ marginTop: 12, textAlign: 'center' }}
        selectable
      >
        API: {API_URL}
      </AppText>
      <AppText
        variant="caption"
        tone="ink3"
        style={{ marginTop: 4, textAlign: 'center' }}
      >
        API from env: {API_URL_FROM_ENV ? 'yes' : 'no (default)'} · Clerk from
        env: {CLERK_KEY_FROM_ENV ? 'yes' : 'no (default)'}
      </AppText>
      <AppText
        variant="caption"
        tone="ink3"
        style={{ marginTop: 4, textAlign: 'center' }}
      >
        Clerk: {clerkKeyPrefix()}
      </AppText>
      {stuckMs >= 8000 ? (
        <AppText
          variant="caption"
          tone="ink2"
          style={{ marginTop: 16, textAlign: 'center' }}
        >
          Still loading after {Math.floor(stuckMs / 1000)}s.
          {!clerkLoaded
            ? ' Clerk is not finishing — check network / publishable key / device logs.'
            : ' Session hydrate is stuck — check SecureStore / device logs.'}
        </AppText>
      ) : null}
    </View>
  );
}

function RootNavigator() {
  // Clerk must finish loading even for bootstrap; useAppSession waits on both.
  const { isLoaded: clerkLoaded } = useAuth();
  const { isLoaded } = useAppSession();
  const { colors, dark } = useTheme();

  if (!clerkLoaded || !isLoaded) {
    return (
      <BootLoadingScreen clerkLoaded={clerkLoaded} sessionLoaded={isLoaded} />
    );
  }

  return (
    <>
      <ClerkTokenBridge />
      <AuthRedirect />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="timeline"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="memory/[id]"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="profile"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="rules"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="entities"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="entity/[id]"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
      </Stack>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  const { colors } = useTheme();
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_400Regular_Italic,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });

  useEffect(() => {
    startSyncEngine();
  }, []);

  useEffect(() => {
    if (fontsLoaded) {
      log.warn('fonts loaded — hiding splash', getBootConfigSummary());
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    // Native splash still up; log once-ish via module load already covers API URL.
    return null;
  }

  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.bg,
          padding: 24,
        }}
      >
        <AppText tone="danger">Missing Clerk Publishable Key</AppText>
        <AppText variant="caption" tone="ink3" style={{ textAlign: 'center', marginTop: 8 }}>
          The app was built without EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY.
        </AppText>
        <AppText variant="caption" tone="ink3" style={{ textAlign: 'center', marginTop: 8 }}>
          API: {API_URL}
        </AppText>
      </View>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <RootNavigator />
      </GestureHandlerRootView>
    </ClerkProvider>
  );
}
