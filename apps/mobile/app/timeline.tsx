import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { api } from '../src/api/client';
import type { Memory } from '../src/api/types';
import { useOutbox } from '../src/capture/useOutbox';
import { AppText } from '../src/components/AppText';
import { EmptyState } from '../src/components/EmptyState';
import { ErrorState } from '../src/components/ErrorState';
import { MemoryCalendar } from '../src/components/MemoryCalendar';
import { MemoryRow, type RowStatus } from '../src/components/MemoryRow';
import { ModalHeader } from '../src/components/ModalHeader';
import { PressableScale } from '../src/components/PressableScale';
import { SegmentedControl, type Segment } from '../src/components/SegmentedControl';
import { Skeleton } from '../src/components/Skeleton';
import { dayLabel } from '../src/lib/time';
import { setMemorySequence } from '../src/lib/memoryNav';
import { durations } from '../src/theme/motion';
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
type ViewKey = 'list' | 'calendar';

const SEGMENTS: Segment<ViewKey>[] = [
  { key: 'list', label: 'List', icon: 'list' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
];

/**
 * Memories hub — every record you've kept, two ways in. List: newest-first.
 * Calendar: jump to any specific day. Both show only what you added.
 */
export default function TimelineScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { items: outboxItems } = useOutbox();

  const [view, setView] = useState<ViewKey>('list');
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

  // Publish the browsing order so the detail screen can swipe prev/next.
  useEffect(() => {
    setMemorySequence(memories.map((m) => m.id));
  }, [memories]);

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

  const openMemory = useCallback((id: string) => {
    router.push({ pathname: '/memory/[id]', params: { id } });
  }, []);

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
      <View style={styles.memoryWrap}>
        <MemoryRow
          text={item.text}
          timestamp={item.timestamp}
          status={item.status}
          onPress={item.id ? () => openMemory(item.id!) : undefined}
        />
      </View>
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

      <View style={styles.segmentWrap}>
        <SegmentedControl segments={SEGMENTS} value={view} onChange={setView} />
      </View>

      {view === 'list' && (
        <Animated.View entering={FadeIn.duration(durations.fade)} style={styles.screen}>
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
        </Animated.View>
      )}

      {view === 'calendar' && (
        <Animated.View entering={FadeIn.duration(durations.fade)} style={[styles.screen, styles.listContent]}>
          <MemoryCalendar
            memories={memories}
            hasMore={Boolean(nextCursor)}
            onNeedOlder={() => void loadMore()}
            onOpenMemory={openMemory}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  segmentWrap: {
    paddingHorizontal: space.xxl,
    paddingBottom: space.md,
  },
  listContent: {
    paddingHorizontal: space.xxl,
  },
  label: {
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  memoryWrap: {
    paddingBottom: space.sm,
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
