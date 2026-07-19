import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import type { Citation } from '../api/types';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { CitationChip } from './CitationChip';
import { PressableScale } from './PressableScale';

interface SourcesSheetProps {
  citations: Citation[];
  visible: boolean;
  onClose: () => void;
}

/** Full source detail stays one tap away, rather than interrupting the answer. */
export function SourcesSheet({ citations, visible, onClose }: SourcesSheetProps) {
  const { colors } = useTheme();
  const label = `${citations.length} source${citations.length === 1 ? '' : 's'}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close sources" onPress={onClose} style={styles.backdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.bg }]}> 
          <View style={[styles.handle, { backgroundColor: colors.hairline }]} />
          <View style={styles.header}>
            <View>
              <AppText variant="title">Sources</AppText>
              <AppText variant="caption" tone="ink3">{label} behind this answer</AppText>
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Close sources"
              onPress={onClose}
              hitSlop={10}
              style={[styles.close, { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline }]}
            >
              <Feather name="x" size={16} color={colors.ink2} />
            </PressableScale>
          </View>
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {citations.map((citation, index) => (
              <CitationChip
                key={`${citation.memoryId}-${index}`}
                citation={citation}
                index={index}
                onPress={() => {
                  onClose();
                  router.push({ pathname: '/memory/[id]', params: { id: citation.memoryId } });
                }}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20, 18, 16, 0.28)' },
  sheet: { maxHeight: '72%', minHeight: 220, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.xxl, paddingBottom: space.xxl },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.pill, marginTop: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.lg },
  close: { width: 32, height: 32, borderRadius: radius.pill, borderWidth: hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  list: { gap: space.sm, paddingBottom: space.md },
});
