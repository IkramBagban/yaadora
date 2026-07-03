import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { Exchange } from '../ask/useAskSession';
import { durations } from '../theme/motion';
import { hairlineWidth, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { Caret } from './Caret';
import { CitationChip } from './CitationChip';
import { ErrorState } from './ErrorState';
import { PressableScale } from './PressableScale';
import { ReasonedTrace } from './ReasonedTrace';
import { SuggestionChip } from './SuggestionChip';
import { ThinkingLine } from './ThinkingLine';

interface AskExchangeProps {
  exchange: Exchange;
  /** past exchanges dim so the live one owns the page */
  dim: boolean;
  showRule: boolean;
  onRetry: () => void;
  onSaveQuestion: () => void;
  onQuickReply: (text: string) => void;
}

/**
 * One question → answer in the conversation feed. Editorial, not chat-bubble:
 * the question is a serif italic title, the answer is Inter body beneath, with
 * a live thinking line, an optional reasoned-trace chip, citations, and — for
 * clarify turns — calm accent-tinted quick replies.
 */
export function AskExchange({
  exchange,
  dim,
  showRule,
  onRetry,
  onSaveQuestion,
  onQuickReply,
}: AskExchangeProps) {
  const { colors } = useTheme();
  const streaming = exchange.status === 'streaming';
  const errored = exchange.status === 'error';
  const clarify = exchange.mode === 'clarify';
  const thinking = streaming && exchange.text.length === 0;
  const bodyTone = dim ? 'ink3' : 'ink';

  return (
    <Animated.View
      entering={FadeInDown.duration(durations.enter).springify().damping(18).stiffness(220)}
      style={styles.wrap}
    >
      {showRule && (
        <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
      )}

      <Pressable
        onLongPress={onSaveQuestion}
        delayLongPress={320}
        accessibilityHint="Long-press to save this as a memory"
      >
        <AppText variant="title" italic tone={dim ? 'ink3' : 'ink2'}>
          {exchange.question}
        </AppText>
      </Pressable>

      {clarify && exchange.text.length > 0 && (
        <Animated.View entering={FadeIn.duration(durations.fade)} style={styles.clarifyLabel}>
          <AppText variant="micro" tone="accent">
            A quick question
          </AppText>
        </Animated.View>
      )}

      {errored && !exchange.text ? (
        <ErrorState
          title="Can't reach your memories right now"
          caption="Your question wasn't lost — try again in a moment."
          onRetry={onRetry}
        />
      ) : thinking ? (
        <ThinkingLine step={exchange.liveStep} />
      ) : (
        <AppText
          variant="body"
          tone={clarify ? 'accent' : bodyTone}
          style={styles.answer}
        >
          {exchange.text}
          {streaming && <Caret />}
        </AppText>
      )}

      {errored && exchange.text ? (
        <Animated.View entering={FadeIn.duration(durations.fade)} style={styles.interrupted}>
          <AppText variant="caption" tone="ink3">
            The answer was interrupted.
          </AppText>
          <PressableScale onPress={onRetry} hitSlop={8}>
            <AppText variant="captionMedium" tone="accent">
              Try again
            </AppText>
          </PressableScale>
        </Animated.View>
      ) : null}

      {exchange.status === 'done' && (
        <View style={styles.footer}>
          {exchange.mode === 'reason' && <ReasonedTrace steps={exchange.steps} />}

          {clarify && exchange.clarifyOptions.length > 0 && (
            <View style={styles.quickReplies}>
              {exchange.clarifyOptions.map((option, i) => (
                <SuggestionChip
                  key={option}
                  label={option}
                  index={i}
                  onPress={() => onQuickReply(option)}
                />
              ))}
            </View>
          )}

          {exchange.citations.length > 0 && (
            <View style={styles.sources}>
              <AppText variant="micro" tone="ink3">
                Sources
              </AppText>
              {exchange.citations.map((citation, i) => (
                <CitationChip
                  key={`${citation.memoryId}-${i}`}
                  citation={citation}
                  index={i}
                  onPress={() =>
                    router.push({
                      pathname: '/memory/[id]',
                      params: { id: citation.memoryId },
                    })
                  }
                />
              ))}
            </View>
          )}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: space.xl,
  },
  rule: {
    height: hairlineWidth,
    marginBottom: space.xl,
  },
  clarifyLabel: {
    marginTop: space.lg,
    marginBottom: -space.xs,
  },
  answer: {
    marginTop: space.lg,
  },
  interrupted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  footer: {
    marginTop: space.xl,
    gap: space.xl,
  },
  quickReplies: {
    gap: space.sm + 2,
  },
  sources: {
    gap: space.sm,
  },
});
