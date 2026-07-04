import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { api } from '../api/client';
import type { Reminder, ReminderSuggestion } from '../api/types';
import {
  cancelScheduled,
  ensureNotificationPermission,
  scheduleReminder,
} from '../lib/notifications';
import { dueLabel } from '../lib/time';
import { durations } from '../theme/motion';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

type State = 'idle' | 'saving' | 'saved' | 'hidden';

/**
 * The live reminder chip inside an Ask turn. The server proposed a time-bound
 * action; one tap saves it (and schedules the on-device notification), with an
 * immediate Undo. Dismissing costs nothing — it was never persisted.
 */
export function ReminderChip({ suggestion }: { suggestion: ReminderSuggestion }) {
  const { colors } = useTheme();
  const [state, setState] = useState<State>('idle');
  const [saved, setSaved] = useState<Reminder | null>(null);

  if (state === 'hidden') return null;

  const save = async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setState('saving');
    try {
      const reminder = await api.confirmReminder({
        text: suggestion.text,
        dueAt: suggestion.dueAt,
        sourceMemoryId: suggestion.sourceMemoryId,
        origin: 'suggested',
      });
      setSaved(reminder);
      setState('saved');
      void ensureNotificationPermission().then(() => scheduleReminder(reminder));
    } catch {
      setState('idle'); // let them try again
    }
  };

  const undo = async () => {
    void Haptics.selectionAsync();
    setState('hidden');
    if (saved) {
      void cancelScheduled(saved.id);
      try {
        await api.cancelReminder(saved.id);
      } catch {
        /* best-effort */
      }
    }
  };

  const dismiss = () => {
    void Haptics.selectionAsync();
    setState('hidden');
  };

  if (state === 'saved') {
    return (
      <Animated.View
        entering={FadeIn.duration(durations.fade)}
        style={[styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline }]}
      >
        <Feather name="check-circle" size={15} color={colors.success} />
        <AppText variant="captionMedium" tone="ink2" style={styles.grow}>
          Reminder set · {dueLabel(suggestion.dueAt)}
        </AppText>
        <PressableScale onPress={undo} hitSlop={8} style={styles.textBtn}>
          <AppText variant="captionMedium" tone="ink3">
            Undo
          </AppText>
        </PressableScale>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={FadeIn.duration(durations.fade)}
      exiting={FadeOut.duration(160)}
      style={[styles.chip, { backgroundColor: colors.accentSoft, borderColor: colors.hairline }]}
    >
      <Feather name="bell" size={15} color={colors.accent} />
      <View style={styles.grow}>
        <AppText variant="captionMedium" tone="ink" numberOfLines={1}>
          {suggestion.text}
        </AppText>
        <AppText variant="caption" tone="ink2">
          {dueLabel(suggestion.dueAt)}
        </AppText>
      </View>
      <PressableScale
        onPress={save}
        disabled={state === 'saving'}
        style={[styles.saveBtn, { backgroundColor: colors.accent }]}
      >
        <AppText variant="captionMedium" tone="onAccent">
          {state === 'saving' ? 'Saving…' : 'Remind me'}
        </AppText>
      </PressableScale>
      <PressableScale onPress={dismiss} hitSlop={8} style={styles.textBtn}>
        <Feather name="x" size={15} color={colors.ink3} />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 2,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: hairlineWidth,
  },
  grow: { flex: 1, gap: 1 },
  saveBtn: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm - 1,
    borderRadius: radius.pill,
  },
  textBtn: { padding: space.xs },
});
