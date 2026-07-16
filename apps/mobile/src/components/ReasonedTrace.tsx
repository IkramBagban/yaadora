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
 * Trace chip after an answer: multi-lookup reasoning and/or standing rules
 * that shaped the reply (P1 rules doorway).
 */
export function ReasonedTrace({ steps }: { steps: AskStep[] }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const searches = steps.filter((s) => s.kind === 'search');
  const ruleSteps = steps.filter((s) => s.kind === 'rule');
  const entitySteps = steps.filter((s) => s.kind === 'entity');
  if (searches.length < 2 && ruleSteps.length === 0 && entitySteps.length === 0)
    return null;

  const parts: string[] = [];
  if (searches.length >= 2) parts.push(`${searches.length} lookups`);
  if (ruleSteps.length > 0)
    parts.push(`${ruleSteps.length} rule${ruleSteps.length === 1 ? '' : 's'}`);
  if (entitySteps.length > 0)
    parts.push(
      `${entitySteps.length} ${entitySteps.length === 1 ? 'person/project' : 'people/projects'}`,
    );

  const chipLabel =
    ruleSteps.length > 0 && searches.length < 2 && entitySteps.length === 0
      ? ruleSteps.length === 1
        ? 'Applied your rule'
        : `Applied ${ruleSteps.length} rules`
      : `Reasoned · ${parts.join(' · ')}`;

  const visibleSteps: AskStep[] = [
    ...ruleSteps,
    ...entitySteps,
    ...(searches.length >= 2 ? searches : []),
  ];

  return (
    <Animated.View layout={LinearTransition.springify().damping(20).stiffness(240)}>
      <PressableScale
        onPress={() => {
          void Haptics.selectionAsync();
          setOpen((v) => !v);
        }}
        style={[styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline }]}
      >
        <Feather
          name={ruleSteps.length > 0 && searches.length < 2 ? 'bookmark' : 'git-branch'}
          size={12}
          color={colors.ink3}
        />
        <AppText variant="captionMedium" tone="ink2">
          {chipLabel}
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
          {visibleSteps.map((step, i) => (
            <Animated.View
              key={`${step.kind}-${step.query ?? step.label}-${i}`}
              entering={FadeInDown.delay(i * 40).springify().damping(18).stiffness(220)}
              style={styles.stepRow}
            >
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      step.kind === 'rule' ? colors.accent : colors.ink3,
                  },
                ]}
              />
              <AppText variant="caption" tone="ink2" style={styles.stepText}>
                {step.kind === 'rule'
                  ? step.label
                  : step.query?.trim() || step.label}
                {step.kind === 'search' && typeof step.count === 'number' ? (
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
