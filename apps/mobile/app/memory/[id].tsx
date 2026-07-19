import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  SlideInLeft,
  SlideInRight,
  runOnJS,
} from 'react-native-reanimated';
import { api } from '../../src/api/client';
import type { MemoryDetail } from '../../src/api/types';
import { AppText } from '../../src/components/AppText';
import { ErrorState } from '../../src/components/ErrorState';
import { ModalHeader } from '../../src/components/ModalHeader';
import { PressableScale } from '../../src/components/PressableScale';
import { Skeleton } from '../../src/components/Skeleton';
import { getMemoryNeighbors } from '../../src/lib/memoryNav';
import { formatDateLong } from '../../src/lib/time';
import { durations } from '../../src/theme/motion';
import { fonts, space } from '../../src/theme/tokens';
import { useTheme } from '../../src/theme/useTheme';

type LoadStatus = 'loading' | 'ready' | 'error';
type Direction = 'newer' | 'older' | null;

const SWIPE_COMMIT = 64;

/**
 * A single record — only the user's own words and when they wrote them.
 * Nothing the pipeline derived (facts, entities) appears here; this page is
 * the immutable thing they saved. Swipe left/right (or use the pager) to walk
 * the records without going back to the list.
 */
export default function MemoryDetailScreen() {
  const { id: paramId } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [currentId, setCurrentId] = useState(paramId);
  const [direction, setDirection] = useState<Direction>(null);
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');

  useEffect(() => setCurrentId(paramId), [paramId]);

  const load = useCallback(async () => {
    if (!currentId) return;
    setStatus('loading');
    try {
      setDetail(await api.getMemory(currentId));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [currentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const neighbors = currentId ? getMemoryNeighbors(currentId) : null;

  const go = useCallback(
    (dir: 'newer' | 'older') => {
      const target = dir === 'newer' ? neighbors?.prevId : neighbors?.nextId;
      if (!target) return;
      void Haptics.selectionAsync();
      setDirection(dir);
      setCurrentId(target);
    },
    [neighbors],
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-18, 18])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      if (e.translationX < -SWIPE_COMMIT) runOnJS(go)('older');
      else if (e.translationX > SWIPE_COMMIT) runOnJS(go)('newer');
    });

  // Older records slide in from the right (moving down the timeline); newer
  // ones from the left. First open just fades.
  const entering =
    direction === 'older'
      ? SlideInRight.springify().damping(22).stiffness(240)
      : direction === 'newer'
        ? SlideInLeft.springify().damping(22).stiffness(240)
        : FadeIn.duration(durations.enter);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={{ height: Math.max(insets.top - space.xxl, 0) }} />
      <ModalHeader title="Record" />

      <GestureDetector gesture={pan}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + space.huge },
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
              title="Can't open this record"
              caption="The original is safe — try again in a moment."
              onRetry={() => void load()}
            />
          )}

          {status === 'ready' && detail && (
            <Animated.View key={detail.memory.id} entering={entering} style={styles.body}>
              <AppText style={[styles.rawText, { color: colors.ink }]}>
                {detail.memory.rawText}
              </AppText>

              <AppText variant="caption" tone="ink3">
                {formatDateLong(detail.memory.occurredAt ?? detail.memory.createdAt)}
              </AppText>
            </Animated.View>
          )}
        </ScrollView>
      </GestureDetector>

      {neighbors && neighbors.total > 1 && (
        <Animated.View
          entering={FadeIn.delay(200).duration(durations.fade)}
          style={[styles.pager, { paddingBottom: insets.bottom + space.lg }]}
        >
          <PressableScale
            disabled={!neighbors.prevId}
            onPress={() => go('newer')}
            hitSlop={10}
            style={[styles.pagerChev, !neighbors.prevId && styles.pagerDisabled]}
            accessibilityLabel="Newer record"
          >
            <Feather name="chevron-left" size={18} color={colors.ink2} />
          </PressableScale>
          <AppText variant="caption" tone="ink3">
            {neighbors.index + 1} of {neighbors.total}
          </AppText>
          <PressableScale
            disabled={!neighbors.nextId}
            onPress={() => go('older')}
            hitSlop={10}
            style={[styles.pagerChev, !neighbors.nextId && styles.pagerDisabled]}
            accessibilityLabel="Older record"
          >
            <Feather name="chevron-right" size={18} color={colors.ink2} />
          </PressableScale>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.xxl,
    paddingTop: space.lg,
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
    fontFamily: fonts.sans,
    fontSize: 20,
    lineHeight: 30,
    letterSpacing: -0.2,
  },
  pager: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
  },
  pagerChev: {
    padding: space.sm,
  },
  pagerDisabled: {
    opacity: 0.25,
  },
});
