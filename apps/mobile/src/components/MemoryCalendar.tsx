import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import type { Memory } from '../api/types';
import { durations } from '../theme/motion';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { MemoryRow } from './MemoryRow';
import { PressableScale } from './PressableScale';

interface MemoryCalendarProps {
  memories: Memory[];
  /** More pages exist beyond what's loaded (older months may be incomplete). */
  hasMore: boolean;
  /** Ask the owner to load another page (called while browsing older months). */
  onNeedOlder: () => void;
  onOpenMemory: (id: string) => void;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function monthTitle(d: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/**
 * A month of your memories. Days that hold memories carry a dot (stronger =
 * more of them); tapping a day pulls that day's memories up under the grid.
 * Browsing into months older than what's loaded quietly pages more in.
 */
export function MemoryCalendar({
  memories,
  hasMore,
  onNeedOlder,
  onOpenMemory,
}: MemoryCalendarProps) {
  const { colors } = useTheme();
  const now = new Date();
  const [month, setMonth] = useState(
    () => new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const [selected, setSelected] = useState<string | null>(dayKey(now));

  const byDay = useMemo(() => {
    const map = new Map<string, Memory[]>();
    for (const m of memories) {
      const key = dayKey(new Date(m.occurredAt ?? m.createdAt));
      const list = map.get(key);
      if (list) list.push(m);
      else map.set(key, [m]);
    }
    return map;
  }, [memories]);

  // While the visible month reaches past what's loaded, pull older pages in.
  const monthStart = month.getTime();
  useEffect(() => {
    const oldest = memories.length
      ? new Date(memories[memories.length - 1]!.createdAt).getTime()
      : null;
    if (hasMore && oldest !== null && oldest > monthStart) {
      onNeedOlder();
    }
  }, [hasMore, monthStart, onNeedOlder, memories]);

  const weeks = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysInMonth = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [month]);

  const isCurrentMonth =
    month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const todayKey = dayKey(now);
  const selectedMemories = selected ? (byDay.get(selected) ?? []) : [];

  const shiftMonth = (delta: number) => {
    void Haptics.selectionAsync();
    setSelected(null);
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };

  const weekdayLabels = useMemo(() => {
    const base = new Date(2024, 8, 1); // a Sunday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
        .toLocaleDateString(undefined, { weekday: 'narrow' }),
    );
  }, []);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View
        entering={FadeIn.duration(durations.enter)}
        style={styles.monthBar}
      >
        <PressableScale onPress={() => shiftMonth(-1)} hitSlop={10} style={styles.chev}>
          <Feather name="chevron-left" size={18} color={colors.ink2} />
        </PressableScale>
        <AppText variant="title">{monthTitle(month)}</AppText>
        <PressableScale
          onPress={() => shiftMonth(1)}
          hitSlop={10}
          disabled={isCurrentMonth}
          style={[styles.chev, isCurrentMonth && styles.chevDisabled]}
        >
          <Feather name="chevron-right" size={18} color={colors.ink2} />
        </PressableScale>
      </Animated.View>

      <View style={styles.weekdays}>
        {weekdayLabels.map((label, i) => (
          <AppText key={i} variant="caption" tone="ink3" style={styles.weekday} align="center">
            {label}
          </AppText>
        ))}
      </View>

      <View>
        {weeks.map((week, wi) => (
          <View key={wi} style={styles.week}>
            {week.map((date, di) => {
              if (!date) return <View key={di} style={styles.day} />;
              const key = dayKey(date);
              const count = byDay.get(key)?.length ?? 0;
              const isSelected = selected === key;
              const isToday = key === todayKey;
              const inFuture = date.getTime() > now.getTime();
              return (
                <PressableScale
                  key={di}
                  disabled={inFuture}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setSelected((cur) => (cur === key ? null : key));
                  }}
                  style={styles.day}
                >
                  <View
                    style={[
                      styles.dayInner,
                      isSelected && { backgroundColor: colors.accent },
                      !isSelected && isToday && {
                        borderWidth: 1,
                        borderColor: colors.accent,
                      },
                    ]}
                  >
                    <AppText
                      variant="sub"
                      tone={isSelected ? 'onAccent' : inFuture ? 'ink3' : 'ink'}
                      style={inFuture && styles.futureDay}
                    >
                      {date.getDate()}
                    </AppText>
                    <View
                      style={[
                        styles.dot,
                        count > 0 && {
                          backgroundColor: isSelected ? colors.onAccent : colors.accent,
                          opacity: isSelected ? 1 : Math.min(0.35 + count * 0.2, 1),
                        },
                      ]}
                    />
                  </View>
                </PressableScale>
              );
            })}
          </View>
        ))}
      </View>

      <Animated.View layout={LinearTransition.springify().damping(20).stiffness(220)} style={styles.dayFeed}>
        {selected && (
          <>
            <AppText variant="micro" tone="ink3">
              {selectedMemories.length === 0
                ? 'Nothing on this day'
                : selectedMemories.length === 1
                  ? '1 memory'
                  : `${selectedMemories.length} memories`}
            </AppText>
            {selectedMemories.map((m, i) => (
              <Animated.View
                key={m.id}
                entering={FadeInDown.delay(Math.min(i, 8) * 40).duration(durations.enter)}
              >
                <MemoryRow
                  text={m.rawText}
                  timestamp={m.createdAt}
                  status={m.status}
                  onPress={() => onOpenMemory(m.id)}
                />
              </Animated.View>
            ))}
          </>
        )}
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: space.md,
    paddingBottom: space.huge,
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.lg,
  },
  chev: {
    padding: space.xs,
  },
  chevDisabled: {
    opacity: 0.3,
  },
  weekdays: {
    flexDirection: 'row',
    paddingBottom: space.sm,
  },
  weekday: {
    flex: 1,
  },
  week: {
    flexDirection: 'row',
  },
  day: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 2,
  },
  dayInner: {
    width: 40,
    height: 46,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  futureDay: {
    opacity: 0.4,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  dayFeed: {
    paddingTop: space.xl,
    gap: space.md,
  },
});
