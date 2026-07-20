import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { durations, springs } from '../theme/motion';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { useVoiceCapture, type VoiceCapture } from '../voice/useVoiceCapture';

/**
 * The mic button — one tap to start, one to stop. Shared by Add and Ask.
 *
 * Transcribed text is handed to the parent to put in its input, never saved
 * directly: the user proofreads before it becomes a memory. That edit step is
 * the only correction mechanism, since no audio is kept.
 */

const BAR_COUNT = 4;

export interface VoiceInputProps {
  /** Final transcript. Parent appends it to the input. */
  onTranscript: (text: string) => void;
  /** Live partial text (device engine only). Parent may preview it. */
  onInterim?: (text: string) => void;
  /** Hide/disable the mic (e.g. while an Ask answer is streaming). */
  disabled?: boolean;
  size?: number;
}

export function VoiceInput({
  onTranscript,
  onInterim,
  disabled = false,
  size = 44,
}: VoiceInputProps) {
  const voice = useVoiceCapture({ onTranscript, onInterim });

  return (
    <VoiceButton voice={voice} disabled={disabled} size={size} />
  );
}

/**
 * Split out so a screen that needs the capture state itself (e.g. to dim its
 * editor while recording) can drive the same button from its own hook instance.
 */
export function VoiceButton({
  voice,
  disabled = false,
  size = 44,
}: {
  voice: VoiceCapture;
  disabled?: boolean;
  size?: number;
}) {
  const { colors } = useTheme();
  const { status, level, isActive } = voice;

  const pulse = useSharedValue(0);

  useEffect(() => {
    if (status === 'recording') {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 700 }),
          withTiming(0, { duration: 700 }),
        ),
        -1,
        true,
      );
    } else {
      pulse.value = withTiming(0, { duration: durations.fade });
    }
  }, [status, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: pulse.value * 0.35,
    transform: [{ scale: 1 + pulse.value * 0.35 }],
  }));

  const busy = status === 'transcribing';
  const recording = status === 'recording';

  const label = recording
    ? 'Stop recording'
    : busy
      ? 'Transcribing'
      : 'Record a memory';

  const onPress = () => {
    if (disabled || busy) return;
    if (recording) voice.stop();
    else voice.start();
  };

  return (
    <View style={styles.wrap}>
      {voice.error && (
        <Animated.View
          entering={FadeIn.duration(durations.fade)}
          exiting={FadeOut.duration(durations.quick)}
          style={[styles.errorChip, { backgroundColor: colors.surfaceAlt }]}
        >
          <AppText variant="caption" tone="ink2">
            {voice.error}
          </AppText>
        </Animated.View>
      )}

      {recording && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              width: size,
              height: size,
              borderRadius: radius.pill,
              backgroundColor: colors.accent,
            },
            haloStyle,
          ]}
        />
      )}

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || busy, busy }}
        disabled={disabled || busy}
        onPress={onPress}
        scaleTo={0.92}
        hitSlop={10}
        style={[
          styles.button,
          {
            width: size,
            height: size,
            borderRadius: radius.pill,
            backgroundColor: recording ? colors.accent : colors.surfaceAlt,
            opacity: disabled ? 0.4 : 1,
          },
        ]}
      >
        {recording ? (
          <Waveform level={level} color={colors.onAccent} />
        ) : busy ? (
          <TranscribingDots color={colors.ink2} />
        ) : (
          <Feather name="mic" size={19} color={colors.ink2} />
        )}
      </PressableScale>

      {isActive && (
        <Animated.View
          entering={FadeIn.duration(durations.fade)}
          exiting={FadeOut.duration(durations.quick)}
          style={styles.hint}
        >
          <AppText variant="caption" tone="ink3">
            {recording
              ? voice.engine === 'device'
                ? 'Listening · on-device'
                : 'Listening'
              : 'Writing it down…'}
          </AppText>
        </Animated.View>
      )}
    </View>
  );
}

/** Four bars that ride the mic level — enough to feel alive, cheap to run. */
function Waveform({ level, color }: { level: number; color: string }) {
  return (
    <View style={styles.waveform}>
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <WaveBar key={i} level={level} color={color} index={i} />
      ))}
    </View>
  );
}

function WaveBar({
  level,
  color,
  index,
}: {
  level: number;
  color: string;
  index: number;
}) {
  const height = useSharedValue(4);

  useEffect(() => {
    // Outer bars lag the centre slightly so it reads as a wave, not a meter.
    const weight = index === 0 || index === BAR_COUNT - 1 ? 0.6 : 1;
    const target = 4 + level * 14 * weight;
    height.value = withSpring(target, springs.snappy);
  }, [level, index, height]);

  const style = useAnimatedStyle(() => ({ height: height.value }));

  return (
    <Animated.View
      style={[styles.waveBar, { backgroundColor: color }, style]}
    />
  );
}

/** Three dots that breathe while the upload round-trips. */
function TranscribingDots({ color }: { color: string }) {
  return (
    <View style={styles.waveform}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} color={color} delay={i * 140} />
      ))}
    </View>
  );
}

function Dot({ color, delay }: { color: string; delay: number }) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    const timer = setTimeout(() => {
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 420 }),
          withTiming(0.3, { duration: 420 }),
        ),
        -1,
        true,
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [delay, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
  },
  waveBar: {
    width: 3,
    borderRadius: radius.pill,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: radius.pill,
  },
  hint: {
    position: 'absolute',
    bottom: -18,
    width: 160,
    alignItems: 'center',
  },
  errorChip: {
    position: 'absolute',
    bottom: 54,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    maxWidth: 260,
  },
});
