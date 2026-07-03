import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface StatusDotProps {
  color: string;
  size?: number;
  /** Softly pulses while something is in flight. */
  pulsing?: boolean;
}

export function StatusDot({ color, size = 6, pulsing = false }: StatusDotProps) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (pulsing) {
      pulse.value = withRepeat(
        withSequence(withTiming(0.35, { duration: 600 }), withTiming(1, { duration: 600 })),
        -1,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 150 });
    }
    return () => cancelAnimation(pulse);
  }, [pulsing, pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
}
