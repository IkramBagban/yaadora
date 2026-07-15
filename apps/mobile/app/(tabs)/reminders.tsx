import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';
import type { Reminder } from '../../src/api/types';
import { AppText } from '../../src/components/AppText';
import { EmptyState } from '../../src/components/EmptyState';
import { PressableScale } from '../../src/components/PressableScale';
import {
  ReminderComposer,
  type ComposerTarget,
} from '../../src/components/ReminderComposer';
import { useReminders } from '../../src/reminders/useReminders';
import {
  ensureNotificationPermission,
  hasNotificationPermission,
} from '../../src/lib/notifications';
import { dueCountdown, dueGroup, dueLabel, recurrenceBadge } from '../../src/lib/time';
import { staggerMs } from '../../src/theme/motion';
import { hairlineWidth, radius, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const TAB_BAR_CLEARANCE = 88;

const GROUP_ORDER = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later', 'Someday'];

function groupUpcoming(items: Reminder[]): { label: string; items: Reminder[] }[] {
  const buckets = new Map<string, Reminder[]>();
  for (const r of items) {
    const g = dueGroup(r.dueAt);
    (buckets.get(g) ?? buckets.set(g, []).get(g)!).push(r);
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((label) => ({
    label,
    items: buckets.get(label)!,
  }));
}

export default function RemindersScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    upcoming,
    suggested,
    loading,
    error,
    refreshing,
    refresh,
    create,
    update,
    accept,
    dismissSuggestion,
    complete,
    cancel,
  } = useReminders();

  const [notifsOn, setNotifsOn] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ComposerTarget | null>(null);

  const openCreate = () => {
    void Haptics.selectionAsync();
    setEditTarget(null);
    setComposerOpen(true);
  };
  const openEdit = (r: Reminder) => {
    void Haptics.selectionAsync();
    setEditTarget({
      id: r.id,
      text: r.text,
      dueAt: r.dueAt,
      recurrence: r.recurrence,
      weekdays: r.weekdays,
    });
    setComposerOpen(true);
  };
  useEffect(() => {
    void hasNotificationPermission().then(setNotifsOn);
  }, [upcoming.length, suggested.length]);

  const groups = useMemo(() => groupUpcoming(upcoming), [upcoming]);
  const isEmpty = !loading && upcoming.length === 0 && suggested.length === 0;

  const enableNotifs = async () => {
    void Haptics.selectionAsync();
    const ok = await ensureNotificationPermission();
    setNotifsOn(ok);
    if (ok) refresh();
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + space.xl,
            paddingBottom: TAB_BAR_CLEARANCE + space.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.ink3}
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <AppText variant="display">Reminders</AppText>
            {upcoming.length > 0 ? (
              <AppText variant="sub" tone="ink3">
                {upcoming.length} coming up
              </AppText>
            ) : null}
          </View>
          <PressableScale
            onPress={openCreate}
            accessibilityLabel="New reminder"
            style={[styles.addFab, { backgroundColor: colors.accent }]}
          >
            <Feather name="plus" size={20} color={colors.onAccent} />
          </PressableScale>
        </View>

        {!notifsOn ? (
          <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)}>
            <PressableScale
              onPress={enableNotifs}
              style={[
                styles.banner,
                { backgroundColor: colors.accentSoft, borderColor: colors.hairline },
              ]}
            >
              <Feather name="bell" size={16} color={colors.accent} />
              <View style={styles.bannerText}>
                <AppText variant="captionMedium" tone="ink">
                  Turn on notifications
                </AppText>
                <AppText variant="caption" tone="ink2">
                  So your reminders can actually reach you.
                </AppText>
              </View>
              <AppText variant="captionMedium" tone="accent">
                Enable
              </AppText>
            </PressableScale>
          </Animated.View>
        ) : null}

        {suggested.length > 0 ? (
          <View style={styles.section}>
            <AppText variant="micro" tone="ink3" style={styles.sectionLabel}>
              Suggested for you
            </AppText>
            {suggested.map((r, i) => (
              <SuggestedCard
                key={r.id}
                reminder={r}
                index={i}
                onAdd={() => {
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  void accept(r.id);
                }}
                onDismiss={() => {
                  void Haptics.selectionAsync();
                  void dismissSuggestion(r.id);
                }}
              />
            ))}
          </View>
        ) : null}

        {groups.map((group) => (
          <View key={group.label} style={styles.section}>
            <AppText
              variant="micro"
              tone={group.label === 'Overdue' ? 'danger' : 'ink3'}
              style={styles.sectionLabel}
            >
              {group.label}
            </AppText>
            {group.items.map((r, i) => (
              <ReminderCard
                key={r.id}
                reminder={r}
                index={i}
                overdue={group.label === 'Overdue'}
                onEdit={() => openEdit(r)}
                onComplete={() => {
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  void complete(r.id);
                }}
                onCancel={() => {
                  void Haptics.selectionAsync();
                  void cancel(r.id);
                }}
              />
            ))}
          </View>
        ))}

        {isEmpty ? (
          <EmptyState
            icon="bell"
            title="Nothing to remember yet"
            caption="Ask me to remind you, or I'll offer when you mention a plan."
          />
        ) : null}

        {error ? (
          <AppText variant="caption" tone="danger" align="center" style={styles.error}>
            {error}
          </AppText>
        ) : null}
      </ScrollView>

      <ReminderComposer
        visible={composerOpen}
        target={editTarget}
        onClose={() => setComposerOpen(false)}
        onCreate={create}
        onUpdate={update}
      />
    </View>
  );
}

/** An upcoming reminder: tap the circle to complete, ✕ to cancel. */
function ReminderCard({
  reminder,
  index,
  overdue,
  onEdit,
  onComplete,
  onCancel,
}: {
  reminder: Reminder;
  index: number;
  overdue: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const badge = recurrenceBadge(reminder);
  return (
    <Animated.View
      entering={FadeInDown.delay(index * staggerMs).springify().damping(18).stiffness(220)}
      exiting={FadeOut.duration(180)}
      layout={LinearTransition.springify().damping(20).stiffness(220)}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.hairline }]}
    >
      <PressableScale
        onPress={onComplete}
        hitSlop={8}
        accessibilityLabel="Mark done"
        style={[styles.check, { borderColor: colors.ink3 }]}
      />
      <PressableScale
        onPress={onEdit}
        accessibilityLabel="Edit reminder"
        style={styles.cardBody}
      >
        <AppText variant="serifBody" tone="ink" numberOfLines={3}>
          {reminder.text}
        </AppText>
        <View style={styles.metaRow}>
          <Feather name="clock" size={12} color={overdue ? colors.danger : colors.ink3} />
          <AppText variant="caption" tone={overdue ? 'danger' : 'ink2'}>
            {dueLabel(reminder.dueAt)}
          </AppText>
          <AppText variant="caption" tone="ink3">
            · {dueCountdown(reminder.dueAt)}
          </AppText>
          {badge ? (
            <View style={[styles.recBadge, { backgroundColor: colors.accentSoft }]}>
              <Feather name="repeat" size={10} color={colors.accent} />
              <AppText variant="micro" tone="accent">
                {badge}
              </AppText>
            </View>
          ) : null}
        </View>
      </PressableScale>
      <PressableScale
        onPress={onCancel}
        hitSlop={10}
        accessibilityLabel="Cancel reminder"
        style={styles.iconBtn}
      >
        <Feather name="x" size={16} color={colors.ink3} />
      </PressableScale>
    </Animated.View>
  );
}

/** A pipeline-proposed reminder awaiting one tap. */
function SuggestedCard({
  reminder,
  index,
  onAdd,
  onDismiss,
}: {
  reminder: Reminder;
  index: number;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={FadeInDown.delay(index * staggerMs).springify().damping(18).stiffness(220)}
      exiting={FadeOut.duration(180)}
      layout={LinearTransition.springify().damping(20).stiffness(220)}
      style={[
        styles.card,
        styles.suggestCard,
        { backgroundColor: colors.surface, borderColor: colors.accentSoft },
      ]}
    >
      <View style={styles.cardBody}>
        <View style={styles.suggestTag}>
          <Feather name="zap" size={11} color={colors.accent} />
          <AppText variant="micro" tone="accent">
            Suggested
          </AppText>
        </View>
        <AppText variant="serifBody" tone="ink" numberOfLines={3}>
          {reminder.text}
        </AppText>
        <View style={styles.metaRow}>
          <Feather name="clock" size={12} color={colors.ink3} />
          <AppText variant="caption" tone="ink2">
            {dueLabel(reminder.dueAt)}
          </AppText>
        </View>
        <View style={styles.suggestActions}>
          <PressableScale
            onPress={onAdd}
            style={[styles.addBtn, { backgroundColor: colors.accent }]}
          >
            <Feather name="bell" size={14} color={colors.onAccent} />
            <AppText variant="captionMedium" tone="onAccent">
              Remind me
            </AppText>
          </PressableScale>
          <PressableScale onPress={onDismiss} hitSlop={8} style={styles.dismissBtn}>
            <AppText variant="captionMedium" tone="ink3">
              Dismiss
            </AppText>
          </PressableScale>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: space.xl, gap: space.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerText: { gap: space.xs },
  addFab: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: hairlineWidth,
  },
  bannerText: { flex: 1, gap: 1 },
  section: { gap: space.sm },
  sectionLabel: { marginLeft: space.xs, marginBottom: space.xs },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: hairlineWidth,
  },
  suggestCard: { alignItems: 'stretch' },
  cardBody: { flex: 1, gap: space.sm - 2 },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 'auto',
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  iconBtn: { padding: space.xs },
  suggestTag: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  suggestActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xs,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm - 2,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 1,
    borderRadius: radius.pill,
  },
  dismissBtn: { paddingHorizontal: space.sm, paddingVertical: space.sm },
  error: { marginTop: space.lg },
});
