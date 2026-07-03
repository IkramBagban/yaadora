import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { springs } from '../theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  /** Scale at full press. */
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one touchable used everywhere: springs to `scaleTo` under the finger
 * with a slight opacity dip, so every tap in the app feels physically alive.
 */
export function PressableScale({
  scaleTo = 0.97,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: PressableScaleProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pressed.value * (scaleTo - 1) }],
    opacity: 1 - pressed.value * 0.1,
  }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        pressed.value = withSpring(1, springs.snappy);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressed.value = withSpring(0, springs.snappy);
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}
    />
  );
}
