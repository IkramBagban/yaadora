import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { api } from '../../src/api/client';
import type { MemoryDetail } from '../../src/api/types';
import { AppText } from '../../src/components/AppText';
import { ErrorState } from '../../src/components/ErrorState';
import { ModalHeader } from '../../src/components/ModalHeader';
import { Skeleton } from '../../src/components/Skeleton';
import { StatusDot } from '../../src/components/StatusDot';
import { formatDateLong } from '../../src/lib/time';
import { durations } from '../../src/theme/motion';
import { fonts, hairlineWidth, radius, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * A single raw memory — the immutable ground truth, presented like a
 * manuscript page — with whatever the system has derived from it underneath.
 */
export default function MemoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const load = useCallback(async () => {
    if (!id) return;
    setStatus('loading');
    try {
      setDetail(await api.getMemory(id));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={{ height: Math.max(insets.top - space.xxl, 0) }} />
      <ModalHeader title="Memory" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {status === 'loading' && (
          <View style={styles.skeletons}>
            <Skeleton width="92%" height={22} />
            <Skeleton width="78%" height={22} />
            <Skeleton width="60%" height={22} />
            <Skeleton width={140} height={12} style={styles.skeletonMeta} />
          </View>
        )}

        {status === 'error' && (
          <ErrorState
            title="Can't open this memory"
            caption="The original is safe — try again in a moment."
            onRetry={() => void load()}
          />
        )}

        {status === 'ready' && detail && (
          <Animated.View entering={FadeIn.duration(durations.enter)} style={styles.body}>
            <AppText style={[styles.rawText, { color: colors.ink }]}>
              {detail.memory.rawText}
            </AppText>

            <AppText variant="caption" tone="ink3">
              {formatDateLong(detail.memory.occurredAt ?? detail.memory.createdAt)}
              {`  ·  ${detail.memory.source}`}
            </AppText>

            {detail.memory.status === 'pending' && (
              <View style={styles.processing}>
                <StatusDot color={colors.pending} pulsing />
                <AppText variant="caption" tone="ink3">
                  Processing — understanding will appear here.
                </AppText>
              </View>
            )}

            {detail.facts.length > 0 && (
              <View style={styles.section}>
                <AppText variant="micro" tone="ink3">
                  What I understood
                </AppText>
                {detail.facts.map((fact) => (
                  <View key={fact.id} style={styles.factRow}>
                    <View style={styles.factDot}>
                      <StatusDot
                        color={colors.success}
                        size={5}
                      />
                    </View>
                    <AppText variant="sub" tone="ink2" style={styles.factText}>
                      {fact.factText}
                    </AppText>
                  </View>
                ))}
              </View>
            )}

            {detail.entities.length > 0 && (
              <View style={styles.section}>
                <AppText variant="micro" tone="ink3">
                  Mentions
                </AppText>
                <View style={styles.entities}>
                  {detail.entities.map((entity) => (
                    <View
                      key={entity.id}
                      style={[
                        styles.entityPill,
                        { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
                      ]}
                    >
                      <AppText variant="captionMedium" tone="ink">
                        {entity.canonicalName}
                      </AppText>
                      <AppText variant="caption" tone="ink3">
                        {entity.type}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
  },
  skeletons: {
    gap: space.md,
    paddingTop: space.sm,
  },
  skeletonMeta: {
    marginTop: space.sm,
  },
  body: {
    gap: space.lg,
  },
  rawText: {
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 38,
  },
  processing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  section: {
    gap: space.md,
    marginTop: space.md,
  },
  factRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  factDot: {
    paddingTop: 8,
  },
  factText: {
    flexShrink: 1,
  },
  entities: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  entityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm - 2,
    paddingHorizontal: space.md,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
  },
});
