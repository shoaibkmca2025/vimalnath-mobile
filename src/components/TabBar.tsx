import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NavIcon, primaryNav } from '@/components/NavIcon';
import { colors, fonts } from '@/theme';

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const item = primaryNav.find((nav) => nav.route === route.name);
        if (!item) return null;
        const focused = state.index === index;
        const tint = focused ? colors.blue : '#a0a7b4';

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.label}
            style={({ pressed }) => [styles.item, focused && styles.itemActive, pressed && !focused && styles.itemPressed]}
          >
            <NavIcon name={item.key} size={21} color={tint} />
            <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#dfe3e8',
  },
  item: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 14 },
  itemActive: { backgroundColor: '#f1f5ff' },
  itemPressed: { backgroundColor: colors.soft },
  label: { fontFamily: fonts.semibold, fontSize: 11 },
});
