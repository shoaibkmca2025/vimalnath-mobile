import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCart } from '@/providers/CartProvider';
import { colors } from '@/theme';

/** Navigation bar button that opens the cart, with the item count as a badge. */
export function CartButton() {
  const { count } = useCart();
  return (
    <Pressable
      onPress={() => router.push('/cart')}
      accessibilityRole="button"
      accessibilityLabel={count ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart, empty'}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name="cart-outline" size={26} color={colors.tint} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
  badge: {
    position: 'absolute',
    top: 3,
    right: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tint,
    borderRadius: 9,
  },
  badgeText: { color: colors.white, fontSize: 11, lineHeight: 13, fontWeight: '700' },
});
