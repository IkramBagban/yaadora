import { StyleSheet, View } from 'react-native';
import type { IngestionStatus } from '../api/types';
import { relativeTime } from '../lib/time';
import { hairlineWidth, radius, space } from '../theme/tokens';
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
      return { color: null, label: null, pulsing: false };
  }
}

/** One raw memory as a soft card: the user's words, metadata whispered below. */
export function MemoryRow({ text, timestamp, status, onPress, compact = false }: MemoryRowProps) {
  const { colors } = useTheme();
  const meta = statusMeta(status, colors);

  return (
    <PressableScale
      scaleTo={0.98}
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.card,
        compact && styles.cardCompact,
        { backgroundColor: colors.surface, borderColor: colors.hairline },
      ]}
    >
      <AppText variant="serifBody" numberOfLines={compact ? 2 : 3}>
        {text}
      </AppText>
      <View style={styles.meta}>
        <AppText variant="caption" tone="ink3">
          {relativeTime(timestamp)}
        </AppText>
        {meta.color && (
          <View style={styles.metaStatus}>
            <StatusDot color={meta.color} pulsing={meta.pulsing} size={5} />
            {meta.label && (
              <AppText variant="caption" tone="ink3">
                {meta.label}
              </AppText>
            )}
          </View>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md + 2,
    borderRadius: radius.md,
    borderWidth: hairlineWidth,
  },
  cardCompact: {
    paddingVertical: space.md,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
  },
});
