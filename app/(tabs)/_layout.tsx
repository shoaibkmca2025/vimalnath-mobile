import { Tabs } from 'expo-router/js-tabs';

import { TabBar } from '@/components/TabBar';
import { primaryNav } from '@/data/navigation';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
    >
      {primaryNav.map((item) => (
        <Tabs.Screen key={item.route} name={item.route} options={{ title: item.label }} />
      ))}
    </Tabs>
  );
}
