import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../src/api/client';
import type { Memory } from '../src/api/types';
import { useOutbox } from '../src/capture/useOutbox';
import { AppText } from '../src/components/AppText';
import { EmptyState } from '../src/components/EmptyState';
import { ErrorState } from '../src/components/ErrorState';
import { MemoryRow, type RowStatus } from '../src/components/MemoryRow';
import { ModalHeader } from '../src/components/ModalHeader';
import { PressableScale } from '../src/components/PressableScale';
import { Skeleton } from '../src/components/Skeleton';
import { dayLabel } from '../src/lib/time';
import { space } from '../src/theme/tokens';
import { useTheme } from '../src/theme/useTheme';

const PAGE_SIZE = 30;

type Row =
  | { kind: 'label'; key: string; label: string }
  | { kind: 'banner'; key: string }
  | {
      kind: 'memory';
      key: string;
      id: string | null;
      text: string;
      timestamp: string;
      status: RowStatus;
    };

type LoadStatus = 'loading' | 'ready' | 'error';

/** Timeline — the raw episodic log, newest first. Local unsynced items pinned on top. */
export default function TimelineScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { items: outboxItems } = useOutbox();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const loadingMore = useRef(false);

  const loadFirstPage = useCallback(async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true);
    try {
      const page = await api.listMemories({ limit: PAGE_SIZE });
      setMemories(page.items);
      setNextCursor(page.nextCursor);
      setStatus('ready');
    } catch {
      setStatus((prev) => (prev === 'ready' && asRefresh ? 'ready' : 'error'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await api.listMemories({ cursor: nextCursor, limit: PAGE_SIZE });
      setMemories((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // Quietly stop paginating; pull-to-refresh recovers.
    } finally {
      loadingMore.current = false;
    }
  }, [nextCursor]);

  const rows = useMemo<Row[]>(() => {
    const built: Row[] = [];

    if (outboxItems.length > 0) {
      built.push({ kind: 'label', key: 'label-local', label: 'On this device' });
      for (const item of [...outboxItems].reverse()) {
        built.push({
          kind: 'memory',
          key: item.clientId,
          id: null,
          text: item.rawText,
          timestamp: item.createdAt,
          status: 'local',
        });
      }
    }

    if (status === 'error' && built.length > 0) {
      built.push({ kind: 'banner', key: 'banner-offline' });
    }

    let lastLabel: string | null = null;
    for (const memory of memories) {
      const label = dayLabel(memory.createdAt);
      if (label !== lastLabel) {
        built.push({ kind: 'label', key: `label-${label}`, label });
        lastLabel = label;
      }
      built.push({
        kind: 'memory',
        key: memory.id,
        id: memory.id,
        text: memory.rawText,
        timestamp: memory.createdAt,
        status: memory.status,
      });
    }

    return built;
  }, [outboxItems, memories, status]);

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'label') {
      return (
        <View style={styles.label}>
          <AppText variant="micro" tone="ink3">
            {item.label}
          </AppText>
        </View>
      );
    }
    if (item.kind === 'banner') {
      return (
        <View style={styles.banner}>
          <AppText variant="caption" tone="ink3" style={styles.bannerText}>
            Can&apos;t reach the server — showing what&apos;s on this device.
          </AppText>
          <PressableScale onPress={() => void loadFirstPage()} hitSlop={8}>
            <AppText variant="captionMedium" tone="accent">
              Retry
            </AppText>
          </PressableScale>
        </View>
      );
    }
    return (
      <MemoryRow
        text={item.text}
        timestamp={item.timestamp}
        status={item.status}
        onPress={
          item.id
            ? () => router.push({ pathname: '/memory/[id]', params: { id: item.id! } })
            : undefined
        }
      />
    );
  };

  const listEmpty =
    status === 'loading' ? (
      <View style={styles.skeletons}>
        {[0.9, 0.6, 0.75, 0.5].map((w, i) => (
          <View key={i} style={styles.skeletonRow}>
            <Skeleton width={`${w * 100}%`} height={18} />
            <Skeleton width={80} height={12} />
          </View>
        ))}
      </View>
    ) : status === 'error' ? (
      <ErrorState
        title="Can't reach your memories"
        caption="Anything you capture is safe on this device and will sync when you're back."
        onRetry={() => {
          setStatus('loading');
          void loadFirstPage();
        }}
      />
    ) : (
      <EmptyState
        title="Nothing here yet"
        caption="Your first memory is one tap away."
      />
    );

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={{ height: Math.max(insets.top - space.xxl, 0) }} />
      <ModalHeader title="Memories" />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadFirstPage(true)}
            tintColor={colors.ink3}
          />
        }
        ListEmptyComponent={listEmpty}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: space.xxl,
  },
  label: {
    paddingTop: space.xl,
    paddingBottom: space.xs,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  bannerText: {
    flexShrink: 1,
  },
  skeletons: {
    paddingTop: space.xl,
    gap: space.xl,
  },
  skeletonRow: {
    gap: space.sm,
  },
});
