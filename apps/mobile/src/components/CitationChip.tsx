import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { Citation } from '../api/types';
import { relativeTime } from '../lib/time';
import { staggerMs } from '../theme/motion';
import { fonts, hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

interface CitationChipProps {
  citation: Citation;
  index: number;
  onPress: () => void;
}

/** A tappable source: serif quotation mark, one line of the memory, its date. */
export function CitationChip({ citation, index, onPress }: CitationChipProps) {
  const { colors } = useTheme();

  return (
    <Animated.View
      entering={FadeInDown.delay(index * staggerMs)
        .springify()
        .damping(18)
        .stiffness(220)}
    >
      <PressableScale
        onPress={onPress}
        style={[
          styles.chip,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
        ]}
      >
        <AppText style={[styles.quote, { color: colors.accent }]}>{'“'}</AppText>
        <View style={styles.body}>
          <AppText variant="caption" tone="ink" numberOfLines={1}>
            {citation.snippet}
          </AppText>
          {citation.occurredAt ? (
            <AppText variant="caption" tone="ink3">
              {relativeTime(citation.occurredAt)}
            </AppText>
          ) : null}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
    borderWidth: hairlineWidth,
    maxWidth: '100%',
  },
  quote: {
    fontFamily: fonts.sans,
    fontSize: 20,
    lineHeight: 22,
  },
  body: {
    flexShrink: 1,
    gap: 1,
  },
});
