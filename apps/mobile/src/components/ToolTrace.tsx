import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import Animated, {
  cancelAnimation,
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { AskStep, AskStepKind } from '../api/types';
import { durations } from '../theme/motion';
import { hairlineWidth, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

const STEP_ICONS: Partial<Record<AskStepKind, keyof typeof Feather.glyphMap>> = {
  search: 'search',
  rule: 'bookmark',
  entity: 'user',
  synthesize: 'edit-3',
  clarify: 'help-circle',
  reminder: 'bell',
};

function stepIcon(kind: AskStepKind): keyof typeof Feather.glyphMap {
  return STEP_ICONS[kind] ?? 'activity';
}

function stepText(step: AskStep): string {
  if (step.kind === 'synthesize') return 'Putting it together…';
  if (step.kind === 'clarify') return 'Thinking it through…';
  if (step.kind === 'rule') return step.label.trim() || 'Applying your rule';
  if (step.kind === 'reminder') return step.label.trim() || 'Setting a reminder';
  const query = step.query?.trim() || step.label.trim();
  if (step.kind === 'search' && typeof step.count === 'number') {
    const noun = step.count === 1 ? 'memory' : 'memories';
    return `${query} · ${step.count} ${noun}`;
  }
  return query || 'Searching your memories…';
}

/** Steps worth keeping once the answer has settled. */
function settledSteps(steps: AskStep[]): AskStep[] {
  return steps.filter(
    (s) => s.kind === 'search' || s.kind === 'rule' || s.kind === 'entity',
  );
}

function summaryLabel(steps: AskStep[]): string {
  const searches = steps.filter((s) => s.kind === 'search').length;
  const rules = steps.filter((s) => s.kind === 'rule').length;
  const entities = steps.filter((s) => s.kind === 'entity').length;
  const parts: string[] = [];
  if (searches > 0)
    parts.push(searches === 1 ? 'Searched once' : `Searched ${searches} times`);
  if (rules > 0) parts.push(`${rules} rule${rules === 1 ? '' : 's'}`);
  if (entities > 0)
    parts.push(entities === 1 ? '1 person/project' : `${entities} people/projects`);
  return parts.join(' · ');
}

interface ToolTraceProps {
  steps: AskStep[];
  streaming: boolean;
  dim?: boolean;
}

/**
 * The agent's working trace, shown above the answer. While streaming, each
 * step appears live as a row in a compact timeline (the latest one shimmers).
 * Once the answer settles it collapses to a single quiet summary row that
 * expands on tap.
 */
export function ToolTrace({ steps, streaming, dim = false }: ToolTraceProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  // Collapse whenever a stream finishes so past traces rest quiet.
  useEffect(() => {
    if (streaming) setOpen(false);
  }, [streaming]);

  if (streaming) {
    return (
      <Animated.View layout={LinearTransition.springify().damping(20).stiffness(240)}>
        <View style={styles.timeline}>
          {steps.length === 0 ? (
            <ShimmerRow icon="search" text="Searching your memories…" />
          ) : (
            steps.map((step, i) => {
              const last = i === steps.length - 1;
              return last ? (
                <ShimmerRow
                  key={`${step.kind}-${i}`}
                  icon={stepIcon(step.kind)}
                  text={stepText(step)}
                />
              ) : (
                <Animated.View
                  key={`${step.kind}-${i}`}
                  entering={FadeInDown.duration(durations.fade)}
                  style={styles.stepRow}
                >
                  <Feather name={stepIcon(step.kind)} size={13} color={colors.ink3} />
                  <AppText variant="caption" tone="ink3" style={styles.stepText}>
                    {stepText(step)}
                  </AppText>
                </Animated.View>
              );
            })
          )}
        </View>
      </Animated.View>
    );
  }

  const kept = settledSteps(steps);
  if (kept.length === 0) return null;
  const tone = dim ? 'ink3' : 'ink2';

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(20).stiffness(240)}
      style={styles.settled}
    >
      <PressableScale
        onPress={() => {
          void Haptics.selectionAsync();
          setOpen((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityLabel="Show the steps behind this answer"
        style={styles.summaryRow}
      >
        <Feather name="zap" size={12} color={colors.ink3} />
        <AppText variant="captionMedium" tone={tone}>
          {summaryLabel(kept)}
        </AppText>
        <Feather
          name={open ? 'chevron-up' : 'chevron-down'}
          size={13}
          color={colors.ink3}
        />
      </PressableScale>

      {open && (
        <Animated.View
          entering={FadeIn.duration(160)}
          style={[styles.expanded, { borderLeftColor: colors.hairline }]}
        >
          {kept.map((step, i) => (
            <Animated.View
              key={`${step.kind}-${step.query ?? step.label}-${i}`}
              entering={FadeInDown.delay(i * 40).duration(durations.fade)}
              style={styles.stepRow}
            >
              <Feather
                name={stepIcon(step.kind)}
                size={13}
                color={step.kind === 'rule' ? colors.accent : colors.ink3}
              />
              <AppText variant="caption" tone="ink2" style={styles.stepText}>
                {stepText(step)}
              </AppText>
            </Animated.View>
          ))}
        </Animated.View>
      )}
    </Animated.View>
  );
}

/** A step row that softly pulses — the agent is on this step right now. */
function ShimmerRow({
  icon,
  text,
}: {
  icon: keyof typeof Feather.glyphMap;
  text: string;
}) {
  const { colors } = useTheme();
  const shimmer = useSharedValue(0.45);

  useEffect(() => {
    shimmer.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 720 }),
        withTiming(0.45, { duration: 720 }),
      ),
      -1,
    );
    return () => cancelAnimation(shimmer);
  }, [shimmer]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Animated.View style={[styles.stepRow, animatedStyle]}>
      <Feather name={icon} size={13} color={colors.ink2} />
      <AppText variant="caption" tone="ink2" style={styles.stepText} numberOfLines={2}>
        {text}
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  timeline: {
    gap: space.sm,
  },
  settled: {
    gap: space.sm,
  },
  summaryRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm - 2,
    paddingVertical: space.xs,
  },
  expanded: {
    gap: space.sm,
    paddingLeft: space.md,
    marginLeft: space.xs + 1,
    borderLeftWidth: hairlineWidth,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  stepText: {
    flex: 1,
    marginTop: 0.5,
  },
});
