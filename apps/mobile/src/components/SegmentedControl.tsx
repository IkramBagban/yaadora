import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { springs } from '../theme/motion';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

export interface Segment<K extends string> {
  key: K;
  label: string;
  icon?: keyof typeof Feather.glyphMap;
}

interface SegmentedControlProps<K extends string> {
  segments: Segment<K>[];
  value: K;
  onChange: (key: K) => void;
}

/**
 * Equal-width segmented switcher with a sliding pill indicator.
 * The indicator springs between segments; selection is haptic.
 */
export function SegmentedControl<K extends string>({
  segments,
  value,
  onChange,
}: SegmentedControlProps<K>) {
  const { colors } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(
    0,
    segments.findIndex((s) => s.key === value),
  );
  const position = useSharedValue(index);

  useEffect(() => {
    position.value = withSpring(index, springs.gentle);
  }, [index, position]);

  const segmentWidth = trackWidth > 0 ? trackWidth / segments.length : 0;

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * segmentWidth }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width - PADDING * 2);
  };

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.track,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
      ]}
      accessibilityRole="tablist"
    >
      {segmentWidth > 0 && (
        <Animated.View
          style={[
            styles.indicator,
            { width: segmentWidth, backgroundColor: colors.surface },
            indicatorStyle,
          ]}
        />
      )}
      {segments.map((segment) => {
        const active = segment.key === value;
        return (
          <PressableScale
            key={segment.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              void Haptics.selectionAsync();
              onChange(segment.key);
            }}
            style={styles.segment}
          >
            {segment.icon && (
              <Feather
                name={segment.icon}
                size={13}
                color={active ? colors.ink : colors.ink3}
              />
            )}
            <AppText
              variant="captionMedium"
              tone={active ? 'ink' : 'ink3'}
            >
              {segment.label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}

const PADDING = 3;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: PADDING,
    borderRadius: radius.md,
    borderWidth: hairlineWidth,
  },
  indicator: {
    position: 'absolute',
    top: PADDING,
    bottom: PADDING,
    left: PADDING,
    borderRadius: radius.md - 3,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
    height: 34,
  },
});
