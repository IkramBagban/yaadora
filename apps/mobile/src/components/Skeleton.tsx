import { useEffect } from 'react';
import type { DimensionValue } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
  style?: object;
}

/** A softly breathing placeholder block. */
export function Skeleton({ width = '100%', height = 16, rounded = radius.sm, style }: SkeletonProps) {
  const { colors } = useTheme();
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })),
      -1,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: rounded, backgroundColor: colors.surfaceAlt },
        animatedStyle,
        style,
      ]}
    />
  );
}
