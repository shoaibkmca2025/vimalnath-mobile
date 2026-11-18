import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { primaryNav } from '@/data/navigation';
import { useShopRequests } from '@/lib/admin-sync';
import { colors } from '@/theme';

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  // Orders the shop sent that are waiting for the customer to confirm.
  const waiting = useShopRequests().filter((order) => order.status === 'Requested').length;
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const item = primaryNav.find((nav) => nav.route === route.name);
        if (!item) return null;
        const focused = state.index === index;
        const tint = focused ? colors.tint : colors.secondaryLabel;

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
            accessibilityLabel={item.key === 'orders' && waiting ? `${item.label}, ${waiting} waiting for your confirmation` : item.label}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          >
            <View>
              <Ionicons name={item.icon} size={24} color={tint} />
              {item.key === 'orders' && waiting > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText} maxFontSizeMultiplier={1.15}>
                    {waiting > 9 ? '9+' : waiting}
                  </Text>
                </View>
              )}
            </View>
            {/* Tab titles don't need to grow with the text size; the large content viewer covers that. */}
            <Text style={[styles.label, { color: tint }]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
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
    paddingTop: 6,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(249, 249, 249, 0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  item: { flex: 1, minHeight: 49, alignItems: 'center', justifyContent: 'center', gap: 2 },
  pressed: { opacity: 0.55 },
  label: { fontSize: 11, lineHeight: 13, fontWeight: '500' },
  badge: { position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.red },
  badgeText: { color: colors.white, fontSize: 11, lineHeight: 13, fontWeight: '700' },
});
