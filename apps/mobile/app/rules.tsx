import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { api, ApiError } from '../src/api/client';
import type { StandingRule } from '../src/api/types';
import { AppText } from '../src/components/AppText';
import { EmptyState } from '../src/components/EmptyState';
import { ModalHeader } from '../src/components/ModalHeader';
import { PressableScale } from '../src/components/PressableScale';
import { relativeTime } from '../src/lib/time';
import { createMobileLogger } from '../src/lib/log';
import { hairlineWidth, radius, space } from '../src/theme/tokens';
import { useTheme } from '../src/theme/useTheme';

const log = createMobileLogger('rules');

/**
 * Standing rules screen (spec 02 §8, P1).
 * List, toggle active, edit-as-correction (server creates a new row).
 */
export default function RulesScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [rules, setRules] = useState<StandingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<StandingRule | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await api.listRules();
      setRules(res.rules);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not load rules.';
      log.warn('listRules failed', { message });
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  const toggleActive = async (rule: StandingRule, active: boolean) => {
    void Haptics.selectionAsync();
    // Optimistic
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, active } : r)),
    );
    try {
      const updated = await api.patchRule(rule.id, { active });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (err) {
      log.warn('toggle failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, active: rule.active } : r)),
      );
    }
  };

  const onSaved = (updated: StandingRule, previousId: string) => {
    setRules((prev) => {
      // Edit-as-correction may return a new id; drop the old superseded row.
      const withoutOld = prev.filter(
        (r) => r.id !== previousId && r.id !== updated.id,
      );
      return [updated, ...withoutOld].sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return 0;
      });
    });
    setEditTarget(null);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={{ paddingTop: insets.top }}>
        <ModalHeader title="Rules" />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + space.xxxl },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              tintColor={colors.ink3}
            />
          }
        >
          <AppText variant="sub" tone="ink3" style={styles.intro}>
            Standing rules shape how Yaadora answers when the task matches —
            like reviewing a post before you publish.
          </AppText>

          {error ? (
            <AppText variant="caption" tone="danger" style={styles.error}>
              {error}
            </AppText>
          ) : null}

          {rules.length === 0 && !error ? (
            <EmptyState
              title="No standing rules yet"
              caption="Save a rule from Add — “when I post on X, check…” — and it will show up here."
            />
          ) : (
            <View style={styles.list}>
              {rules.map((rule, i) => (
                <Animated.View
                  key={rule.id}
                  entering={FadeInDown.delay(i * 40)
                    .springify()
                    .damping(18)
                    .stiffness(220)}
                  layout={LinearTransition.springify().damping(20).stiffness(240)}
                >
                  <RuleCard
                    rule={rule}
                    onToggle={(active) => void toggleActive(rule, active)}
                    onEdit={() => {
                      void Haptics.selectionAsync();
                      setEditTarget(rule);
                    }}
                  />
                </Animated.View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <EditRuleModal
        rule={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={onSaved}
      />
    </View>
  );
}

function RuleCard({
  rule,
  onToggle,
  onEdit,
}: {
  rule: StandingRule;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
}) {
  const { colors } = useTheme();
  const applied =
    rule.appliedCount === 0
      ? 'Not applied yet'
      : `Applied ${rule.appliedCount} time${rule.appliedCount === 1 ? '' : 's'}`;
  const last =
    rule.lastAppliedAt != null
      ? ` · last ${relativeTime(rule.lastAppliedAt)}`
      : '';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.hairline,
          opacity: rule.active ? 1 : 0.72,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardTitleRow}>
          <Feather
            name="bookmark"
            size={16}
            color={rule.active ? colors.accent : colors.ink3}
          />
          <AppText variant="micro" tone={rule.active ? 'accent' : 'ink3'}>
            {rule.active ? 'Active' : 'Paused'}
          </AppText>
        </View>
        <Switch
          value={rule.active}
          onValueChange={onToggle}
          trackColor={{ false: colors.surfaceAlt, true: colors.accentSoft }}
          thumbColor={rule.active ? colors.accent : colors.ink3}
          ios_backgroundColor={colors.surfaceAlt}
        />
      </View>

      <AppText variant="body" tone="ink" style={styles.ruleText}>
        {rule.ruleText}
      </AppText>

      <AppText variant="caption" tone="ink3" style={styles.trigger}>
        When: {rule.triggerText}
      </AppText>

      <View style={styles.cardFooter}>
        <AppText variant="caption" tone="ink3" style={styles.meta}>
          {applied}
          {last}
        </AppText>
        <PressableScale
          onPress={onEdit}
          hitSlop={8}
          accessibilityLabel="Edit rule"
          style={styles.editBtn}
        >
          <Feather name="edit-2" size={14} color={colors.ink2} />
          <AppText variant="captionMedium" tone="ink2">
            Edit
          </AppText>
        </PressableScale>
      </View>
    </View>
  );
}

function EditRuleModal({
  rule,
  onClose,
  onSaved,
}: {
  rule: StandingRule | null;
  onClose: () => void;
  onSaved: (updated: StandingRule, previousId: string) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [ruleText, setRuleText] = useState('');
  const [triggerText, setTriggerText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rule) {
      setRuleText(rule.ruleText);
      setTriggerText(rule.triggerText);
      setError(null);
    }
  }, [rule]);

  const save = async () => {
    if (!rule) return;
    const nextRule = ruleText.trim();
    const nextTrigger = triggerText.trim();
    if (!nextRule || !nextTrigger) {
      setError('Rule text and situation are both required.');
      return;
    }
    if (nextRule === rule.ruleText && nextTrigger === rule.triggerText) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch: { ruleText?: string; triggerText?: string } = {};
      if (nextRule !== rule.ruleText) patch.ruleText = nextRule;
      if (nextTrigger !== rule.triggerText) patch.triggerText = nextTrigger;
      const updated = await api.patchRule(rule.id, patch);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(updated, rule.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={rule != null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modal, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <View style={styles.modalHeader}>
          <AppText variant="title">Edit rule</AppText>
          <PressableScale onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Feather name="x" size={22} color={colors.ink2} />
          </PressableScale>
        </View>

        <AppText variant="caption" tone="ink3" style={styles.modalHint}>
          Saving creates a corrected version and keeps the old one for provenance —
          the original text is never rewritten.
        </AppText>

        <AppText variant="micro" tone="ink3" style={styles.fieldLabel}>
          Rule
        </AppText>
        <TextInput
          value={ruleText}
          onChangeText={setRuleText}
          multiline
          textAlignVertical="top"
          style={[
            styles.input,
            styles.inputTall,
            {
              color: colors.ink,
              backgroundColor: colors.surface,
              borderColor: colors.hairline,
            },
          ]}
          placeholderTextColor={colors.ink3}
        />

        <AppText variant="micro" tone="ink3" style={styles.fieldLabel}>
          When (situation)
        </AppText>
        <TextInput
          value={triggerText}
          onChangeText={setTriggerText}
          multiline
          textAlignVertical="top"
          style={[
            styles.input,
            {
              color: colors.ink,
              backgroundColor: colors.surface,
              borderColor: colors.hairline,
            },
          ]}
          placeholderTextColor={colors.ink3}
        />

        {error ? (
          <AppText variant="caption" tone="danger" style={styles.error}>
            {error}
          </AppText>
        ) : null}

        <PressableScale
          onPress={() => void save()}
          disabled={saving}
          style={[
            styles.saveBtn,
            {
              backgroundColor: colors.accent,
              opacity: saving ? 0.7 : 1,
            },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <AppText variant="captionMedium" style={{ color: colors.onAccent }}>
              Save correction
            </AppText>
          )}
        </PressableScale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: space.lg,
  },
  intro: {
    marginBottom: space.lg,
  },
  error: {
    marginBottom: space.md,
  },
  list: {
    gap: space.md,
  },
  card: {
    borderWidth: hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  ruleText: {
    marginTop: space.xs,
  },
  trigger: {
    marginTop: space.xs,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  meta: {
    flex: 1,
    marginRight: space.md,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  modal: {
    flex: 1,
    paddingHorizontal: space.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
  },
  modalHint: {
    marginBottom: space.lg,
  },
  fieldLabel: {
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  input: {
    borderWidth: hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 72,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: space.lg,
  },
  inputTall: {
    minHeight: 140,
  },
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: space.md,
    minHeight: 48,
    marginTop: space.sm,
  },
});
