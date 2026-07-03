import { useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useAsk } from '../../src/ask/useAsk';
import { AppText } from '../../src/components/AppText';
import { Caret } from '../../src/components/Caret';
import { CitationChip } from '../../src/components/CitationChip';
import { ErrorState } from '../../src/components/ErrorState';
import { PressableScale } from '../../src/components/PressableScale';
import { SuggestionChip } from '../../src/components/SuggestionChip';
import { useKeyboardVisible } from '../../src/lib/useKeyboardVisible';
import { durations } from '../../src/theme/motion';
import { hairlineWidth, radius, space, typeScale } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const SUGGESTIONS = [
  'What was on my mind last week?',
  'What do I know about my goals?',
  'When did I last feel proud of my work?',
];

const TAB_BAR_CLEARANCE = 88;
const LOW_CONFIDENCE = 0.5;

/**
 * Ask — one question, one grounded answer, with tappable sources.
 * No history: each ask is fresh; the memory store is the history.
 */
export default function AskScreen() {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const [draft, setDraft] = useState('');
  const { status, question, text, citations, confidence, mode, ask, cancel, reset } =
    useAsk();

  const streaming = status === 'streaming';

  const submit = (value?: string) => {
    const q = (value ?? draft).trim();
    if (!q || streaming) return;
    void Haptics.selectionAsync();
    Keyboard.dismiss();
    setDraft('');
    void ask(q);
  };

  const askAnother = () => {
    reset();
    setTimeout(() => inputRef.current?.focus(), 120);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <View style={[styles.screen, { paddingTop: insets.top + space.md }]}>
          {status === 'idle' ? (
            <View style={styles.idle}>
              <Animated.View entering={FadeIn.duration(durations.enter)} style={styles.idleText}>
                <AppText variant="display" align="center">
                  Ask your memory.
                </AppText>
                <AppText variant="sub" tone="ink3" align="center">
                  Answers come only from what you&apos;ve written — with sources.
                </AppText>
              </Animated.View>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((suggestion, i) => (
                  <SuggestionChip
                    key={suggestion}
                    label={suggestion}
                    index={i}
                    onPress={() => submit(suggestion)}
                  />
                ))}
              </View>
            </View>
          ) : (
            <ScrollView
              ref={scrollRef}
              style={styles.screen}
              contentContainerStyle={styles.answerContent}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => {
                if (streaming) scrollRef.current?.scrollToEnd({ animated: false });
              }}
            >
              <Animated.View entering={FadeIn.duration(durations.fade)}>
                <AppText variant="title" italic tone="ink2">
                  {question}
                </AppText>
              </Animated.View>

              {status === 'error' && !text ? (
                <ErrorState
                  title="Can't reach your memories right now"
                  caption="Your question wasn't lost — try again in a moment."
                  onRetry={() => void ask(question)}
                />
              ) : (
                <AppText variant="body" style={styles.answerText}>
                  {text}
                  {streaming && <Caret />}
                </AppText>
              )}

              {status === 'error' && text ? (
                <Animated.View entering={FadeIn.duration(durations.fade)} style={styles.interrupted}>
                  <AppText variant="caption" tone="ink3">
                    The answer was interrupted.
                  </AppText>
                  <PressableScale onPress={() => void ask(question)} hitSlop={8}>
                    <AppText variant="captionMedium" tone="accent">
                      Try again
                    </AppText>
                  </PressableScale>
                </Animated.View>
              ) : null}

              {status === 'done' && (
                <Animated.View entering={FadeIn.duration(durations.enter)} style={styles.result}>
                  {(mode === 'reason' || (confidence !== null && confidence < LOW_CONFIDENCE)) && (
                    <View style={styles.metaRow}>
                      {mode === 'reason' && (
                        <View style={[styles.modeBadge, { backgroundColor: colors.accentSoft }]}>
                          <AppText variant="micro" tone="accent">
                            Reasoned
                          </AppText>
                        </View>
                      )}
                      {confidence !== null && confidence < LOW_CONFIDENCE && (
                        <AppText variant="caption" tone="ink3">
                          Low confidence — grounded in limited memories
                        </AppText>
                      )}
                    </View>
                  )}

                  {citations.length > 0 && (
                    <View style={styles.sources}>
                      <AppText variant="micro" tone="ink3">
                        Sources
                      </AppText>
                      {citations.map((citation, i) => (
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

                  <Animated.View
                    entering={FadeInDown.delay(citations.length * 40 + 120)
                      .springify()
                      .damping(18)
                      .stiffness(220)}
                    style={styles.askAnotherWrap}
                  >
                    <PressableScale
                      onPress={askAnother}
                      style={[styles.askAnother, { borderColor: colors.hairline }]}
                    >
                      <AppText variant="captionMedium" tone="ink2">
                        Ask another
                      </AppText>
                    </PressableScale>
                  </Animated.View>
                </Animated.View>
              )}
            </ScrollView>
          )}

          <View
            style={[
              styles.inputWrap,
              {
                paddingBottom: keyboardVisible
                  ? space.md
                  : insets.bottom + TAB_BAR_CLEARANCE,
              },
            ]}
          >
            <View
              style={[
                styles.inputPill,
                { backgroundColor: colors.surface, borderColor: colors.hairline },
              ]}
            >
              <TextInput
                ref={inputRef}
                value={draft}
                onChangeText={setDraft}
                placeholder="Ask anything…"
                placeholderTextColor={colors.ink3}
                keyboardAppearance={dark ? 'dark' : 'light'}
                selectionColor={colors.accent}
                cursorColor={colors.accent}
                returnKeyType="send"
                onSubmitEditing={() => submit()}
                style={[styles.inputText, typeScale.sub, { color: colors.ink }]}
                accessibilityLabel="Your question"
              />
              {streaming ? (
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Stop answering"
                  onPress={cancel}
                  hitSlop={8}
                  style={[
                    styles.sendButton,
                    { backgroundColor: colors.surfaceAlt, borderWidth: hairlineWidth, borderColor: colors.hairline },
                  ]}
                >
                  <View style={[styles.stopSquare, { backgroundColor: colors.ink2 }]} />
                </PressableScale>
              ) : (
                <Animated.View entering={FadeIn.duration(durations.quick)} exiting={FadeOut.duration(durations.quick)}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Ask"
                    disabled={draft.trim().length === 0}
                    onPress={() => submit()}
                    hitSlop={8}
                    style={[styles.sendButton, { backgroundColor: colors.accent }]}
                  >
                    <View style={{ opacity: draft.trim().length === 0 ? 0.5 : 1 }}>
                      <Feather name="arrow-up" size={16} color={colors.onAccent} />
                    </View>
                  </PressableScale>
                </Animated.View>
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  idle: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xxxl,
    gap: space.xxxl,
  },
  idleText: {
    gap: space.md,
  },
  suggestions: {
    gap: space.sm + 2,
    alignItems: 'stretch',
  },
  answerContent: {
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
  },
  answerText: {
    marginTop: space.lg,
  },
  interrupted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  result: {
    marginTop: space.xxl,
    gap: space.xl,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flexWrap: 'wrap',
  },
  modeBadge: {
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
  sources: {
    gap: space.sm,
  },
  askAnotherWrap: {
    alignItems: 'center',
    marginTop: space.sm,
  },
  askAnother: {
    paddingHorizontal: space.xl,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: {
    paddingHorizontal: space.xxl,
    paddingTop: space.sm,
  },
  inputPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.xs + 2,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
  },
  inputText: {
    flex: 1,
    padding: 0,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
});
