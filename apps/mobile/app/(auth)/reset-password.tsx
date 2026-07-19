import { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useSignIn } from '@clerk/expo/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../src/components/AppText';
import { AuthField } from '../../src/components/AuthField';
import { PressableScale } from '../../src/components/PressableScale';
import { clerkErrorMessage } from '../../src/auth/clerkError';
import { enterApp } from '../../src/auth/authFlow';
import { createMobileLogger } from '../../src/lib/log';
import { fonts, radius, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const log = createMobileLogger('auth:reset-password');

type Step = 'request' | 'reset';

export default function ResetPasswordScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { isLoaded, signIn, setActive } = useSignIn();

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onRequest = async () => {
    if (!isLoaded || !signIn) return;
    setLocalError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setLocalError('Enter your email.');
      return;
    }

    setBusy(true);
    log.info('reset password requested', { email: trimmed });
    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier: trimmed });
      setCode('');
      setPassword('');
      setStep('reset');
    } catch (err) {
      const message = clerkErrorMessage(err, 'Could not send a reset code.');
      log.error('reset request failed', { message });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (!isLoaded || !signIn) return;
    setLocalError(null);
    if (!code.trim()) {
      setLocalError('Enter the code from your email.');
      return;
    }
    if (password.length < 8) {
      setLocalError('New password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    log.info('attempting password reset');
    try {
      const attempt = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: code.trim(),
      });

      if (attempt.status !== 'needs_new_password' && attempt.status !== 'complete') {
        setLocalError(`Reset incomplete (status: ${attempt.status ?? 'unknown'}).`);
        return;
      }

      const result =
        attempt.status === 'needs_new_password'
          ? await signIn.resetPassword({ password })
          : attempt;

      if (result.status === 'complete' && result.createdSessionId) {
        if (!setActive) {
          setLocalError('Auth is not ready. Try again in a moment.');
          return;
        }
        await setActive({ session: result.createdSessionId });
        log.info('password reset complete, entering app');
        enterApp(router);
        return;
      }

      setLocalError(`Reset incomplete (status: ${result.status ?? 'unknown'}).`);
    } catch (err) {
      const message = clerkErrorMessage(err, 'Could not reset your password.');
      log.error('reset failed', { message });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel = step === 'request' ? 'Send reset code' : 'Reset password';
  const onPrimary = () => (step === 'request' ? void onRequest() : void onReset());

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
        <View style={styles.topBar}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            hitSlop={12}
          >
            <Feather name="chevron-left" size={24} color={colors.ink2} />
          </PressableScale>
        </View>

        <AppText variant="display" style={styles.brand}>
          Reset password
        </AppText>
        <AppText variant="body" tone="ink2" style={styles.subtitle}>
          {step === 'request'
            ? 'Enter your email and we’ll send you a code.'
            : 'Enter the code and choose a new password.'}
        </AppText>

        {step === 'request' ? (
          <AuthField
            label="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            editable={!busy}
          />
        ) : (
          <>
            <AuthField
              label="Email code"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              editable={!busy}
            />
            <AuthField
              label="New password"
              password
              textContentType="newPassword"
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              editable={!busy}
            />
          </>
        )}

        {localError ? (
          <View
            style={[
              styles.errorChip,
              { backgroundColor: colors.danger + '15', borderColor: colors.danger + '30' },
            ]}
          >
            <AppText variant="caption" tone="danger" style={{ flex: 1 }}>
              {localError}
            </AppText>
            <PressableScale onPress={() => setLocalError(null)} hitSlop={12}>
              <Feather name="x" size={16} color={colors.danger} />
            </PressableScale>
          </View>
        ) : null}

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          onPress={onPrimary}
          disabled={busy || !isLoaded}
          style={[styles.button, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <AppText variant="captionMedium" style={{ color: colors.onAccent }}>
              {primaryLabel}
            </AppText>
          )}
        </PressableScale>

        {step === 'reset' ? (
          <PressableScale accessibilityRole="button" onPress={() => void onRequest()} style={styles.secondary}>
            <AppText variant="caption" tone="accent">
              Resend code
            </AppText>
          </PressableScale>
        ) : (
          <View style={styles.footer}>
            <PressableScale
              accessibilityRole="link"
              onPress={() => router.replace('/(auth)/sign-in' as Href)}
            >
              <AppText variant="caption" tone="accent">
                Back to sign in
              </AppText>
            </PressableScale>
          </View>
        )}
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
  topBar: {
    marginBottom: space.sm,
    marginLeft: -space.xs,
  },
  brand: {
    fontFamily: fonts.sansSemibold,
    marginBottom: space.xs,
  },
  subtitle: {
    marginBottom: space.lg,
  },
  errorChip: {
    marginTop: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  button: {
    marginTop: space.lg,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  secondary: {
    marginTop: space.md,
    alignItems: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.lg,
    justifyContent: 'center',
  },
});
