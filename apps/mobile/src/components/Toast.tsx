import { StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';

interface ToastProps {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
}

/** A small confirmation pill that springs in from above. Mount/unmount to show/hide. */
export function Toast({ label, icon = 'check' }: ToastProps) {
  const { colors } = useTheme();

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18).stiffness(220)}
      exiting={FadeOutUp.duration(160)}
      style={[
        styles.toast,
        {
          backgroundColor: colors.surface,
          borderColor: colors.hairline,
          shadowColor: '#000',
        },
      ]}
    >
      <Feather name={icon} size={14} color={colors.success} />
      <AppText variant="captionMedium" tone="ink">
        {label}
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm - 2,
    paddingHorizontal: space.lg,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
});
