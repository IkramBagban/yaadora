import { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Link, useRouter, type Href } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { useSignIn } from '@clerk/expo/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../src/components/AppText';
import { AuthField } from '../../src/components/AuthField';
import { PressableScale } from '../../src/components/PressableScale';
import { SocialAuthRow } from '../../src/components/SocialAuthRow';
import { clerkErrorMessage } from '../../src/auth/clerkError';
import { enterApp } from '../../src/auth/authFlow';
import { useSocialAuth } from '../../src/auth/useSocialAuth';
import { createMobileLogger } from '../../src/lib/log';
import { fonts, radius, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const log = createMobileLogger('auth:sign-in');

type Step = 'password' | 'second_factor';
type SecondFactorStrategy = 'email_code' | 'phone_code';

export default function SignInScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const social = useSocialAuth();

  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sfStrategy, setSfStrategy] = useState<SecondFactorStrategy>('email_code');
  const [sfHint, setSfHint] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const error = localError ?? social.error;
  const clearError = () => {
    setLocalError(null);
    social.clearError();
  };

  const finish = async (sessionId: string | null | undefined): Promise<boolean> => {
    if (!sessionId) return false;
    if (!setActive) {
      log.error('setActive missing after complete sign-in');
      setLocalError('Auth is not ready. Try again in a moment.');
      return false;
    }
    await setActive({ session: sessionId });
    log.info('session activated, entering app');
    enterApp(router);
    return true;
  };

  /**
   * Kick off the second-factor verification Clerk asks for on a new device
   * (Client Trust) or when MFA is enabled. Sends the code and advances the UI.
   */
  const beginSecondFactor = async (): Promise<void> => {
    if (!signIn) return;
    const factors = signIn.supportedSecondFactors ?? [];
    const emailFactor = factors.find((f) => f.strategy === 'email_code');
    const phoneFactor = factors.find((f) => f.strategy === 'phone_code');
    const strategy: SecondFactorStrategy | null = emailFactor
      ? 'email_code'
      : phoneFactor
        ? 'phone_code'
        : null;

    if (!strategy) {
      setLocalError(
        'This device needs verification, but no email or SMS code option is configured. Check the Clerk dashboard.',
      );
      return;
    }

    await signIn.prepareSecondFactor({ strategy });
    setSfStrategy(strategy);
    setSfHint(
      strategy === 'email_code'
        ? 'For your security, enter the code we emailed you to verify this device.'
        : 'For your security, enter the code we texted you to verify this device.',
    );
    setCode('');
    setStep('second_factor');
  };

  const onSubmitPassword = async () => {
    if (!isLoaded || !signIn) {
      log.warn('sign-in pressed before Clerk ready', { isLoaded, hasSignIn: Boolean(signIn) });
      return;
    }
    clearError();
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setLocalError('Enter your email and password.');
      return;
    }

    setBusy(true);
    log.info('sign-in attempt', { email: trimmed });
    try {
      const result = await signIn.create({ identifier: trimmed, password });
      log.info('sign-in create result', {
        status: result.status,
        hasSession: Boolean(result.createdSessionId),
      });

      if (result.status === 'complete') {
        await finish(result.createdSessionId);
        return;
      }

      if (result.status === 'needs_client_trust' || result.status === 'needs_second_factor') {
        await beginSecondFactor();
        return;
      }

      if (result.status === 'needs_new_password') {
        setLocalError('Your password needs to be reset. Use "Forgot password?" below.');
        return;
      }

      const msg = `Sign-in incomplete (status: ${result.status ?? 'unknown'}).`;
      log.warn(msg);
      setLocalError(msg);
    } catch (err) {
      const message = clerkErrorMessage(err, 'Could not sign in.');
      log.error('sign-in failed', { message, raw: err instanceof Error ? err.message : String(err) });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const onVerifySecondFactor = async () => {
    if (!isLoaded || !signIn) return;
    clearError();
    if (!code.trim()) {
      setLocalError('Enter the verification code.');
      return;
    }

    setBusy(true);
    log.info('verifying second factor', { strategy: sfStrategy, codeLen: code.trim().length });
    try {
      const result = await signIn.attemptSecondFactor({ strategy: sfStrategy, code: code.trim() });
      if (result.status === 'complete') {
        await finish(result.createdSessionId);
        return;
      }
      setLocalError(`Verification incomplete (status: ${result.status ?? 'unknown'}).`);
    } catch (err) {
      const message = clerkErrorMessage(err, 'Invalid verification code.');
      log.error('second factor failed', { message });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const onResendCode = async () => {
    if (!signIn) return;
    clearError();
    setBusy(true);
    try {
      await signIn.prepareSecondFactor({ strategy: sfStrategy });
      log.info('second factor code resent', { strategy: sfStrategy });
    } catch (err) {
      setLocalError(clerkErrorMessage(err, 'Could not resend the code.'));
    } finally {
      setBusy(false);
    }
  };

  const onPrimary = () => {
    if (step === 'password') return void onSubmitPassword();
    return void onVerifySecondFactor();
  };

  const primaryLabel = step === 'password' ? 'Sign in' : 'Verify';
  const socialDisabled = busy;

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
          {step === 'password' ? 'Sign in to your second brain.' : 'Verify this device.'}
        </AppText>

        {step === 'password' ? (
          <>
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
            <AuthField
              label="Password"
              password
              textContentType="password"
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              editable={!busy}
            />
            <View style={styles.forgotRow}>
              <PressableScale
                accessibilityRole="link"
                onPress={() =>
                  router.push(
                    (email.trim()
                      ? { pathname: '/(auth)/reset-password', params: { email: email.trim() } }
                      : '/(auth)/reset-password') as Href,
                  )
                }
                hitSlop={8}
              >
                <AppText variant="caption" tone="accent">
                  Forgot password?
                </AppText>
              </PressableScale>
            </View>
          </>
        ) : (
          <>
            {sfHint ? (
              <AppText variant="caption" tone="ink2" style={styles.hint}>
                {sfHint}
              </AppText>
            ) : null}
            <AuthField
              label={sfStrategy === 'email_code' ? 'Email code' : 'SMS code'}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              editable={!busy}
            />
          </>
        )}

        {error ? (
          <View
            style={[
              styles.errorChip,
              { backgroundColor: colors.danger + '15', borderColor: colors.danger + '30' },
            ]}
          >
            <AppText variant="caption" tone="danger" style={{ flex: 1 }}>
              {error}
            </AppText>
            <PressableScale onPress={clearError} hitSlop={12}>
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

        {step === 'second_factor' ? (
          <PressableScale accessibilityRole="button" onPress={() => void onResendCode()} style={styles.secondary}>
            <AppText variant="caption" tone="accent">
              Resend code
            </AppText>
          </PressableScale>
        ) : null}

        {step === 'password' ? (
          <>
            <SocialAuthRow onSelect={social.signInWith} pending={social.pending} disabled={socialDisabled} />

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
          </>
        ) : null}
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
  hint: {
    marginBottom: space.xs,
  },
  forgotRow: {
    alignItems: 'flex-end',
    marginTop: space.sm,
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
