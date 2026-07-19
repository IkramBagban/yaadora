import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { enqueueMemory } from '../../src/capture/outbox';
import { useOutbox } from '../../src/capture/useOutbox';
import { useRecentMemories } from '../../src/capture/useRecentMemories';
import { AppText } from '../../src/components/AppText';
import { DebugErrorChip } from '../../src/components/DebugErrorChip';
import { MemoryRow } from '../../src/components/MemoryRow';
import { PressableScale } from '../../src/components/PressableScale';
import { StatusPill } from '../../src/components/StatusPill';
import { Toast } from '../../src/components/Toast';
import { todayHeading } from '../../src/lib/time';
import { useKeyboardVisible } from '../../src/lib/useKeyboardVisible';
import { durations, springs } from '../../src/theme/motion';
import { fonts, radius, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const PROMPTS = [
  'What happened today?',
  'What do you want to remember?',
  'Something worth keeping…',
];

const EDITOR_FONT = {
  fontFamily: fonts.sans,
  fontSize: 22,
  lineHeight: 32,
  letterSpacing: -0.2,
} as const;

/** Tab-bar clearance so content never hides behind the floating pill. */
const TAB_BAR_CLEARANCE = 88;

/**
 * Capture — the home screen and the sacred fast path. Saving writes to the
 * local outbox synchronously and animates the text "committing" away; the
 * network is never on the critical path.
 */
export default function CaptureScreen() {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();

  const [text, setText] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [buttonFlash, setButtonFlash] = useState(false);
  const [placeholder] = useState(
    () => PROMPTS[Math.floor(Math.random() * PROMPTS.length)]!,
  );

  const inputRef = useRef<TextInput>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useSharedValue(0);

  const showRecent = !keyboardVisible && text.length === 0;
  const recent = useRecentMemories(showRecent);
  const { items, blockedError, lastErrorDetails } = useOutbox();
  const lastError = items[0]?.lastError;
  const [errorDismissed, setErrorDismissed] = useState(false);

  // Reset dismiss when a new error arrives
  const errorKey = lastError ?? blockedError ?? null;
  useEffect(() => {
    if (errorKey) setErrorDismissed(false);
  }, [errorKey]);

  // Focus after the screen transition settles, so the keyboard doesn't jank it.
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const editorStyle = useAnimatedStyle(() => ({
    opacity: 1 - commit.value,
    transform: [{ translateY: commit.value * 12 }],
  }));

  const save = () => {
    const value = text.trim();
    if (!value) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    enqueueMemory(value);

    // The words settle downward — deposited — then the page is blank again.
    commit.value = withTiming(1, { duration: durations.fade });
    setTimeout(() => {
      setText('');
      commit.value = withSpring(0, springs.gentle);
    }, durations.fade + 10);

    setToastVisible(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastVisible(false), 1600);

    setButtonFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setButtonFlash(false), 900);

    inputRef.current?.focus();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screen}
      >
        <View style={[styles.content, { paddingTop: insets.top + space.md }]}>
          <View style={styles.header}>
            <AppText variant="micro" tone="ink3">
              {todayHeading()}
            </AppText>
            <View style={styles.headerRight}>
              <StatusPill />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="View all memories"
                onPress={() => router.push('/timeline')}
                hitSlop={12}
              >
                <Feather name="clock" size={18} color={colors.ink2} />
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Account"
                onPress={() => router.push('/profile' as Href)}
                hitSlop={12}
              >
                <Feather name="user" size={18} color={colors.ink2} />
              </PressableScale>
            </View>
          </View>

          <Animated.View style={[styles.editor, editorStyle]}>
            {!errorDismissed && (blockedError || lastError) && (
              <DebugErrorChip
                message={blockedError || lastError!}
                details={lastErrorDetails}
                onDismiss={() => setErrorDismissed(true)}
              />
            )}
            {text.length === 0 && (
              <Animated.View
                pointerEvents="none"
                exiting={FadeOut.duration(durations.quick)}
                style={styles.placeholder}
              >
                <AppText style={[EDITOR_FONT, { color: colors.ink3 }]}>
                  {placeholder}
                </AppText>
              </Animated.View>
            )}
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              multiline
              keyboardAppearance={dark ? 'dark' : 'light'}
              selectionColor={colors.accent}
              cursorColor={colors.accent}
              style={[styles.input, EDITOR_FONT, { color: colors.ink }]}
              accessibilityLabel="New memory"
            />
          </Animated.View>

          {showRecent && recent.length > 0 && (
            <Animated.View
              entering={FadeIn.duration(durations.enter)}
              exiting={FadeOut.duration(durations.quick)}
              style={styles.recent}
            >
              <View style={styles.recentHeader}>
                <AppText variant="micro" tone="ink3">
                  Recent
                </AppText>
                <PressableScale
                  onPress={() => router.push('/timeline')}
                  hitSlop={10}
                >
                  <AppText variant="captionMedium" tone="accent">
                    View all →
                  </AppText>
                </PressableScale>
              </View>
              {recent.map((row) => (
                <MemoryRow
                  key={row.key}
                  compact
                  text={row.text}
                  timestamp={row.timestamp}
                  status={row.status}
                  onPress={
                    row.id
                      ? () => router.push({ pathname: '/memory/[id]', params: { id: row.id! } })
                      : undefined
                  }
                />
              ))}
            </Animated.View>
          )}

          <View
            style={[
              styles.saveRow,
              {
                paddingBottom: keyboardVisible
                  ? space.md
                  : insets.bottom + TAB_BAR_CLEARANCE,
              },
            ]}
          >
            {text.length > 0 ? (
              <Animated.View
                entering={FadeIn.duration(durations.fade)}
                exiting={FadeOut.duration(durations.quick)}
              >
                <AppText variant="caption" tone="ink3">
                  {text.length}
                </AppText>
              </Animated.View>
            ) : (
              <View />
            )}
            <SaveButton
              disabled={text.trim().length === 0}
              flash={buttonFlash}
              onPress={save}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      <View
        pointerEvents="none"
        style={[styles.toastWrap, { top: insets.top + space.sm }]}
      >
        {toastVisible && <Toast label="Saved" />}
      </View>
    </View>
  );
}

function SaveButton({
  disabled,
  flash,
  onPress,
}: {
  disabled: boolean;
  flash: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Save memory"
      disabled={disabled}
      onPress={onPress}
      scaleTo={0.94}
      style={[styles.saveButton, { backgroundColor: colors.accent }]}
    >
      <View style={[styles.saveInner, { opacity: disabled ? 0.45 : 1 }]}>
        {flash ? (
          <Animated.View entering={ZoomIn.springify().damping(16).stiffness(280)}>
            <Feather name="check" size={17} color={colors.onAccent} />
          </Animated.View>
        ) : (
          <AppText variant="captionMedium" tone="onAccent">
            Save
          </AppText>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: space.xxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  editor: {
    flex: 1,
    paddingTop: space.xxl,
  },
  placeholder: {
    position: 'absolute',
    top: space.xxl,
    left: 0,
    right: 0,
  },
  input: {
    flex: 1,
    padding: 0,
    paddingTop: 0,
    textAlignVertical: 'top',
  },
  recent: {
    paddingBottom: space.sm,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.xs,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.md,
  },
  saveButton: {
    width: 84,
    height: 44,
    borderRadius: radius.pill,
  },
  saveInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
