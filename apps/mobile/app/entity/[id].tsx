import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { api, ApiError } from '../../src/api/client';
import type {
  EntityContextEdge,
  EntityContextFact,
  EntityContextLoop,
  EntityContextPayload,
} from '../../src/api/types';
import { AppText } from '../../src/components/AppText';
import { EmptyState } from '../../src/components/EmptyState';
import { ErrorState } from '../../src/components/ErrorState';
import { ModalHeader } from '../../src/components/ModalHeader';
import { PressableScale } from '../../src/components/PressableScale';
import { Skeleton } from '../../src/components/Skeleton';
import { createMobileLogger } from '../../src/lib/log';
import { relativeTime } from '../../src/lib/time';
import { hairlineWidth, radius, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

const log = createMobileLogger('entity');

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * Entity page (spec 03 P3): a person or project — profile, current facts, open
 * threads, and relationships, each with tappable receipts to the source
 * memories. "This is wrong" on a fact writes a CORRECTION MEMORY (never edits
 * facts directly); "wrong person" on an edge flags the bad link.
 */
export default function EntityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<EntityContextPayload | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [correctFact, setCorrectFact] = useState<EntityContextFact | null>(null);
  const [flaggedEdgeIds, setFlaggedEdgeIds] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!id) return;
      if (mode === 'refresh') setRefreshing(true);
      else setStatus('loading');
      try {
        const res = await api.getEntityContext(id);
        setData(res);
        setStatus('ready');
      } catch (err) {
        log.warn('getEntityContext failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        setStatus('error');
      } finally {
        setRefreshing(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const openReceipt = (memoryId: string | undefined) => {
    if (!memoryId) return;
    void Haptics.selectionAsync();
    router.push({ pathname: '/memory/[id]', params: { id: memoryId } });
  };

  const flagEdge = async (edge: EntityContextEdge) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    // Optimistic: drop it from view immediately.
    setFlaggedEdgeIds((prev) => new Set(prev).add(edge.id));
    try {
      await api.flagEntityEdge(edge.id);
    } catch (err) {
      log.warn('flagEntityEdge failed', {
        message: err instanceof Error ? err.message : String(err),
      });
      setFlaggedEdgeIds((prev) => {
        const next = new Set(prev);
        next.delete(edge.id);
        return next;
      });
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={{ paddingTop: insets.top }}>
        <ModalHeader title={data?.entity.canonicalName ?? 'Details'} />
      </View>

      {status === 'loading' ? (
        <View style={styles.skeletons}>
          <Skeleton width="70%" height={20} />
          <Skeleton width="90%" height={16} />
          <Skeleton width="82%" height={16} />
        </View>
      ) : status === 'error' ? (
        <ErrorState
          title="Can't open this page"
          caption="Your memories are safe — try again in a moment."
          onRetry={() => void load('initial')}
        />
      ) : data ? (
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
          <AppText variant="micro" tone="ink3" style={styles.typeLabel}>
            {data.entity.type}
          </AppText>

          {data.profile ? (
            <AppText variant="body" tone="ink" style={styles.profile}>
              {data.profile}
            </AppText>
          ) : (
            <AppText variant="sub" tone="ink3" style={styles.profile}>
              No profile summary yet — it fills in as you capture more.
            </AppText>
          )}

          {data.openLoops.length > 0 && (
            <Section title="Open threads">
              {data.openLoops.map((loop) => (
                <LoopRow key={loop.id} loop={loop} onReceipt={openReceipt} />
              ))}
            </Section>
          )}

          {data.facts.length > 0 && (
            <Section title="What I know">
              {data.facts.map((fact) => (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  onReceipt={openReceipt}
                  onCorrect={() => {
                    void Haptics.selectionAsync();
                    setCorrectFact(fact);
                  }}
                />
              ))}
            </Section>
          )}

          {data.edges.filter((e) => !flaggedEdgeIds.has(e.id)).length > 0 && (
            <Section title="Connections">
              {data.edges
                .filter((e) => !flaggedEdgeIds.has(e.id))
                .map((edge) => (
                  <EdgeRow
                    key={edge.id}
                    edge={edge}
                    onReceipt={openReceipt}
                    onOpenOther={() => {
                      if (!edge.otherIsKnownEntity) return;
                      void Haptics.selectionAsync();
                      router.push({
                        pathname: '/entity/[id]',
                        params: { id: edge.otherId },
                      });
                    }}
                    onFlag={() => void flagEdge(edge)}
                  />
                ))}
            </Section>
          )}

          {data.openLoops.length === 0 &&
            data.facts.length === 0 &&
            data.edges.length === 0 && (
              <EmptyState
                title="Nothing derived yet"
                caption="Capture more about them and their profile, facts, and connections will appear here."
              />
            )}
        </ScrollView>
      ) : null}

      <CorrectFactModal
        fact={correctFact}
        entityName={data?.entity.canonicalName ?? ''}
        onClose={() => setCorrectFact(null)}
        onSaved={() => {
          setCorrectFact(null);
          // Correction is async (ingestion supersedes the index); refresh soon.
          setTimeout(() => void load('refresh'), 600);
        }}
      />
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <AppText variant="micro" tone="ink3" style={styles.sectionTitle}>
        {title}
      </AppText>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function statusColor(status: string, colors: ReturnType<typeof useTheme>['colors']) {
  if (status === 'unresolved') return colors.pending;
  if (status === 'ended') return colors.ink3;
  return colors.success;
}

function statusLabel(status: string): string {
  if (status === 'unresolved') return 'unresolved';
  if (status === 'ended') return 'ended';
  return 'active';
}

function LoopRow({
  loop,
  onReceipt,
}: {
  loop: EntityContextLoop;
  onReceipt: (memoryId: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeInDown.springify().damping(18).stiffness(220)}>
      <PressableScale
        onPress={() => onReceipt(loop.sourceMemory)}
        style={[styles.row, { borderColor: colors.hairline }]}
      >
        <Feather name="git-branch" size={14} color={colors.accent} />
        <View style={styles.rowBody}>
          <AppText variant="sub" tone="ink">
            {loop.title}
          </AppText>
          <AppText variant="caption" tone="ink3">
            {loop.kind.replace(/_/g, ' ')}
            {loop.dueAt ? ` · due ${relativeTime(loop.dueAt)}` : ''} · tap for source
          </AppText>
        </View>
        <Feather name="chevron-right" size={16} color={colors.ink3} />
      </PressableScale>
    </Animated.View>
  );
}

function FactRow({
  fact,
  onReceipt,
  onCorrect,
}: {
  fact: EntityContextFact;
  onReceipt: (memoryId: string) => void;
  onCorrect: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderColor: colors.hairline }]}>
      <View style={styles.rowBody}>
        <AppText variant="sub" tone="ink">
          {fact.factText}
        </AppText>
        <View style={styles.factActions}>
          <PressableScale
            onPress={() => onReceipt(fact.sourceMemory)}
            hitSlop={8}
            style={styles.linkBtn}
          >
            <Feather name="file-text" size={12} color={colors.ink2} />
            <AppText variant="caption" tone="ink2">
              Source
            </AppText>
          </PressableScale>
          <PressableScale
            onPress={onCorrect}
            hitSlop={8}
            style={styles.linkBtn}
            accessibilityLabel="This is wrong"
          >
            <Feather name="flag" size={12} color={colors.ink3} />
            <AppText variant="caption" tone="ink3">
              This is wrong
            </AppText>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

function EdgeRow({
  edge,
  onReceipt,
  onOpenOther,
  onFlag,
}: {
  edge: EntityContextEdge;
  onReceipt: (memoryId: string) => void;
  onOpenOther: () => void;
  onFlag: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderColor: colors.hairline }]}>
      <View style={styles.rowBody}>
        <PressableScale onPress={onOpenOther} disabled={!edge.otherIsKnownEntity}>
          <AppText variant="sub" tone="ink">
            {edge.relType}{' '}
            <AppText variant="sub" tone={edge.otherIsKnownEntity ? 'accent' : 'ink'}>
              {edge.otherName}
            </AppText>
          </AppText>
        </PressableScale>
        <View style={styles.edgeMetaRow}>
          <View style={styles.statusChip}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: statusColor(edge.status, colors) },
              ]}
            />
            <AppText variant="caption" tone="ink3">
              {statusLabel(edge.status)}
            </AppText>
          </View>
          {edge.lastMentioned ? (
            <AppText variant="caption" tone="ink3">
              · last {relativeTime(edge.lastMentioned)}
            </AppText>
          ) : null}
        </View>
        <View style={styles.factActions}>
          {edge.evidence.length > 0 && (
            <PressableScale
              onPress={() => onReceipt(edge.evidence[0]!)}
              hitSlop={8}
              style={styles.linkBtn}
            >
              <Feather name="file-text" size={12} color={colors.ink2} />
              <AppText variant="caption" tone="ink2">
                Source
              </AppText>
            </PressableScale>
          )}
          <PressableScale
            onPress={onFlag}
            hitSlop={8}
            style={styles.linkBtn}
            accessibilityLabel="Wrong person"
          >
            <Feather name="alert-circle" size={12} color={colors.ink3} />
            <AppText variant="caption" tone="ink3">
              Wrong link?
            </AppText>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

function CorrectFactModal({
  fact,
  entityName,
  onClose,
  onSaved,
}: {
  fact: EntityContextFact | null;
  entityName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fact) {
      setText('');
      setError(null);
    }
  }, [fact]);

  const save = async () => {
    const correction = text.trim();
    if (!correction) {
      setError('Write the correct version so I can update it.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // A correction is a NEW raw memory (source 'manual'); ingestion's
      // supersession fixes the fact index. Facts are never edited directly.
      await api.createMemory({ rawText: correction, source: 'manual' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={fact != null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modal, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
        <View style={styles.modalHeader}>
          <AppText variant="title">Set this straight</AppText>
          <PressableScale onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Feather name="x" size={22} color={colors.ink2} />
          </PressableScale>
        </View>

        {fact ? (
          <View
            style={[
              styles.currentFact,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
            ]}
          >
            <AppText variant="caption" tone="ink3">
              Currently
            </AppText>
            <AppText variant="sub" tone="ink2">
              {fact.factText}
            </AppText>
          </View>
        ) : null}

        <AppText variant="caption" tone="ink3" style={styles.modalHint}>
          Tell me what&apos;s actually true{entityName ? ` about ${entityName}` : ''} in your
          own words. I keep the original memory untouched and update what I understood.
        </AppText>

        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          textAlignVertical="top"
          placeholder="e.g. Rahul left Acme in 2024 — he doesn't work there anymore."
          placeholderTextColor={colors.ink3}
          style={[
            styles.input,
            {
              color: colors.ink,
              backgroundColor: colors.surface,
              borderColor: colors.hairline,
            },
          ]}
        />

        {error ? (
          <AppText variant="caption" tone="danger" style={styles.error}>
            {error}
          </AppText>
        ) : null}

        <PressableScale
          onPress={() => void save()}
          disabled={saving}
          style={[styles.saveBtn, { backgroundColor: colors.accent, opacity: saving ? 0.7 : 1 }]}
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
  skeletons: { gap: space.md, paddingHorizontal: space.xxl, paddingTop: space.md },
  content: { paddingHorizontal: space.xxl, paddingTop: space.sm },
  typeLabel: { textTransform: 'capitalize', marginBottom: space.sm },
  profile: { marginBottom: space.lg },
  section: { marginTop: space.lg, gap: space.md },
  sectionTitle: {},
  sectionBody: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    borderWidth: hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
  },
  rowBody: { flex: 1, gap: space.xs },
  factActions: { flexDirection: 'row', gap: space.lg, marginTop: space.xs },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  edgeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  modal: { flex: 1, paddingHorizontal: space.lg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
  },
  modalHint: { marginBottom: space.lg },
  currentFact: {
    borderWidth: hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    marginBottom: space.lg,
  },
  input: {
    borderWidth: hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 120,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: space.lg,
  },
  error: { marginBottom: space.md },
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: space.md,
    minHeight: 48,
  },
});
