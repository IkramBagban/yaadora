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
import { dueLabel } from '../lib/time';
import { fonts, hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

export interface ComposerTarget {
  id: string;
  text: string;
  dueAt: string;
}

interface ReminderComposerProps {
  visible: boolean;
  /** When set, the composer edits this reminder; otherwise it creates a new one. */
  target?: ComposerTarget | null;
  onClose: () => void;
  onCreate: (text: string, dueAt: string) => Promise<unknown>;
  onUpdate: (id: string, patch: { text: string; dueAt: string }) => Promise<unknown>;
}

interface Preset {
  key: string;
  label: string;
  iso: string;
}

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

/**
 * Create or edit a reminder. Quick relative presets ("In 1 hour", "Tomorrow
 * 9 AM") resolve to absolute times on the device — no date-picker dependency,
 * one tap to a sensible time. Arbitrary times ("at 5:37 pm") are best set by
 * just asking in the Ask tab.
 */
export function ReminderComposer({
  visible,
  target,
  onClose,
  onCreate,
  onUpdate,
}: ReminderComposerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const editing = Boolean(target);

  const presets = useMemo(() => buildPresets(new Date()), [visible]);
  const [text, setText] = useState('');
  const [dueIso, setDueIso] = useState<string>(presets[0]!.iso);
  const [saving, setSaving] = useState(false);

  // Reset each time the sheet opens, seeding from the edit target if present.
  useEffect(() => {
    if (!visible) return;
    setText(target?.text ?? '');
    setDueIso(target?.dueAt ?? presets[0]!.iso);
    setSaving(false);
  }, [visible, target, presets]);

  // In edit mode, offer the existing time as a selectable chip up front.
  const options: Preset[] = useMemo(() => {
    if (target && !presets.some((p) => p.iso === target.dueAt)) {
      return [{ key: 'current', label: 'Keep current', iso: target.dueAt }, ...presets];
    }
    return presets;
  }, [presets, target]);

  const canSave = text.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(true);
    try {
      if (target) await onUpdate(target.id, { text: text.trim(), dueAt: dueIso });
      else await onCreate(text.trim(), dueIso);
      onClose();
    } catch {
      setSaving(false);
    }
  };

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

              <AppText variant="micro" tone="ink3">
                When
              </AppText>
              <View style={styles.presets}>
                {options.map((p) => {
                  const selected = p.iso === dueIso;
                  return (
                    <PressableScale
                      key={p.key}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setDueIso(p.iso);
                      }}
                      style={[
                        styles.preset,
                        {
                          backgroundColor: selected ? colors.accent : colors.surfaceAlt,
                          borderColor: selected ? colors.accent : colors.hairline,
                        },
                      ]}
                    >
                      <AppText variant="captionMedium" tone={selected ? 'onAccent' : 'ink2'}>
                        {p.label}
                      </AppText>
                    </PressableScale>
                  );
                })}
              </View>

              <View style={[styles.chosen, { borderColor: colors.hairline }]}>
                <AppText variant="caption" tone="ink3">
                  Reminds you
                </AppText>
                <AppText variant="captionMedium" tone="accent">
                  {dueLabel(dueIso)}
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
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  preset: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
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
