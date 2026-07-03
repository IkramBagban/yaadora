import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { typeScale } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

/**
 * The blinking block at the end of a streaming answer. Nested inside the
 * answer <Text>, so it rides the text flow; blinks via color (reliable for
 * nested text spans on both platforms, unlike opacity).
 */
export function Caret() {
  const { colors } = useTheme();
  const blink = useSharedValue(1);

  useEffect(() => {
    blink.value = withRepeat(
      withSequence(withTiming(0, { duration: 420 }), withTiming(1, { duration: 420 })),
      -1,
    );
    return () => cancelAnimation(blink);
  }, [blink]);

  const animatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(blink.value, [0, 1], ['transparent', colors.accent]),
  }));

  return <Animated.Text style={[typeScale.body, animatedStyle]}>{'▍'}</Animated.Text>;
}
