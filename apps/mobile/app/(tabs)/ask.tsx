import { useCallback, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { enqueueMemory } from '../../src/capture/outbox';
import { useAskSession } from '../../src/ask/useAskSession';
import { AppText } from '../../src/components/AppText';
import { AskExchange } from '../../src/components/AskExchange';
import { PressableScale } from '../../src/components/PressableScale';
import { SuggestionChip } from '../../src/components/SuggestionChip';
import { Toast } from '../../src/components/Toast';
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
const NEAR_BOTTOM = 96;

/**
 * Ask — a conversation with your memory. Multi-turn follow-ups, a live thinking
 * trace, and AI-asks-back clarification. Turns are durable server-side via
 * conversationId; the UI session still starts fresh each launch.
 */
export default function AskScreen() {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const followRef = useRef(true);

  const [draft, setDraft] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { exchanges, streaming, send, retry, cancel, reset } = useAskSession();
  const hasSession = exchanges.length > 0;

  const submit = (value?: string) => {
    const q = (value ?? draft).trim();
    if (!q || streaming) return;
    void Haptics.selectionAsync();
    Keyboard.dismiss();
    setDraft('');
    followRef.current = true;
    send(q);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  const newConversation = () => {
    void Haptics.selectionAsync();
    Keyboard.dismiss();
    reset();
    setDraft('');
  };

  const saveQuestion = (text: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    enqueueMemory(text);
    setToastVisible(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 1600);
  };

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    // Once the user scrolls up mid-stream, stop auto-following until they return.
    followRef.current = distance < NEAR_BOTTOM;
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (streaming && followRef.current) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [streaming]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <View style={[styles.screen, { paddingTop: insets.top + space.md }]}>
          {hasSession && (
            <Animated.View
              entering={FadeIn.duration(durations.fade)}
              style={[styles.topBar, { paddingHorizontal: space.xxl }]}
            >
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="New conversation"
                onPress={newConversation}
                hitSlop={12}
                style={styles.newButton}
              >
                <Feather name="edit" size={18} color={colors.ink2} />
              </PressableScale>
            </Animated.View>
          )}

          {!hasSession ? (
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
              contentContainerStyle={styles.feed}
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              scrollEventThrottle={64}
              onContentSizeChange={onContentSizeChange}
            >
              {exchanges.map((exchange, i) => (
                <AskExchange
                  key={exchange.id}
                  exchange={exchange}
                  dim={i !== exchanges.length - 1}
                  showRule={i > 0}
                  onRetry={() => retry(exchange.id)}
                  onSaveQuestion={() => saveQuestion(exchange.question)}
                  onQuickReply={(text) => submit(text)}
                />
              ))}
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
                placeholder={hasSession ? 'Ask a follow-up…' : 'Ask anything…'}
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
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: hairlineWidth,
                      borderColor: colors.hairline,
                    },
                  ]}
                >
                  <View style={[styles.stopSquare, { backgroundColor: colors.ink2 }]} />
                </PressableScale>
              ) : (
                <Animated.View
                  entering={FadeIn.duration(durations.quick)}
                  exiting={FadeOut.duration(durations.quick)}
                >
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

      <View pointerEvents="none" style={[styles.toastWrap, { top: insets.top + space.sm }]}>
        {toastVisible && <Toast label="Saved as memory" />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    minHeight: 28,
  },
  newButton: {
    padding: space.xs,
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
  feed: {
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
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
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
