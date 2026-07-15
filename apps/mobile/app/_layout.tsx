import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from '@expo-google-fonts/inter';
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from '@expo-google-fonts/instrument-serif';
import { startSyncEngine } from '../src/capture/sync';
import { ClerkTokenBridge } from '../src/auth/ClerkTokenBridge';
import { CLERK_PUBLISHABLE_KEY } from '../src/api/config';
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
  const { isLoaded, isSignedIn, userId } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) {
      log.debug('auth gate waiting for Clerk to load');
      return;
    }
    const root = segments[0] as string | undefined;
    const inAuthGroup = root === '(auth)';

    log.debug('auth gate evaluate', {
      isSignedIn,
      clerkUserId: userId ?? null,
      segmentRoot: root ?? null,
      inAuthGroup,
      publishableKeySet: Boolean(CLERK_PUBLISHABLE_KEY),
      publishableKeyLen: CLERK_PUBLISHABLE_KEY.length,
    });

    if (!isSignedIn && !inAuthGroup) {
      log.info('redirect → sign-in', { from: root ?? '(none)' });
      router.replace('/(auth)/sign-in' as Href);
    } else if (isSignedIn && inAuthGroup) {
      log.info('redirect → tabs', { clerkUserId: userId ?? null });
      router.replace('/(tabs)' as Href);
    }
  }, [isLoaded, isSignedIn, segments, router, userId]);

  return null;
}

function RootNavigator() {
  const { isLoaded } = useAuth();
  const { colors, dark } = useTheme();

  if (!isLoaded) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
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
      </Stack>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </>
  );
}

export default function RootLayout() {
  const { colors } = useTheme();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  useEffect(() => {
    startSyncEngine();
  }, []);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

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
