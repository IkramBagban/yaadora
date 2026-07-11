import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { View, ActivityIndicator } from 'react-native';
import { useTheme } from '../../src/theme/useTheme';

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { colors } = useTheme();

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isSignedIn) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
