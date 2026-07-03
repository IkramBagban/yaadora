import { useEffect } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AppText } from './AppText';
import { springs, durations } from '../theme/motion';
import { hairlineWidth, radius } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

const SEGMENT_WIDTH = 104;
const BAR_HEIGHT = 56;
const INDICATOR_INSET = 5;

const TAB_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'feather',
  ask: 'message-circle',
};

/**
 * A floating Add | Ask pill above the content: blurred glass on iOS, solid
 * surface on Android. The indicator slides on a snappy spring; the whole bar
 * ducks out of the way while the keyboard is up.
 */
export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();

  const index = useSharedValue(state.index);
  const hidden = useSharedValue(0);

  useEffect(() => {
    index.value = withSpring(state.index, springs.snappy);
  }, [state.index, index]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => {
      hidden.value = withTiming(1, { duration: durations.fade });
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      hidden.value = withSpring(0, springs.standard);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [hidden]);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hidden.value * 120 }],
    opacity: 1 - hidden.value,
  }));

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: INDICATOR_INSET + index.value * SEGMENT_WIDTH }],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + 12 }, barStyle]}
    >
      <View
        style={[
          styles.bar,
          {
            borderColor: colors.hairline,
            backgroundColor:
              Platform.OS === 'ios' ? 'transparent' : colors.surface,
          },
        ]}
      >
        {Platform.OS === 'ios' && (
          <BlurView
            tint={dark ? 'dark' : 'light'}
            intensity={70}
            style={StyleSheet.absoluteFill}
          />
        )}
        <Animated.View
          style={[
            styles.indicator,
            { backgroundColor: colors.surfaceAlt },
            indicatorStyle,
          ]}
        />
        {state.routes.map((route, i) => {
          const { options } = descriptors[route.key]!;
          const focused = state.index === i;
          const label = options.title ?? route.name;
          const icon = TAB_ICONS[route.name] ?? 'circle';

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              onPress={() => {
                void Haptics.selectionAsync();
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              style={styles.segment}
            >
              <Feather
                name={icon}
                size={16}
                color={focused ? colors.ink : colors.ink3}
              />
              <AppText variant="micro" tone={focused ? 'ink' : 'ink3'}>
                {label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    height: BAR_HEIGHT,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    top: INDICATOR_INSET,
    bottom: INDICATOR_INSET,
    width: SEGMENT_WIDTH - INDICATOR_INSET * 2,
    borderRadius: radius.pill,
  },
  segment: {
    width: SEGMENT_WIDTH,
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
});
