import { StyleSheet, View } from 'react-native';
import type { IngestionStatus } from '../api/types';
import { relativeTime } from '../lib/time';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { StatusDot } from './StatusDot';

export type RowStatus = IngestionStatus | 'local';

interface MemoryRowProps {
  text: string;
  timestamp: string;
  status: RowStatus;
  onPress?: () => void;
  /** Single-line compact form for the Capture screen's Recent strip. */
  compact?: boolean;
}

function statusMeta(status: RowStatus, colors: ReturnType<typeof useTheme>['colors']) {
  switch (status) {
    case 'local':
      return { color: colors.pending, label: 'on this device', pulsing: true };
    case 'pending':
      return { color: colors.pending, label: 'processing', pulsing: false };
    case 'failed':
      return { color: colors.danger, label: 'needs attention', pulsing: false };
    default:
      return { color: colors.success, label: null, pulsing: false };
  }
}

/** One raw memory: the user's words in serif, metadata whispered underneath. */
export function MemoryRow({ text, timestamp, status, onPress, compact = false }: MemoryRowProps) {
  const { colors } = useTheme();
  const meta = statusMeta(status, colors);

  return (
    <PressableScale
      scaleTo={0.98}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.row, compact && styles.rowCompact]}
    >
      <AppText variant="serifBody" numberOfLines={compact ? 1 : 2}>
        {text}
      </AppText>
      <View style={styles.meta}>
        <StatusDot color={meta.color} pulsing={meta.pulsing} />
        <AppText variant="caption" tone="ink3">
          {relativeTime(timestamp)}
          {meta.label ? `  ·  ${meta.label}` : ''}
        </AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: space.md,
    gap: space.xs + 2,
  },
  rowCompact: {
    paddingVertical: space.sm + 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm - 2,
  },
});
