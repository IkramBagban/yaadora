import { StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { staggerMs } from '../theme/motion';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

interface SuggestionChipProps {
  label: string;
  index: number;
  onPress: () => void;
}

/** An example question on the Ask idle screen — serif italic, like a whispered prompt. */
export function SuggestionChip({ label, index, onPress }: SuggestionChipProps) {
  const { colors } = useTheme();

  return (
    <Animated.View
      entering={FadeInDown.delay(200 + index * staggerMs * 2)
        .springify()
        .damping(18)
        .stiffness(220)}
    >
      <PressableScale
        onPress={() => {
          void Haptics.selectionAsync();
          onPress();
        }}
        style={[
          styles.chip,
          { backgroundColor: colors.surface, borderColor: colors.hairline },
        ]}
      >
        <AppText variant="serifBody" italic tone="ink2" numberOfLines={1}>
          {label}
        </AppText>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: hairlineWidth,
  },
});
