import { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, Alert, Switch } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Image } from 'expo-image';
import Feather from '@expo/vector-icons/Feather';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { useUser, useClerk } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../src/components/AppText';
import { PressableScale } from '../src/components/PressableScale';
import { api } from '../src/api/client';
import { createMobileLogger } from '../src/lib/log';
import { radius, space } from '../src/theme/tokens';
import { useTheme } from '../src/theme/useTheme';

const log = createMobileLogger('profile');

/** Map a Clerk external-account provider to a label + FontAwesome6 icon. */
const PROVIDER_META: Record<string, { label: string; icon: React.ComponentProps<typeof FontAwesome6>['name'] }> = {
  google: { label: 'Google', icon: 'google' },
  apple: { label: 'Apple', icon: 'apple' },
  x: { label: 'X', icon: 'x-twitter' },
  twitter: { label: 'X', icon: 'x-twitter' },
};

function initialsFrom(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name && name.trim()) || (email ?? '');
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letters.join('') || '?';
}

export default function ProfileScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  // "Insights" toggle (spec 03 P4). null = not yet loaded; disables the switch.
  const [insightsEnabled, setInsightsEnabled] = useState<boolean | null>(null);
  const [savingInsights, setSavingInsights] = useState(false);

  useEffect(() => {
    let alive = true;
    void api
      .getPrivacySettings()
      .then((s) => {
        if (alive) setInsightsEnabled(s.insightsEnabled);
      })
      .catch((err) => {
        log.warn('load privacy settings failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  const onToggleInsights = (next: boolean) => {
    const prev = insightsEnabled;
    setInsightsEnabled(next); // optimistic
    setSavingInsights(true);
    void api
      .patchPrivacySettings({ insightsEnabled: next })
      .then((s) => setInsightsEnabled(s.insightsEnabled))
      .catch((err) => {
        setInsightsEnabled(prev ?? false); // revert
        log.error('save insights toggle failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        Alert.alert('Could not save', 'Please try again.');
      })
      .finally(() => setSavingInsights(false));
  };

  const onSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          log.info('signing out');
          void signOut()
            .then(() => router.replace('/(auth)/sign-in' as Href))
            .catch((err) => {
              log.error('sign out failed', { message: err instanceof Error ? err.message : String(err) });
              setSigningOut(false);
            });
        },
      },
    ]);
  };

  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const displayName = user?.fullName || user?.username || (email ? email.split('@')[0] : 'You');
  const hasPassword = user?.passwordEnabled ?? false;
  const externals = user?.externalAccounts ?? [];
  const createdAt = user?.createdAt ?? null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <AppText variant="title">Account</AppText>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          hitSlop={12}
        >
          <Feather name="x" size={22} color={colors.ink2} />
        </PressableScale>
      </View>

      {!isLoaded ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.identity}>
            {user?.imageUrl ? (
              <Image source={{ uri: user.imageUrl }} style={styles.avatar} contentFit="cover" transition={200} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.accentSoft }]}>
                <AppText variant="title" tone="accent">
                  {initialsFrom(user?.fullName, email)}
                </AppText>
              </View>
            )}
            <AppText variant="title" style={styles.name}>
              {displayName}
            </AppText>
            {email ? (
              <AppText variant="sub" tone="ink2">
                {email}
              </AppText>
            ) : null}
          </View>

          <AppText variant="micro" tone="ink3" style={styles.sectionLabel}>
            Second brain
          </AppText>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.hairline }]}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Standing rules"
              onPress={() => router.push('/rules' as Href)}
            >
              <Row
                icon={<Feather name="bookmark" size={18} color={colors.ink2} />}
                label="Standing rules"
                value="When a task matches, shape the answer"
                chevron
              />
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Your world"
              onPress={() => router.push('/entities' as Href)}
            >
              <Row
                divider
                icon={<Feather name="share-2" size={18} color={colors.ink2} />}
                label="Your world"
                value="People, places, projects, topics & moments"
                chevron
              />
            </PressableScale>
          </View>

          <AppText variant="micro" tone="ink3" style={styles.sectionLabel}>
            Insights
          </AppText>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.hairline }]}>
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Feather name="zap" size={18} color={colors.ink2} />
              </View>
              <View style={styles.rowText}>
                <AppText variant="sub" tone="ink">
                  Insights
                </AppText>
                <AppText variant="caption" tone="ink3">
                  Let Yaadora gently raise a past commitment when it seems in tension with something new — always as a question. Your reminders and standing rules aren&apos;t affected.
                </AppText>
              </View>
              <Switch
                accessibilityLabel="Toggle insights"
                value={insightsEnabled ?? false}
                onValueChange={onToggleInsights}
                disabled={insightsEnabled === null || savingInsights}
                trackColor={{ true: colors.accent, false: colors.hairline }}
              />
            </View>
          </View>

          <AppText variant="micro" tone="ink3" style={styles.sectionLabel}>
            Signed in with
          </AppText>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.hairline }]}>
            {hasPassword ? (
              <Row icon={<Feather name="mail" size={18} color={colors.ink2} />} label="Email & password" />
            ) : null}
            {externals.map((acc, i) => {
              const meta = PROVIDER_META[acc.provider] ?? { label: acc.provider, icon: 'circle-user' as const };
              const showDivider = hasPassword || i > 0;
              return (
                <Row
                  key={acc.id}
                  divider={showDivider}
                  icon={<FontAwesome6 name={meta.icon} size={17} color={colors.ink2} />}
                  label={meta.label}
                  value={acc.emailAddress || acc.username || undefined}
                />
              );
            })}
            {!hasPassword && externals.length === 0 ? (
              <Row icon={<Feather name="user" size={18} color={colors.ink2} />} label="Account" />
            ) : null}
          </View>

          {createdAt ? (
            <AppText variant="caption" tone="ink3" style={styles.memberSince}>
              Member since{' '}
              {createdAt.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
            </AppText>
          ) : null}

          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={onSignOut}
            disabled={signingOut}
            style={[styles.signOut, { borderColor: colors.danger + '40', opacity: signingOut ? 0.6 : 1 }]}
          >
            {signingOut ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <>
                <Feather name="log-out" size={17} color={colors.danger} />
                <AppText variant="captionMedium" tone="danger">
                  Sign out
                </AppText>
              </>
            )}
          </PressableScale>
        </ScrollView>
      )}
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  divider,
  chevron,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  divider?: boolean;
  chevron?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, divider ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline } : null]}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowText}>
        <AppText variant="sub" tone="ink">
          {label}
        </AppText>
        {value ? (
          <AppText variant="caption" tone="ink3" numberOfLines={1}>
            {value}
          </AppText>
        ) : null}
      </View>
      {chevron ? <Feather name="chevron-right" size={18} color={colors.ink3} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: space.lg,
  },
  identity: {
    alignItems: 'center',
    paddingVertical: space.xl,
    gap: space.xs,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    marginBottom: space.sm,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    marginTop: space.xs,
  },
  sectionLabel: {
    marginTop: space.lg,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  rowIcon: {
    width: 22,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
  },
  memberSince: {
    marginTop: space.lg,
    textAlign: 'center',
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xl,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    minHeight: 48,
  },
});
