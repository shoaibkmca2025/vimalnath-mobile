import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLockup } from '@/components/BrandLockup';
import { useAppUI } from '@/providers/AppUIProvider';
import { useCart } from '@/providers/CartProvider';
import { colors, fonts } from '@/theme';

export function AppHeader() {
  const insets = useSafeAreaInsets();
  const { openDrawer } = useAppUI();
  const { count } = useCart();

  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Pressable
          onPress={openDrawer}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          {/* Three strokes with a short last line, matching the prototype's menu glyph. */}
          <View style={styles.menuGlyph}>
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={[styles.menuLine, { width: 11 }]} />
          </View>
        </Pressable>

        <BrandLockup />

        <Pressable
          onPress={() => router.push('/cart')}
          accessibilityRole="button"
          accessibilityLabel={count ? `Cart, ${count} items` : 'Cart, empty'}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Feather name="shopping-cart" size={21} color={colors.ink} />
          {count > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{count > 99 ? '99+' : count}</Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  row: {
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  pressed: { backgroundColor: colors.soft },
  menuGlyph: { width: 18, gap: 4.5 },
  menuLine: { width: 18, height: 2, borderRadius: 1, backgroundColor: colors.ink },
  cartBadge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 19,
    height: 19,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: 10,
  },
  cartBadgeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 10, lineHeight: 12 },
});
