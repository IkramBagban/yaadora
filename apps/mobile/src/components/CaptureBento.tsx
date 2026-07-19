import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { api } from '../api/client';
import type { Reminder } from '../api/types';
import type { RecentRow } from '../capture/useRecentMemories';
import { dueLabel, relativeTime } from '../lib/time';
import { durations } from '../theme/motion';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

const H_PADDING = space.xxl;
const GAP = space.sm;
const MAX_RECORDS = 2;
const MAX_SUGGESTIONS = 1;

type Tile =
  | { key: string; kind: 'suggestion'; reminder: Reminder }
  | { key: string; kind: 'reminder'; reminder: Reminder }
  | { key: string; kind: 'memory'; row: RecentRow };

/**
 * A short, intentional dashboard for the Capture screen. Its hierarchy is
 * stable: the closest commitment first, one considered nudge, then records.
 * It never turns the fast capture surface into a second feed.
 */
export function CaptureBento({ recent }: { recent: RecentRow[] }) {
  const { colors } = useTheme();
  const { width: screenW } = useWindowDimensions();
  const [suggestions, setSuggestions] = useState<Reminder[]>([]);
  const [nextReminder, setNextReminder] = useState<Reminder | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([
      api.listReminders('suggested'),
      api.listReminders('upcoming'),
    ]).then(([suggested, upcoming]) => {
      if (!alive) return;
      if (suggested.status === 'fulfilled') setSuggestions(suggested.value.items);
      if (upcoming.status === 'fulfilled') setNextReminder(upcoming.value.items[0] ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const fullWidth = screenW - H_PADDING * 2;
  const halfWidth = (fullWidth - GAP) / 2;
  const primaryWidth = Math.round((fullWidth - GAP) * 0.59);
  const secondaryWidth = fullWidth - GAP - primaryWidth;

  const tiles = useMemo(() => {
    const shelf: Tile[] = [];
    if (nextReminder && !removed.has(nextReminder.id)) {
      shelf.push({ key: `rem-${nextReminder.id}`, kind: 'reminder', reminder: nextReminder });
    }

    const suggestion = suggestions
      .filter((item) => !removed.has(item.id))
      .slice(0, MAX_SUGGESTIONS)[0];
    if (suggestion) {
      shelf.push({ key: `sug-${suggestion.id}`, kind: 'suggestion', reminder: suggestion });
    }

    shelf.push(
      ...recent.slice(0, MAX_RECORDS).map((row) => ({
        key: `mem-${row.key}`,
        kind: 'memory' as const,
        row,
      })),
    );
    return shelf;
  }, [nextReminder, recent, removed, suggestions]);

  if (tiles.length === 0) return null;

  const hasReminderAndSuggestion =
    tiles[0]?.kind === 'reminder' && tiles[1]?.kind === 'suggestion';
  const recordCount = tiles.filter((tile) => tile.kind === 'memory').length;
  const tileWidth = (tile: Tile) => {
    if (tile.kind === 'reminder') return hasReminderAndSuggestion ? primaryWidth : fullWidth;
    if (tile.kind === 'suggestion') return hasReminderAndSuggestion ? secondaryWidth : fullWidth;
    return recordCount === 1 ? fullWidth : halfWidth;
  };

  const hide = (id: string) => {
    setRemoved((previous) => new Set(previous).add(id));
  };

  const accept = (id: string) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    hide(id);
    api.acceptSuggestion(id).catch(() => {
      setRemoved((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    });
  };

  const dismiss = (id: string) => {
    void Haptics.selectionAsync();
    hide(id);
    api.cancelReminder(id).catch(() => {
      setRemoved((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    });
  };

  return (
    <Animated.View
      style={styles.wrap}
      layout={LinearTransition.springify().damping(20).stiffness(240)}
    >
      <View style={styles.header}>
        <AppText variant="micro" tone="ink3">
          Today at a glance
        </AppText>
        <PressableScale onPress={() => router.push('/timeline')} hitSlop={10}>
          <AppText variant="captionMedium" tone="accent">
            All records
          </AppText>
        </PressableScale>
      </View>

      <View style={styles.grid}>
        {tiles.map((tile, index) => (
          <Animated.View
            key={tile.key}
            entering={FadeInDown.delay(Math.min(index, 5) * 55)
              .duration(durations.enter)
              .springify()
              .damping(18)}
            layout={LinearTransition.springify().damping(20).stiffness(240)}
            style={{ width: tileWidth(tile) }}
          >
            <TileCard
              tile={tile}
              colors={colors}
              onAccept={accept}
              onDismiss={dismiss}
            />
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

function TileCard({
  tile,
  colors,
  onAccept,
  onDismiss,
}: {
  tile: Tile;
  colors: ReturnType<typeof useTheme>['colors'];
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (tile.kind === 'suggestion') {
    const reminder = tile.reminder;
    return (
      <View
        style={[
          styles.tile,
          styles.suggestionTile,
          { backgroundColor: colors.accentSoft, borderColor: colors.hairline },
        ]}
      >
        <View style={styles.tileTop}>
          <View style={styles.suggestionMark}>
            <Feather name="bell" size={13} color={colors.accent} />
          </View>
          <AppText variant="micro" tone="accent" numberOfLines={1}>
            Suggested
          </AppText>
        </View>
        <AppText variant="sub" numberOfLines={3} style={styles.suggestionBody}>
          {reminder.text}
        </AppText>
        <View style={styles.actions}>
          <PressableScale
            accessibilityLabel="Dismiss suggestion"
            onPress={() => onDismiss(reminder.id)}
            hitSlop={8}
            style={[styles.iconBtn, { borderColor: colors.hairline }]}
          >
            <Feather name="x" size={15} color={colors.ink3} />
          </PressableScale>
          <PressableScale
            accessibilityLabel="Add suggested reminder"
            onPress={() => onAccept(reminder.id)}
            hitSlop={8}
            style={[styles.acceptBtn, { backgroundColor: colors.accent }]}
          >
            <AppText variant="captionMedium" tone="onAccent">
              Add
            </AppText>
          </PressableScale>
        </View>
      </View>
    );
  }

  if (tile.kind === 'reminder') {
    const reminder = tile.reminder;
    return (
      <PressableScale
        scaleTo={0.97}
        onPress={() => router.push('/(tabs)/reminders')}
        style={[styles.tile, styles.reminderTile, { backgroundColor: colors.accent }]}
      >
        <View style={styles.reminderTop}>
          <View style={styles.reminderIcon}>
            <Feather name="clock" size={15} color={colors.accent} />
          </View>
          <AppText variant="micro" tone="onAccent">
            Up next
          </AppText>
        </View>
        <AppText variant="title" tone="onAccent" numberOfLines={2} style={styles.reminderBody}>
          {reminder.text}
        </AppText>
        <AppText variant="captionMedium" tone="onAccent" style={styles.reminderDue}>
          {dueLabel(reminder.dueAt)}
        </AppText>
      </PressableScale>
    );
  }

  const record = tile.row;
  return (
    <PressableScale
      scaleTo={0.97}
      disabled={!record.id}
      onPress={
        record.id
          ? () => router.push({ pathname: '/memory/[id]', params: { id: record.id! } })
          : undefined
      }
      style={[
        styles.tile,
        styles.recordTile,
        { backgroundColor: colors.surface, borderColor: colors.hairline },
      ]}
    >
      <View style={styles.tileTop}>
        <Feather name="bookmark" size={13} color={colors.ink3} />
        <AppText variant="micro" tone="ink3">
          {record.status === 'local' ? 'Saving record' : relativeTime(record.timestamp)}
        </AppText>
      </View>
      <AppText variant="sub" numberOfLines={3} style={styles.tileBody}>
        {record.text}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: {
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: hairlineWidth,
    gap: space.sm,
  },
  reminderTile: { minHeight: 132, justifyContent: 'space-between' },
  suggestionTile: { minHeight: 132 },
  recordTile: { minHeight: 104 },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  tileBody: { flex: 1 },
  suggestionMark: {
    width: 23,
    height: 23,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(156, 82, 39, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionBody: { flex: 1 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    height: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderTop: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  reminderIcon: {
    width: 25,
    height: 25,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(253, 251, 248, 0.92)',
  },
  reminderBody: { flex: 1 },
  reminderDue: { opacity: 0.82 },
});
