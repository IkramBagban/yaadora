import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { ApiErrorDetails } from '../api/client';
import { API_URL } from '../api/config';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { radius, space, fonts } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';

interface Props {
  /** Error message shown in the chip. */
  message: string;
  /** Full details object for the modal. */
  details?: ApiErrorDetails | null;
  /** Called when the user dismisses the chip. */
  onDismiss?: () => void;
}

/**
 * A closeable chip that summarises an API error. Tapping it opens a
 * full-screen modal with the raw JSON so we can debug production issues
 * directly on the device.
 */
export function DebugErrorChip({ message, details, onDismiss }: Props) {
  const { colors } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);

  const debugJson = JSON.stringify(
    {
      apiUrl: API_URL,
      message,
      ...(details ?? {}),
      timestamp: new Date().toISOString(),
    },
    null,
    2,
  );

  return (
    <>
      {/* ── chip ── */}
      <View
        style={[
          styles.chip,
          {
            backgroundColor: colors.danger + '15',
            borderColor: colors.danger + '30',
          },
        ]}
      >
        <PressableScale
          onPress={() => setModalVisible(true)}
          style={styles.chipBody}
        >
          <Feather
            name="alert-triangle"
            size={14}
            color={colors.danger}
            style={{ marginRight: space.xs }}
          />
          <View style={{ flex: 1 }}>
            <AppText variant="captionMedium" tone="danger">
              Sync Error
            </AppText>
            <AppText variant="caption" tone="danger" style={{ marginTop: 2 }}>
              {message}
            </AppText>
            <AppText variant="micro" tone="ink3" style={{ marginTop: 2 }}>
              API: {API_URL} · Tap for details
            </AppText>
          </View>
        </PressableScale>

        {onDismiss && (
          <PressableScale onPress={onDismiss} hitSlop={12} style={styles.closeBtn}>
            <Feather name="x" size={16} color={colors.danger} />
          </PressableScale>
        )}
      </View>

      {/* ── modal ── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.backdrop}>
          <View
            style={[
              styles.modal,
              { backgroundColor: colors.surface },
            ]}
          >
            <View style={styles.modalHeader}>
              <AppText variant="title" tone="ink">
                Debug Info
              </AppText>
              <PressableScale
                onPress={() => setModalVisible(false)}
                hitSlop={12}
              >
                <Feather name="x" size={22} color={colors.ink2} />
              </PressableScale>
            </View>

            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
            >
              <AppText
                variant="caption"
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 12,
                  lineHeight: 18,
                  color: colors.ink,
                }}
                selectable
              >
                {debugJson}
              </AppText>
            </ScrollView>

            <View style={styles.modalFooter}>
              <PressableScale
                onPress={() => setModalVisible(false)}
                style={[styles.doneBtn, { backgroundColor: colors.accent }]}
              >
                <AppText variant="captionMedium" tone="onAccent">
                  Close
                </AppText>
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: space.md,
  },
  chipBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  closeBtn: {
    marginLeft: space.xs,
    paddingTop: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modal: {
    maxHeight: '80%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: space.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xxl,
    paddingBottom: space.md,
  },
  scrollArea: {
    paddingHorizontal: space.xxl,
  },
  scrollContent: {
    paddingBottom: space.xxl,
  },
  modalFooter: {
    padding: space.xxl,
    alignItems: 'center',
  },
  doneBtn: {
    paddingVertical: space.sm,
    paddingHorizontal: space.xxxl,
    borderRadius: radius.pill,
  },
});
