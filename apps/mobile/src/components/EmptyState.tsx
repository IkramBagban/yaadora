import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import Animated, { FadeIn } from 'react-native-reanimated';
import { space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { AppText } from './AppText';

interface EmptyStateProps {
  title: string;
  caption?: string;
  icon?: keyof typeof Feather.glyphMap;
}

export function EmptyState({ title, caption, icon = 'feather' }: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.wrap}>
      <Feather name={icon} size={22} color={colors.ink3} />
      <View style={styles.text}>
        <AppText variant="title" tone="ink2" align="center">
          {title}
        </AppText>
        {caption ? (
          <AppText variant="sub" tone="ink3" align="center">
            {caption}
          </AppText>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.xxxl,
    paddingVertical: space.huge,
  },
  text: {
    alignItems: 'center',
    gap: space.sm,
  },
});
