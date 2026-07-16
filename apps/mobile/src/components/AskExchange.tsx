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
import { ReminderChip } from './ReminderChip';
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
 * the question is a serif-italic line pulled to the RIGHT margin (the user's
 * side), the agent's answer is Inter body on the LEFT. A small uppercase label
 * over the answer names what kind of reply it is — sourced from memory, a plain
 * conversational reply, a "found nothing", or a clarifying question — so you can
 * tell who's speaking and what you got at a glance, without bubbles or avatars.
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
  const settled = exchange.status === 'done';
  const bodyTone = dim ? 'ink3' : 'ink';

  // What kind of answer is this? Derived so each turn reads distinctly:
  //  - grounded     → the reply cites the user's own memories
  //  - foundNothing → we searched but stood on nothing (honest "not in memory")
  //  - conversational → plain chat, no search performed
  const searched = exchange.steps.some((s) => s.kind === 'search');
  const grounded = exchange.citations.length > 0;
  const foundNothing = settled && !clarify && !grounded && searched;

  // The answer body tone tracks the kind: accent for a clarifying question,
  // a quieter ink for a "found nothing", normal otherwise.
  const answerTone = clarify
    ? 'accent'
    : foundNothing
      ? dim
        ? 'ink3'
        : 'ink2'
      : bodyTone;

  return (
    <Animated.View
      entering={FadeInDown.duration(durations.enter).springify().damping(18).stiffness(220)}
      style={styles.wrap}
    >
      {showRule && <View style={[styles.rule, { backgroundColor: colors.hairline }]} />}

      {/* The user's words: serif italic, pulled to the right margin. */}
      <Pressable
        onLongPress={onSaveQuestion}
        delayLongPress={320}
        accessibilityHint="Long-press to save this as a memory"
        style={styles.questionRow}
      >
        <AppText
          variant="title"
          italic
          align="right"
          tone={dim ? 'ink3' : 'ink2'}
          style={styles.question}
        >
          {exchange.question}
        </AppText>
      </Pressable>

      {/* The agent's reply: left margin, labelled by kind. */}
      <View style={styles.answerBlock}>
        {clarify && exchange.text.length > 0 && (
          <KindLabel entering text="A quick question" tone="accent" />
        )}
        {!clarify && grounded && <KindLabel text="From your memory" tone="accent" />}
        {foundNothing && <KindLabel text="Not in your memory" tone="ink3" />}

        {errored && !exchange.text ? (
          <ErrorState
            title="Can't reach your memories right now"
            caption="Your question wasn't lost — try again in a moment."
            onRetry={onRetry}
          />
        ) : thinking ? (
          <ThinkingLine step={exchange.liveStep} />
        ) : (
          <AppText variant="body" tone={answerTone}>
            {exchange.text}
            {streaming && <Caret />}
          </AppText>
        )}
      </View>

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

      {settled && (
        <View style={styles.footer}>
          {(exchange.mode === 'reason' ||
            exchange.steps.some((s) => s.kind === 'rule')) && (
            <ReasonedTrace steps={exchange.steps} />
          )}

          {exchange.reminderSuggestion && (
            <ReminderChip suggestion={exchange.reminderSuggestion} />
          )}

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

/** Small uppercase cue naming the kind of reply, left-aligned over the answer. */
function KindLabel({
  text,
  tone,
  entering,
}: {
  text: string;
  tone: 'accent' | 'ink3';
  entering?: boolean;
}) {
  const label = (
    <AppText variant="micro" tone={tone}>
      {text}
    </AppText>
  );
  return (
    <View style={styles.kindLabel}>
      {entering ? (
        <Animated.View entering={FadeIn.duration(durations.fade)}>{label}</Animated.View>
      ) : (
        label
      )}
    </View>
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
  questionRow: {
    alignItems: 'flex-end',
  },
  question: {
    // Keep the user's line off the far margin so it reads as "their side".
    maxWidth: '88%',
  },
  answerBlock: {
    marginTop: space.lg,
    alignItems: 'flex-start',
  },
  kindLabel: {
    marginBottom: space.sm,
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
