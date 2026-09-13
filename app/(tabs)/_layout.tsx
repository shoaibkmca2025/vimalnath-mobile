import { Tabs } from 'expo-router/js-tabs';

import { primaryNav } from '@/components/NavIcon';
import { TabBar } from '@/components/TabBar';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.white } }}
    >
      {primaryNav.map((item) => (
        <Tabs.Screen key={item.route} name={item.route} options={{ title: item.label }} />
      ))}
    </Tabs>
  );
}
