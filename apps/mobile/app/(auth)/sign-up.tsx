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
import Feather from '@expo/vector-icons/Feather';
import { useSignUp } from '@clerk/expo/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../src/components/AppText';
import { PressableScale } from '../../src/components/PressableScale';
import { syncDeviceTimezone } from '../../src/auth/syncTimezone';
import { createMobileLogger } from '../../src/lib/log';
import { fonts, radius, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const log = createMobileLogger('auth:sign-up');

type Step = 'credentials' | 'email_code' | 'phone' | 'phone_code';

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

/** Normalize to E.164-ish: digits with leading +. */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/[\s()-]/g, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  return `+${trimmed.replace(/\D/g, '')}`;
}

export default function SignUpScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded, signUp, setActive } = useSignUp();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activateAndGo = async (sessionId: string | null | undefined) => {
    if (!sessionId) {
      log.error('no session after verification');
      setLocalError('No session was created. Check Clerk settings.');
      return;
    }
    if (!setActive) {
      log.error('setActive missing after verification');
      setLocalError('Auth is not ready. Try again in a moment.');
      return;
    }
    log.info('activating session after sign-up', {
      sessionIdPrefix: sessionId.slice(0, 12),
    });
    await setActive({ session: sessionId });
    void syncDeviceTimezone();
    router.replace('/(tabs)' as Href);
  };

  /**
   * After any sign-up mutation, either finish or advance to the next required step.
   */
  const advanceFromStatus = async () => {
    if (!signUp) return;

    log.info('advanceFromStatus', {
      status: signUp.status,
      missingFields: signUp.missingFields,
      unverifiedFields: signUp.unverifiedFields,
      hasSession: Boolean(signUp.createdSessionId),
    });

    if (signUp.status === 'complete') {
      await activateAndGo(signUp.createdSessionId);
      return;
    }

    const missing = signUp.missingFields ?? [];
    const unverified = signUp.unverifiedFields ?? [];

    if (unverified.includes('email_address')) {
      setStep('email_code');
      setCode('');
      return;
    }

    if (missing.includes('phone_number')) {
      setStep('phone');
      setLocalError(null);
      return;
    }

    if (unverified.includes('phone_number')) {
      setStep('phone_code');
      setCode('');
      return;
    }

    const msg = `Sign-up incomplete (status: ${signUp.status ?? 'unknown'}). Missing: ${
      missing.join(', ') || unverified.join(', ') || 'unknown'
    }. In Clerk Dashboard, turn off unused required fields (e.g. phone).`;
    log.warn(msg);
    setLocalError(msg);
  };

  const onRegister = async () => {
    if (!isLoaded || !signUp) {
      log.warn('sign-up pressed before Clerk ready', { isLoaded, hasSignUp: Boolean(signUp) });
      return;
    }
    setLocalError(null);
    const trimmed = email.trim();
    if (!trimmed || !password) {
      setLocalError('Enter an email and password.');
      return;
    }
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    log.info('sign-up attempt', { email: trimmed });
    try {
      const created = await signUp.create({
        emailAddress: trimmed,
        password,
      });
      log.info('sign-up create result', {
        status: created.status,
        missingFields: created.missingFields,
        unverifiedFields: created.unverifiedFields,
      });

      if (created.status === 'complete') {
        await activateAndGo(created.createdSessionId);
        return;
      }

      // Prefer email verification first when Clerk asks for it.
      if ((created.unverifiedFields ?? []).includes('email_address')) {
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        log.info('verification email requested (email_code)');
        setStep('email_code');
        setCode('');
        return;
      }

      await advanceFromStatus();
    } catch (err) {
      const message = clerkErrorMessage(err, 'Could not create account.');
      log.error('sign-up failed', {
        message,
        raw: err instanceof Error ? err.message : String(err),
      });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const onVerifyEmail = async () => {
    if (!isLoaded || !signUp) return;
    setLocalError(null);
    if (!code.trim()) {
      setLocalError('Enter the verification code from your email.');
      return;
    }

    setBusy(true);
    log.info('verifying email code', { codeLen: code.trim().length });
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: code.trim(),
      });

      log.info('email verify result', {
        status: result.status,
        hasSession: Boolean(result.createdSessionId),
        missingFields: result.missingFields,
        unverifiedFields: result.unverifiedFields,
      });

      if (result.status === 'complete') {
        await activateAndGo(result.createdSessionId);
        return;
      }

      // Email ok, but Clerk still needs phone (common dashboard default).
      await advanceFromStatus();
    } catch (err) {
      const message = clerkErrorMessage(err, 'Invalid verification code.');
      log.error('email verify failed', {
        message,
        raw: err instanceof Error ? err.message : String(err),
      });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const onSubmitPhone = async () => {
    if (!isLoaded || !signUp) return;
    setLocalError(null);
    const e164 = normalizePhone(phone);
    if (e164.length < 8) {
      setLocalError('Enter a phone number with country code (e.g. +9198…).');
      return;
    }

    setBusy(true);
    log.info('submitting phone number', { phoneLen: e164.length });
    try {
      const updated = await signUp.update({ phoneNumber: e164 });
      log.info('phone update result', {
        status: updated.status,
        missingFields: updated.missingFields,
        unverifiedFields: updated.unverifiedFields,
      });

      if (updated.status === 'complete') {
        await activateAndGo(updated.createdSessionId);
        return;
      }

      if ((updated.unverifiedFields ?? []).includes('phone_number')) {
        await signUp.preparePhoneNumberVerification({ strategy: 'phone_code' });
        log.info('phone verification SMS requested');
        setStep('phone_code');
        setCode('');
        return;
      }

      await advanceFromStatus();
    } catch (err) {
      const message = clerkErrorMessage(err, 'Could not save phone number.');
      log.error('phone update failed', {
        message,
        raw: err instanceof Error ? err.message : String(err),
      });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const onVerifyPhone = async () => {
    if (!isLoaded || !signUp) return;
    setLocalError(null);
    if (!code.trim()) {
      setLocalError('Enter the SMS verification code.');
      return;
    }

    setBusy(true);
    log.info('verifying phone code', { codeLen: code.trim().length });
    try {
      const result = await signUp.attemptPhoneNumberVerification({
        code: code.trim(),
      });
      log.info('phone verify result', {
        status: result.status,
        hasSession: Boolean(result.createdSessionId),
        missingFields: result.missingFields,
      });

      if (result.status === 'complete') {
        await activateAndGo(result.createdSessionId);
        return;
      }

      await advanceFromStatus();
    } catch (err) {
      const message = clerkErrorMessage(err, 'Invalid SMS code.');
      log.error('phone verify failed', { message });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const onResendEmail = async () => {
    if (!signUp) return;
    setLocalError(null);
    setBusy(true);
    log.info('resend email verification code');
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      log.info('verification email re-sent');
    } catch (err) {
      const message = clerkErrorMessage(err, 'Could not resend code.');
      log.error('resend email failed', { message });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const onResendPhone = async () => {
    if (!signUp) return;
    setLocalError(null);
    setBusy(true);
    log.info('resend phone verification code');
    try {
      await signUp.preparePhoneNumberVerification({ strategy: 'phone_code' });
      log.info('phone SMS re-sent');
    } catch (err) {
      const message = clerkErrorMessage(err, 'Could not resend SMS.');
      log.error('resend phone failed', { message });
      setLocalError(message);
    } finally {
      setBusy(false);
    }
  };

  const subtitle =
    step === 'credentials'
      ? 'Create an account to start capturing memories.'
      : step === 'email_code'
        ? 'Enter the code we emailed you.'
        : step === 'phone'
          ? 'Your Clerk app requires a phone number to finish sign-up.'
          : 'Enter the code we texted you.';

  const primaryLabel =
    step === 'credentials'
      ? 'Create account'
      : step === 'email_code'
        ? 'Verify email'
        : step === 'phone'
          ? 'Continue'
          : 'Verify phone';

  const onPrimary = () => {
    if (step === 'credentials') return void onRegister();
    if (step === 'email_code') return void onVerifyEmail();
    if (step === 'phone') return void onSubmitPhone();
    return void onVerifyPhone();
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
          {subtitle}
        </AppText>

        {step === 'credentials' ? (
          <>
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
              textContentType="newPassword"
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              placeholderTextColor={colors.ink3}
              editable={!busy}
            />
          </>
        ) : null}

        {step === 'email_code' || step === 'phone_code' ? (
          <>
            <AppText variant="captionMedium" tone="ink2" style={styles.label}>
              {step === 'email_code' ? 'Email code' : 'SMS code'}
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
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={colors.ink3}
              editable={!busy}
            />
          </>
        ) : null}

        {step === 'phone' ? (
          <>
            <AppText variant="captionMedium" tone="ink2" style={styles.label}>
              Phone (with country code)
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
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
              placeholder="+919876543210"
              placeholderTextColor={colors.ink3}
              editable={!busy}
            />
            <AppText variant="caption" tone="ink3">
              Tip: in Clerk Dashboard you can turn off “Phone number” as required if you only want
              email sign-up.
            </AppText>
          </>
        ) : null}

        {localError ? (
          <View style={[styles.errorChip, { backgroundColor: colors.danger + '15', borderColor: colors.danger + '30' }]}>
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
          style={[
            styles.button,
            { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <AppText variant="captionMedium" style={{ color: colors.onAccent }}>
              {primaryLabel}
            </AppText>
          )}
        </PressableScale>

        {step === 'email_code' ? (
          <PressableScale
            accessibilityRole="button"
            onPress={() => void onResendEmail()}
            style={styles.secondary}
          >
            <AppText variant="caption" tone="accent">
              Resend email code
            </AppText>
          </PressableScale>
        ) : null}

        {step === 'phone_code' ? (
          <PressableScale
            accessibilityRole="button"
            onPress={() => void onResendPhone()}
            style={styles.secondary}
          >
            <AppText variant="caption" tone="accent">
              Resend SMS code
            </AppText>
          </PressableScale>
        ) : null}

        <View style={styles.footer}>
          <AppText variant="caption" tone="ink2">
            Already have an account?{' '}
          </AppText>
          <Link href={'/(auth)/sign-in' as Href} asChild>
            <PressableScale accessibilityRole="link">
              <AppText variant="caption" tone="accent">
                Sign in
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
