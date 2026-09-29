import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatINR, lowestPrice, productTitle, type ShopProduct } from '@/data/shop';
import { colors, radius, type } from '@/theme';

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
          <Ionicons name="cube-outline" size={32} color={colors.tertiaryLabel} />
        )}
      </View>
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
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: '48%' },
  pressed: { opacity: 0.7 },
  // Product photos are white squares, so a hairline outlines the tile against the white page.
  media: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: radius.md,
  },
  code: { ...type.caption1, marginTop: 8, color: colors.secondaryLabel, fontWeight: '500' },
  title: { ...type.subheadline, minHeight: 40, marginTop: 1 },
  price: { ...type.headline, marginTop: 4 },
  from: { ...type.footnote, color: colors.secondaryLabel },
  onRequest: { ...type.footnote, marginTop: 4, color: colors.secondaryLabel },
});
