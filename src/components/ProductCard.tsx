import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatINR, lowestPrice, productTitle, type ShopProduct } from '@/data/shop';
import { colors, fonts } from '@/theme';

export function ProductCard({ product }: { product: ShopProduct }) {
  const price = lowestPrice(product);
  const several = (product.options?.length ?? 0) > 1 && new Set(product.options?.map((option) => option.mrp)).size > 1;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/product/[id]', params: { id: product.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${product.code}, ${productTitle(product)}${price ? `, from ${formatINR(price)}` : ''}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.media}>
        {product.image ? (
          <Image source={product.image} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} />
        ) : (
          <Feather name="package" size={30} color="#b9c8ec" />
        )}
      </View>
      <View style={styles.copy}>
        <Text style={styles.code} numberOfLines={1}>
          {product.code}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {productTitle(product)}
        </Text>
        {price !== undefined ? (
          <Text style={styles.price}>
            {several && <Text style={styles.from}>From </Text>}
            {formatINR(price)}
          </Text>
        ) : (
          <Text style={styles.onRequest}>Price in catalogue</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: '48%', overflow: 'hidden', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16 },
  pressed: { borderColor: '#bcd0ff', transform: [{ scale: 0.98 }] },
  // Product photos are white squares, so the frame is white too and every card lines up.
  media: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center', margin: 6, backgroundColor: colors.white, borderRadius: 12, overflow: 'hidden' },
  copy: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 12, gap: 3 },
  code: { color: colors.blue, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.3 },
  title: { minHeight: 36, color: colors.ink, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  price: { marginTop: 2, color: colors.ink, fontFamily: fonts.display, fontSize: 16 },
  from: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  onRequest: { marginTop: 4, color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
});
