import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { hairlineWidth, radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

interface ModalHeaderProps {
  title: string;
}

/** Serif title + circular close for modal screens. */
export function ModalHeader({ title }: ModalHeaderProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <AppText variant="display" style={styles.title}>
        {title}
      </AppText>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => router.back()}
        hitSlop={10}
        style={[
          styles.close,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
        ]}
      >
        <Feather name="x" size={16} color={colors.ink2} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
    paddingBottom: space.md,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
