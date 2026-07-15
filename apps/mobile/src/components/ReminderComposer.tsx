import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import type { Recurrence } from '../api/types';
import { dueLabel, recurrenceLabel } from '../lib/time';
import { fonts, hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

export interface ComposerTarget {
  id: string;
  text: string;
  dueAt: string;
  recurrence: Recurrence;
  weekdays: number[] | null;
}

/** What the composer emits on save. `weekdays` is null unless `recurrence` is 'weekly'. */
export interface ComposerSubmit {
  text: string;
  dueAt: string;
  recurrence: Recurrence;
  weekdays: number[] | null;
}

interface ReminderComposerProps {
  visible: boolean;
  /** When set, the composer edits this reminder; otherwise it creates a new one. */
  target?: ComposerTarget | null;
  onClose: () => void;
  onCreate: (input: ComposerSubmit) => Promise<unknown>;
  onUpdate: (id: string, patch: ComposerSubmit) => Promise<unknown>;
}

interface Preset {
  key: string;
  label: string;
  iso: string;
}

/** Weekday chip letters, indexed by JS `Date.getDay()` (0 = Sunday … 6 = Saturday). */
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const MODES: { key: Recurrence; label: string }[] = [
  { key: 'once', label: 'Once' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
];

function atHour(base: Date, hour: number): Date {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function buildPresets(now: Date): Preset[] {
  const tomorrow = new Date(now.getTime() + 86_400_000);
  let evening = atHour(now, 18);
  if (evening.getTime() <= now.getTime() + 300_000) evening = atHour(tomorrow, 18);
  return [
    { key: '1h', label: 'In 1 hour', iso: new Date(now.getTime() + 3_600_000).toISOString() },
    { key: '3h', label: 'In 3 hours', iso: new Date(now.getTime() + 10_800_000).toISOString() },
    { key: 'eve', label: 'This evening', iso: evening.toISOString() },
    { key: 'tmr9', label: 'Tomorrow 9 AM', iso: atHour(tomorrow, 9).toISOString() },
    { key: 'tmr18', label: 'Tomorrow evening', iso: atHour(tomorrow, 18).toISOString() },
    {
      key: 'wk',
      label: 'Next week',
      iso: atHour(new Date(now.getTime() + 7 * 86_400_000), 9).toISOString(),
    },
  ];
}

/** A friendly default time-of-day carrier for daily/weekly (today at 9:00 AM). */
function defaultTimeOfDay(): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d;
}

/** The next moment (today, else tomorrow) whose clock time matches `time`. */
function nextDailyOccurrence(time: Date, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** The soonest upcoming day in `weekdays` at `time`'s clock time. */
function nextWeeklyOccurrence(time: Date, weekdays: number[], now: Date = new Date()): Date {
  for (let add = 0; add < 8; add++) {
    const d = new Date(now);
    d.setDate(now.getDate() + add);
    d.setHours(time.getHours(), time.getMinutes(), 0, 0);
    if (weekdays.includes(d.getDay()) && d.getTime() > now.getTime()) return d;
  }
  // No weekday chosen yet — fall back to a same-time-today carrier.
  return nextDailyOccurrence(time, now);
}

/**
 * Create or edit a reminder. A segmented control switches between one-shot,
 * daily, and weekly schedules; a native date/time picker sets exact moments
 * while quick presets keep the fast one-shot path one tap away.
 */
export function ReminderComposer({
  visible,
  target,
  onClose,
  onCreate,
  onUpdate,
}: ReminderComposerProps) {
  const { colors, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const editing = Boolean(target);

  const presets = useMemo(() => buildPresets(new Date()), [visible]);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Recurrence>('once');
  const [onceIso, setOnceIso] = useState<string>(presets[0]!.iso);
  const [timeValue, setTimeValue] = useState<Date>(defaultTimeOfDay);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  // Native picker control. `pickerMode` mounts the picker (a dialog on Android,
  // an inline spinner on iOS). `pickerFor` records what it's editing; `draft`
  // holds the in-progress value across the once date→time steps.
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | 'datetime' | null>(null);
  const [pickerFor, setPickerFor] = useState<'once' | 'time'>('once');
  const [draft, setDraft] = useState<Date>(() => new Date());

  // Reset each time the sheet opens, seeding from the edit target if present.
  useEffect(() => {
    if (!visible) return;
    const rec = target?.recurrence ?? 'once';
    setText(target?.text ?? '');
    setMode(rec);
    setOnceIso(target && rec === 'once' ? target.dueAt : presets[0]!.iso);
    setTimeValue(
      target && (rec === 'daily' || rec === 'weekly')
        ? new Date(target.dueAt)
        : defaultTimeOfDay(),
    );
    setWeekdays(target?.weekdays ?? []);
    setSaving(false);
    setPickerMode(null);
  }, [visible, target, presets]);

  // The concrete dueAt for the current selection: exact for once, otherwise the
  // next occurrence carrying the chosen clock time.
  const dueAt = useMemo(() => {
    if (mode === 'once') return onceIso;
    if (mode === 'daily') return nextDailyOccurrence(timeValue).toISOString();
    return nextWeeklyOccurrence(timeValue, weekdays).toISOString();
  }, [mode, onceIso, timeValue, weekdays]);

  // In edit mode, offer the existing one-shot time as a selectable chip up front.
  const options: Preset[] = useMemo(() => {
    if (target?.recurrence === 'once' && !presets.some((p) => p.iso === target.dueAt)) {
      return [{ key: 'current', label: 'Keep current', iso: target.dueAt }, ...presets];
    }
    return presets;
  }, [presets, target]);

  const weeklyReady = mode !== 'weekly' || weekdays.length > 0;
  const canSave = text.trim().length > 0 && weeklyReady && !saving;

  const summary =
    mode === 'weekly' && weekdays.length === 0
      ? 'Pick at least one day'
      : (recurrenceLabel({ recurrence: mode, weekdays, dueAt }) ?? dueLabel(onceIso));

  const timeText = timeValue.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  const openOncePicker = () => {
    void Haptics.selectionAsync();
    setPickerFor('once');
    setDraft(new Date(onceIso));
    setPickerMode(Platform.OS === 'ios' ? 'datetime' : 'date');
  };

  const openTimePicker = () => {
    void Haptics.selectionAsync();
    setPickerFor('time');
    setDraft(timeValue);
    setPickerMode('time');
  };

  const commitPicked = (value: Date) => {
    if (pickerFor === 'once') setOnceIso(value.toISOString());
    else setTimeValue(value);
  };

  // Android surfaces a dialog and reports 'set'/'dismissed' imperatively; iOS
  // renders inline and streams changes, so we commit there via the Done button.
  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type !== 'set' || !selected) {
        setPickerMode(null);
        return;
      }
      // Once needs a second (time) step after the date dialog closes.
      if (pickerFor === 'once' && pickerMode === 'date') {
        setDraft(selected);
        setPickerMode('time');
        return;
      }
      setPickerMode(null);
      commitPicked(selected);
      return;
    }
    if (selected) setDraft(selected);
  };

  const closeIosPicker = () => {
    commitPicked(draft);
    setPickerMode(null);
  };

  const toggleWeekday = (day: number) => {
    void Haptics.selectionAsync();
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const save = async () => {
    if (!canSave) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(true);
    const payload: ComposerSubmit = {
      text: text.trim(),
      dueAt,
      recurrence: mode,
      weekdays: mode === 'weekly' ? [...weekdays].sort((a, b) => a - b) : null,
    };
    try {
      if (target) await onUpdate(target.id, payload);
      else await onCreate(payload);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  const onceCustom = mode === 'once' && !options.some((p) => p.iso === onceIso);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          // stop taps inside the sheet from closing it
          onPress={(e) => e.stopPropagation()}
          style={styles.sheetWrap}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.hairline,
                  paddingBottom: insets.bottom + space.lg,
                },
              ]}
            >
              <View style={[styles.handle, { backgroundColor: colors.hairline }]} />
              <AppText variant="title">{editing ? 'Edit reminder' : 'New reminder'}</AppText>

              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Remind me to…"
                placeholderTextColor={colors.ink3}
                multiline
                autoFocus={!editing}
                style={[styles.input, { color: colors.ink }]}
              />

              {/* Once / Daily / Weekly */}
              <View style={[styles.segment, { backgroundColor: colors.surfaceAlt }]}>
                {MODES.map((m) => {
                  const active = mode === m.key;
                  return (
                    <PressableScale
                      key={m.key}
                      scaleTo={0.98}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setMode(m.key);
                      }}
                      style={[
                        styles.segmentItem,
                        active && {
                          backgroundColor: colors.surface,
                          borderColor: colors.hairline,
                        },
                      ]}
                    >
                      <AppText variant="captionMedium" tone={active ? 'ink' : 'ink3'}>
                        {m.label}
                      </AppText>
                    </PressableScale>
                  );
                })}
              </View>

              {mode === 'once' ? (
                <>
                  <AppText variant="micro" tone="ink3">
                    When
                  </AppText>
                  <View style={styles.presets}>
                    {options.map((p) => {
                      const selected = p.iso === onceIso;
                      return (
                        <PressableScale
                          key={p.key}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setOnceIso(p.iso);
                          }}
                          style={[
                            styles.preset,
                            {
                              backgroundColor: selected ? colors.accent : colors.surfaceAlt,
                              borderColor: selected ? colors.accent : colors.hairline,
                            },
                          ]}
                        >
                          <AppText
                            variant="captionMedium"
                            tone={selected ? 'onAccent' : 'ink2'}
                          >
                            {p.label}
                          </AppText>
                        </PressableScale>
                      );
                    })}
                  </View>
                  <PressableScale
                    onPress={openOncePicker}
                    style={[styles.pickRow, { borderColor: colors.hairline }]}
                  >
                    <View style={styles.pickRowLeft}>
                      <Feather name="calendar" size={16} color={colors.ink2} />
                      <AppText variant="captionMedium" tone="ink2">
                        Pick date &amp; time
                      </AppText>
                    </View>
                    <AppText variant="captionMedium" tone={onceCustom ? 'accent' : 'ink3'}>
                      {dueLabel(onceIso)}
                    </AppText>
                  </PressableScale>
                </>
              ) : null}

              {mode === 'weekly' ? (
                <>
                  <AppText variant="micro" tone="ink3">
                    Repeat on
                  </AppText>
                  <View style={styles.weekRow}>
                    {WEEKDAY_LETTERS.map((letter, day) => {
                      const selected = weekdays.includes(day);
                      return (
                        <PressableScale
                          key={day}
                          scaleTo={0.94}
                          onPress={() => toggleWeekday(day)}
                          accessibilityLabel={`Toggle weekday ${day}`}
                          style={[
                            styles.weekChip,
                            {
                              backgroundColor: selected ? colors.accent : colors.surfaceAlt,
                              borderColor: selected ? colors.accent : colors.hairline,
                            },
                          ]}
                        >
                          <AppText
                            variant="captionMedium"
                            tone={selected ? 'onAccent' : 'ink2'}
                          >
                            {letter}
                          </AppText>
                        </PressableScale>
                      );
                    })}
                  </View>
                </>
              ) : null}

              {mode !== 'once' ? (
                <PressableScale
                  onPress={openTimePicker}
                  style={[styles.pickRow, { borderColor: colors.hairline }]}
                >
                  <View style={styles.pickRowLeft}>
                    <Feather name="clock" size={16} color={colors.ink2} />
                    <AppText variant="captionMedium" tone="ink2">
                      {mode === 'daily' ? 'Every day at' : 'At'}
                    </AppText>
                  </View>
                  <AppText variant="captionMedium" tone="accent">
                    {timeText}
                  </AppText>
                </PressableScale>
              ) : null}

              {pickerMode ? (
                Platform.OS === 'ios' ? (
                  <View style={[styles.iosPicker, { borderColor: colors.hairline }]}>
                    <DateTimePicker
                      value={draft}
                      mode={pickerMode}
                      display="spinner"
                      themeVariant={dark ? 'dark' : 'light'}
                      minimumDate={pickerFor === 'once' ? new Date() : undefined}
                      onChange={handlePickerChange}
                    />
                    <PressableScale
                      onPress={closeIosPicker}
                      style={[styles.doneBtn, { backgroundColor: colors.surfaceAlt }]}
                    >
                      <AppText variant="captionMedium" tone="accent">
                        Done
                      </AppText>
                    </PressableScale>
                  </View>
                ) : (
                  <DateTimePicker
                    value={draft}
                    mode={pickerMode === 'datetime' ? 'date' : pickerMode}
                    minimumDate={pickerFor === 'once' ? new Date() : undefined}
                    onChange={handlePickerChange}
                  />
                )
              ) : null}

              <View style={[styles.chosen, { borderColor: colors.hairline }]}>
                <AppText variant="caption" tone="ink3">
                  Reminds you
                </AppText>
                <AppText variant="captionMedium" tone="accent">
                  {summary}
                </AppText>
              </View>

              <View style={styles.actions}>
                <PressableScale onPress={onClose} style={styles.cancelBtn}>
                  <AppText variant="captionMedium" tone="ink3">
                    Cancel
                  </AppText>
                </PressableScale>
                <PressableScale
                  onPress={save}
                  disabled={!canSave}
                  style={[
                    styles.saveBtn,
                    { backgroundColor: canSave ? colors.accent : colors.surfaceAlt },
                  ]}
                >
                  <AppText variant="captionMedium" tone={canSave ? 'onAccent' : 'ink3'}>
                    {saving ? 'Saving…' : editing ? 'Save changes' : 'Set reminder'}
                  </AppText>
                </PressableScale>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { width: '100%' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: hairlineWidth,
    borderLeftWidth: hairlineWidth,
    borderRightWidth: hairlineWidth,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    gap: space.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    marginBottom: space.sm,
  },
  input: {
    fontFamily: fonts.serif,
    fontSize: 22,
    lineHeight: 30,
    minHeight: 60,
    paddingVertical: space.sm,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
    borderColor: 'transparent',
  },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  preset: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
  },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.xs },
  weekChip: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: hairlineWidth,
  },
  pickRowLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  iosPicker: {
    borderRadius: radius.md,
    borderWidth: hairlineWidth,
    paddingBottom: space.sm,
  },
  doneBtn: {
    alignSelf: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  chosen: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space.md,
    borderTopWidth: hairlineWidth,
    borderBottomWidth: hairlineWidth,
  },
  actions: { flexDirection: 'row', gap: space.md, marginTop: space.xs },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    borderRadius: radius.pill,
  },
  saveBtn: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    borderRadius: radius.pill,
  },
});
