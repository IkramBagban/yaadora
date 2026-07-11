import { ActivityIndicator, View } from 'react-native';
import { Redirect, type Href } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { createMaterialTopTabNavigator, type MaterialTopTabNavigationOptions } from '@react-navigation/material-top-tabs';
import { withLayoutContext } from 'expo-router';
import { FloatingTabBar } from '../../src/components/FloatingTabBar';
import { useTheme } from '../../src/theme/useTheme';

const { Navigator } = createMaterialTopTabNavigator();

export const MaterialTopTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof Navigator,
  any,
  any
>(Navigator);

export default function TabsLayout() {
  const { colors } = useTheme();
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!isSignedIn) {
    return <Redirect href={'/(auth)/sign-in' as Href} />;
  }

  return (
    <MaterialTopTabs
      tabBarPosition="bottom"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <MaterialTopTabs.Screen name="index" options={{ title: 'Add' }} />
      <MaterialTopTabs.Screen name="ask" options={{ title: 'Ask' }} />
      <MaterialTopTabs.Screen name="reminders" options={{ title: 'Reminders' }} />
    </MaterialTopTabs>
  );
}
