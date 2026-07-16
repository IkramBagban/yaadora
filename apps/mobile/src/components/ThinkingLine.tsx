import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { AskStep } from '../api/types';
import { space } from '../theme/tokens';
import { AppText } from './AppText';

/** Human-readable label for the current step — what the agent is doing now. */
export function thinkingLabel(step: AskStep | null): string {
  if (!step) return 'Searching your memories…';
  if (step.kind === 'synthesize') return 'Putting it together…';
  if (step.kind === 'clarify') return 'Thinking it through…';
  if (step.kind === 'rule') return step.label.trim() || 'Applying your rule…';
  if (step.kind === 'reminder') return step.label.trim() || 'Setting a reminder…';
  // search
  const query = step.query?.trim() || step.label.trim();
  if (typeof step.count === 'number') {
    const noun = step.count === 1 ? 'memory' : 'memories';
    return `${query} · ${step.count} ${noun}`;
  }
  return query || 'Searching your memories…';
}

/**
 * The live status line shown between submit and the first token — a softly
 * shimmering line of text that narrates the agent's search. Fills the gap that
 * used to be dead air.
 */
export function ThinkingLine({ step }: { step: AskStep | null }) {
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
    <Animated.View style={[styles.wrap, animatedStyle]}>
      <AppText variant="serifBody" tone="ink3" italic numberOfLines={2}>
        {thinkingLabel(step)}
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: space.lg,
  },
});
