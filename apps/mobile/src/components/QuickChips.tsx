import { ScrollView, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { durations } from '../theme/motion';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

interface QuickChip {
  label: string;
  prefix: string;
  icon: keyof typeof Feather.glyphMap;
}

const CHIPS: QuickChip[] = [
  { label: 'Idea', prefix: 'Idea: ', icon: 'zap' },
  { label: 'Decision', prefix: 'Decision: ', icon: 'check-circle' },
  { label: 'Plan', prefix: 'Plan: ', icon: 'map' },
  { label: 'Feeling', prefix: 'Feeling: ', icon: 'heart' },
];

/**
 * One-tap starters for the things you keep coming back to write — tapping a
 * chip seeds the editor ("Decision: ") and drops you straight into typing.
 */
export function QuickChips({ onPick }: { onPick: (prefix: string) => void }) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bleed}
      contentContainerStyle={styles.row}
    >
      {CHIPS.map((chip, i) => (
        <Animated.View
          key={chip.label}
          entering={FadeInDown.delay(i * 40)
            .duration(durations.enter)
            .springify()
            .damping(18)}
        >
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Start a ${chip.label.toLowerCase()}`}
            onPress={() => {
              void Haptics.selectionAsync();
              onPick(chip.prefix);
            }}
            style={[
              styles.chip,
              { backgroundColor: colors.surface, borderColor: colors.hairline },
            ]}
          >
            <Feather name={chip.icon} size={13} color={colors.ink2} />
            <AppText variant="captionMedium" tone="ink2">
              {chip.label}
            </AppText>
          </PressableScale>
        </Animated.View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bleed: {
    marginHorizontal: -space.xxl,
    flexGrow: 0,
  },
  row: {
    gap: space.sm,
    paddingHorizontal: space.xxl,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    height: 34,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
  },
});
