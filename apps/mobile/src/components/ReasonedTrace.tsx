import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
} from 'react-native-reanimated';
import type { AskStep } from '../api/types';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * The "Reasoned · N lookups" chip shown after a multi-lookup answer. Tapping it
 * expands the step list, so the user can see the AI actually worked — silence
 * for single-pass recall, a quiet trace for real reasoning.
 */
export function ReasonedTrace({ steps }: { steps: AskStep[] }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const searches = steps.filter((s) => s.kind === 'search');
  if (searches.length < 2) return null;

  return (
    <Animated.View layout={LinearTransition.springify().damping(20).stiffness(240)}>
      <PressableScale
        onPress={() => {
          void Haptics.selectionAsync();
          setOpen((v) => !v);
        }}
        style={[styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline }]}
      >
        <Feather name="git-branch" size={12} color={colors.ink3} />
        <AppText variant="captionMedium" tone="ink2">
          Reasoned · {searches.length} lookups
        </AppText>
        <Feather
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.ink3}
        />
      </PressableScale>

      {open && (
        <Animated.View
          entering={FadeIn.duration(160)}
          layout={LinearTransition.springify().damping(20).stiffness(240)}
          style={styles.steps}
        >
          {searches.map((step, i) => (
            <Animated.View
              key={`${step.query ?? step.label}-${i}`}
              entering={FadeInDown.delay(i * 40).springify().damping(18).stiffness(220)}
              style={styles.stepRow}
            >
              <View style={[styles.dot, { backgroundColor: colors.ink3 }]} />
              <AppText variant="caption" tone="ink2" style={styles.stepText}>
                {step.query?.trim() || step.label}
                {typeof step.count === 'number' ? (
                  <AppText variant="caption" tone="ink3">
                    {'  '}
                    {step.count} {step.count === 1 ? 'memory' : 'memories'}
                  </AppText>
                ) : null}
              </AppText>
            </Animated.View>
          ))}
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm - 2,
    paddingHorizontal: space.md,
    paddingVertical: space.sm - 1,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
  },
  steps: {
    marginTop: space.md,
    gap: space.sm,
    paddingLeft: space.xs,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    marginTop: 7,
  },
  stepText: {
    flex: 1,
  },
});
