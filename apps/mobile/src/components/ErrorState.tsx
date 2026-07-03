import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeIn } from 'react-native-reanimated';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

interface ErrorStateProps {
  title: string;
  caption?: string;
  onRetry?: () => void;
}

/** Calm failure — never alarming. The user's data is safe; say so quietly. */
export function ErrorState({ title, caption, onRetry }: ErrorStateProps) {
  const { colors } = useTheme();

  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.wrap}>
      <Feather name="cloud-off" size={22} color={colors.ink3} />
      <View style={styles.text}>
        <AppText variant="title" tone="ink2" align="center">
          {title}
        </AppText>
        {caption ? (
          <AppText variant="sub" tone="ink3" align="center">
            {caption}
          </AppText>
        ) : null}
      </View>
      {onRetry ? (
        <PressableScale
          onPress={onRetry}
          hitSlop={8}
          style={[styles.retry, { borderColor: colors.hairline }]}
        >
          <AppText variant="captionMedium" tone="accent">
            Try again
          </AppText>
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xxxl,
    paddingVertical: space.huge,
  },
  text: {
    alignItems: 'center',
    gap: space.sm,
  },
  retry: {
    paddingHorizontal: space.xl,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
