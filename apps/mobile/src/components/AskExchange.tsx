import { Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { Exchange } from '../ask/useAskSession';
import { durations } from '../theme/motion';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { Caret } from './Caret';
import { ErrorState } from './ErrorState';
import { NudgeReceipt } from './NudgeReceipt';
import { PressableScale } from './PressableScale';
import { ReminderChip } from './ReminderChip';
import { SuggestionChip } from './SuggestionChip';
import { SourcesSheet } from './SourcesSheet';
import { ToolTrace } from './ToolTrace';

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
 * One question → answer in the conversation feed. The user's message sits in a
 * soft bubble on the right; the agent answers in clean full-width text on the
 * left, with its working trace (searches, rules, entities) shown live above
 * the answer and collapsed to a quiet summary once settled. A small uppercase
 * label over the answer names what kind of reply it is — sourced from memory,
 * a "found nothing", or a clarifying question.
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
  const settled = exchange.status === 'done';
  const bodyTone = dim ? 'ink3' : 'ink';
  const [sourcesOpen, setSourcesOpen] = useState(false);

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

      {/* The user's message: a soft bubble pulled to the right. */}
      <View style={styles.questionRow}>
        <Pressable
          onLongPress={onSaveQuestion}
          delayLongPress={320}
          accessibilityHint="Long-press to save this as a memory"
          style={[
            styles.questionBubble,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.hairline,
              opacity: dim ? 0.6 : 1,
            },
          ]}
        >
          <AppText variant="body" tone="ink">
            {exchange.question}
          </AppText>
        </Pressable>
      </View>

      {/* The agent's reply: full-width on the left, trace above, labelled by kind. */}
      <View style={styles.answerBlock}>
        <ToolTrace steps={exchange.steps} streaming={streaming} dim={dim} />

        {clarify && exchange.text.length > 0 && (
          <KindLabel entering text="A quick question" tone="accent" />
        )}
        {foundNothing && <KindLabel text="Not in your memory" tone="ink3" />}

        {errored && !exchange.text ? (
          <ErrorState
            title={exchange.error || "Can't reach your memories right now"}
            caption="Your question wasn't lost — try again in a moment."
            onRetry={onRetry}
          />
        ) : exchange.text.length > 0 ? (
          <AppText variant="body" tone={answerTone}>
            {exchange.text}
            {streaming && <Caret />}
          </AppText>
        ) : null}
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
          {exchange.reminderSuggestion && (
            <ReminderChip suggestion={exchange.reminderSuggestion} />
          )}

          {exchange.surfacingId && (
            <NudgeReceipt
              surfacingId={exchange.surfacingId}
              evidenceIds={exchange.evidence}
            />
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
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Show ${exchange.citations.length} source${exchange.citations.length === 1 ? '' : 's'}`}
              onPress={() => setSourcesOpen(true)}
              style={[styles.sourcesButton, { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline }]}
            >
              <Feather name="book-open" size={14} color={colors.ink2} />
              <AppText variant="captionMedium" tone="ink2">
                {exchange.citations.length} source{exchange.citations.length === 1 ? '' : 's'}
              </AppText>
              <Feather name="chevron-up" size={14} color={colors.ink3} />
            </PressableScale>
          )}
        </View>
      )}
      <SourcesSheet
        citations={exchange.citations}
        visible={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
      />
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
  return entering ? (
    <Animated.View entering={FadeIn.duration(durations.fade)}>{label}</Animated.View>
  ) : (
    label
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
  questionBubble: {
    maxWidth: '85%',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm - 4,
    borderWidth: hairlineWidth,
  },
  answerBlock: {
    marginTop: space.xl,
    alignItems: 'stretch',
    gap: space.md,
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
  sourcesButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    minHeight: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
  },
});
