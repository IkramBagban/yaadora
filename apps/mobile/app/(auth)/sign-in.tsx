import { useState } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Link, useRouter, type Href } from 'expo-router';
import { useSignIn } from '@clerk/expo/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../src/components/AppText';
import { PressableScale } from '../../src/components/PressableScale';
import { syncDeviceTimezone } from '../../src/auth/syncTimezone';
import { createMobileLogger } from '../../src/lib/log';
import { fonts, radius, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const log = createMobileLogger('auth:sign-in');

function clerkErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as {
      errors?: Array<{ longMessage?: string; message?: string; code?: string }>;
      message?: string;
    };
    const first = e.errors?.[0];
    if (first?.longMessage) return first.longMessage;
    if (first?.message) return first.message;
    if (e.message) return e.message;
  }
  return fallback;
}

export default function SignInScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!isLoaded || !signIn) {
      log.warn('sign-in pressed before Clerk ready', { isLoaded, hasSignIn: Boolean(signIn) });
      return;
    }
    setLocalError(null);
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setLocalError('Enter your email and password.');
      return;
    }

    setBusy(true);
    log.info('sign-in attempt', { email: trimmed });
    try {
      const result = await signIn.create({
        identifier: trimmed,
        password,
      });

      log.info('sign-in create result', {
        status: result.status,
        hasSession: Boolean(result.createdSessionId),
        sessionIdPrefix: result.createdSessionId?.slice(0, 12) ?? null,
      });

      if (result.status === 'complete' && result.createdSessionId) {
        if (!setActive) {
          log.error('setActive missing after complete sign-in');
          setLocalError('Auth is not ready. Try again in a moment.');
          return;
        }
        await setActive({ session: result.createdSessionId });
        log.info('session activated, syncing timezone + navigating to tabs');
        void syncDeviceTimezone();
        router.replace('/(tabs)' as Href);
        return;
      }

      const msg = `Sign-in incomplete (status: ${result.status ?? 'unknown'}). Check Clerk dashboard settings.`;
      log.warn(msg);
      setLocalError(msg);
    } catch (err) {
      const message = clerkErrorMessage(err, 'Could not sign in.');
      log.error('sign-in failed', {
        message,
        raw: err instanceof Error ? err.message : String(err),
      });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <AppText variant="display" style={styles.brand}>
          Yaadora
        </AppText>
        <AppText variant="body" tone="ink2" style={styles.subtitle}>
          Sign in to your second brain.
        </AppText>

        <AppText variant="captionMedium" tone="ink2" style={styles.label}>
          Email
        </AppText>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.ink,
              backgroundColor: colors.surface,
              borderColor: colors.hairline,
            },
          ]}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.ink3}
          editable={!busy}
        />

        <AppText variant="captionMedium" tone="ink2" style={styles.label}>
          Password
        </AppText>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.ink,
              backgroundColor: colors.surface,
              borderColor: colors.hairline,
            },
          ]}
          secureTextEntry
          textContentType="password"
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          placeholderTextColor={colors.ink3}
          editable={!busy}
        />

        {localError ? (
          <AppText variant="caption" tone="danger" style={styles.error}>
            {localError}
          </AppText>
        ) : null}

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          onPress={() => void onSubmit()}
          disabled={busy || !isLoaded}
          style={[
            styles.button,
            { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <AppText variant="captionMedium" style={{ color: colors.onAccent }}>
              Sign in
            </AppText>
          )}
        </PressableScale>

        <View style={styles.footer}>
          <AppText variant="caption" tone="ink2">
            No account yet?{' '}
          </AppText>
          <Link href={'/(auth)/sign-up' as Href} asChild>
            <PressableScale accessibilityRole="link">
              <AppText variant="caption" tone="accent">
                Sign up
              </AppText>
            </PressableScale>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  brand: {
    fontFamily: fonts.serif,
    marginBottom: space.xs,
  },
  subtitle: {
    marginBottom: space.lg,
  },
  label: {
    marginTop: space.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    fontSize: 16,
    fontFamily: fonts.sans,
  },
  error: {
    marginTop: space.xs,
  },
  button: {
    marginTop: space.lg,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.lg,
    justifyContent: 'center',
  },
});
