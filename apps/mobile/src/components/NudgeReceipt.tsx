import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { api } from '../api/client';
import type { SurfacingEvidenceMemory } from '../api/types';
import { durations } from '../theme/motion';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/**
 * Small dismissible receipt under an answer when a proactive nudge was woven
 * (spec 02 §5.4, P2). Tap expands evidence memories ("why am I hearing this");
 * Dismiss calls POST /surfacings/:id/reaction { reaction: 'dismissed' }.
 */
export function NudgeReceipt({
  surfacingId,
  evidenceIds,
}: {
  surfacingId: string;
  evidenceIds: string[];
}) {
  const { colors } = useTheme();
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [memories, setMemories] = useState<SurfacingEvidenceMemory[] | null>(
    null,
  );

  if (hidden) return null;

  const toggle = async () => {
    void Haptics.selectionAsync();
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (memories || loading) return;
    setLoading(true);
    try {
      const res = await api.getSurfacingEvidence(surfacingId);
      setMemories(res.memories);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  };

  const dismiss = async () => {
    void Haptics.selectionAsync();
    setHidden(true);
    try {
      await api.postSurfacingReaction(surfacingId, 'dismissed');
    } catch {
      /* best-effort; ledger may still settle via idle sweep */
    }
  };

  return (
    <Animated.View
      entering={FadeIn.duration(durations.fade)}
      exiting={FadeOut.duration(160)}
      style={[
        styles.wrap,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
      ]}
    >
      <View style={styles.row}>
        <PressableScale onPress={toggle} style={styles.grow} hitSlop={6}>
          <View style={styles.labelRow}>
            <Feather name="bookmark" size={13} color={colors.accent} />
            <AppText variant="captionMedium" tone="ink2">
              Why am I hearing this
            </AppText>
            <AppText variant="caption" tone="ink3">
              {open ? '· hide' : evidenceIds.length ? `· ${evidenceIds.length}` : ''}
            </AppText>
          </View>
        </PressableScale>
        <PressableScale onPress={dismiss} hitSlop={10} style={styles.dismiss}>
          <AppText variant="captionMedium" tone="ink3">
            Dismiss
          </AppText>
        </PressableScale>
      </View>

      {open && (
        <Animated.View
          entering={FadeIn.duration(durations.fade)}
          style={styles.evidence}
        >
          {loading && (
            <AppText variant="caption" tone="ink3">
              Loading sources…
            </AppText>
          )}
          {!loading && memories && memories.length === 0 && (
            <AppText variant="caption" tone="ink3">
              No source memories attached.
            </AppText>
          )}
          {!loading &&
            memories?.map((m) => (
              <PressableScale
                key={m.id}
                onPress={() =>
                  router.push({
                    pathname: '/memory/[id]',
                    params: { id: m.id },
                  })
                }
                style={[
                  styles.mem,
                  { borderColor: colors.hairline, backgroundColor: colors.bg },
                ]}
              >
                <AppText variant="caption" tone="ink" numberOfLines={3}>
                  {m.rawText}
                </AppText>
              </PressableScale>
            ))}
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    borderWidth: hairlineWidth,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  grow: { flex: 1 },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm - 2,
  },
  dismiss: { padding: space.xs },
  evidence: { gap: space.sm },
  mem: {
    borderRadius: radius.sm,
    borderWidth: hairlineWidth,
    padding: space.sm + 2,
  },
});
