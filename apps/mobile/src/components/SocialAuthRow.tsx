import { View, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import type { SocialStrategy } from '../auth/useSocialAuth';

type Provider = {
  strategy: SocialStrategy;
  label: string;
  icon: React.ComponentProps<typeof FontAwesome6>['name'];
};

const PROVIDERS: Provider[] = [
  { strategy: 'oauth_google', label: 'Continue with Google', icon: 'google' },
  { strategy: 'oauth_apple', label: 'Continue with Apple', icon: 'apple' },
  { strategy: 'oauth_x', label: 'Continue with X', icon: 'x-twitter' },
];

type Props = {
  onSelect: (strategy: SocialStrategy) => void;
  pending: SocialStrategy | null;
  disabled?: boolean;
  /** Show the "or" divider above the buttons. */
  showDivider?: boolean;
};

export function SocialAuthRow({ onSelect, pending, disabled, showDivider = true }: Props) {
  const { colors } = useTheme();
  const anyBusy = disabled || pending !== null;

  return (
    <View style={styles.wrap}>
      {showDivider ? (
        <View style={styles.dividerRow}>
          <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
          <AppText variant="caption" tone="ink3">
            or
          </AppText>
          <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
        </View>
      ) : null}

      {PROVIDERS.map((p) => {
        const isPending = pending === p.strategy;
        return (
          <PressableScale
            key={p.strategy}
            accessibilityRole="button"
            accessibilityLabel={p.label}
            disabled={anyBusy}
            onPress={() => onSelect(p.strategy)}
            style={[
              styles.button,
              {
                backgroundColor: colors.surface,
                borderColor: colors.hairline,
                opacity: anyBusy && !isPending ? 0.5 : 1,
              },
            ]}
          >
            {isPending ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <>
                <FontAwesome6
                  name={p.icon}
                  size={17}
                  color={colors.ink}
                  style={styles.icon}
                />
                <AppText variant="captionMedium" tone="ink">
                  {p.label}
                </AppText>
              </>
            )}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginVertical: space.sm,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.md,
    minHeight: 48,
  },
  icon: {
    // Nudge the glyph to visually center with the label on Android.
    marginTop: Platform.OS === 'android' ? 1 : 0,
  },
});
