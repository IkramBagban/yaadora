import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useOutbox } from '../capture/useOutbox';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { StatusDot } from './StatusDot';

const SYNCED_FLASH_MS = 2000;

/**
 * Quiet sync status in the Capture header. Hidden when there is nothing to
 * say; "n queued" (pulsing) while the outbox has items — tap to retry;
 * a brief "Synced" flash when the queue drains.
 */
export function StatusPill() {
  const { colors } = useTheme();
  const { pendingCount, syncing, lastSyncedAt, flush } = useOutbox();
  const [showSynced, setShowSynced] = useState(false);

  useEffect(() => {
    if (!lastSyncedAt) return;
    setShowSynced(true);
    const timer = setTimeout(() => setShowSynced(false), SYNCED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [lastSyncedAt]);

  if (pendingCount === 0 && !showSynced) return null;

  const queued = pendingCount > 0;
  const label = queued
    ? syncing
      ? 'Syncing…'
      : `${pendingCount} queued`
    : 'Synced';

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)}>
      <PressableScale
        disabled={!queued}
        onPress={() => {
          void Haptics.selectionAsync();
          void flush();
        }}
        hitSlop={8}
        style={[
          styles.pill,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
        ]}
      >
        <StatusDot
          color={queued ? colors.pending : colors.success}
          pulsing={queued}
        />
        <AppText variant="caption" tone="ink2">
          {label}
        </AppText>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm - 2,
    paddingHorizontal: space.md,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
  },
});
