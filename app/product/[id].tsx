import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { CatalogPageViewer } from '@/components/CatalogPageViewer';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { QtyStepper } from '@/components/QtyStepper';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { catalogPages, findShopProduct, formatINR, productTitle } from '@/data/shop';
import { useAppUI } from '@/providers/AppUIProvider';
import { useCart } from '@/providers/CartProvider';
import { colors, radius, tabularNums, type } from '@/theme';

/** Option rows drawn in the first frame; the rest are below the fold and follow a frame later. */
const FIRST_OPTIONS = 8;

const SOURCE_NAMES = { master: 'Master Catalogue', office: 'Office Partition Price List', tavic: 'Tavic Wardrobe & Sliding Price List' };

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = findShopProduct(id ?? '');
  const { showToast } = useAppUI();
  const { add } = useCart();
  const [optionIndex, setOptionIndex] = useState(0);
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);
  const [pageOpen, setPageOpen] = useState(false);
  // A light first render lets the push animation start sooner; long option lists, specs and the
  // catalogue page are added on the next frame.
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setComplete(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!product) {
    return (
      <Screen title="Product" titleDisplay="inline" back={{ fallback: '/' }} grouped>
        <EmptyState icon="cube-outline" title="Product Not Found" message="This product is no longer in the catalogue." />
      </Screen>
    );
  }

  const option = product.options?.[optionIndex];
  const pageImage = catalogPages[`${product.catalogPage.source}-${product.catalogPage.page}`];
  const pageTitle = `${SOURCE_NAMES[product.catalogPage.source]} · page ${product.catalogPage.page}`;

  const addToCart = () => {
    add({ productId: product.id, optionIndex: product.options ? optionIndex : undefined, note: product.options ? undefined : note }, qty);
    showToast(`Added ${qty} × ${product.code} to your cart.`);
    setQty(1);
  };

  return (
    <Screen title={product.code} titleDisplay="inline" back={{ fallback: '/' }} grouped>
      <View style={styles.media}>
        {product.image ? (
          <Image source={product.image} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} />
        ) : (
          <Ionicons name="cube-outline" size={56} color={colors.tertiaryLabel} />
        )}
      </View>

      <Text style={styles.section}>{product.section}</Text>
      <Text style={styles.title} accessibilityRole="header">
        {productTitle(product)}
      </Text>

      {option ? (
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatINR(option.mrp)}</Text>
          <Text style={styles.priceNote}>MRP per {product.options && product.options.length > 1 ? 'selected option' : 'unit'}</Text>
        </View>
      ) : (
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={colors.secondaryLabel} />
          <Text style={styles.infoText}>Sizes, finishes and MRP are on the catalogue page below. Add your requirement and we’ll confirm the price.</Text>
        </View>
      )}

      {product.options && (
        <InsetGroup header="Option" style={styles.block}>
          {(complete ? product.options : product.options.slice(0, FIRST_OPTIONS)).map((item, index) => {
            const selected = index === optionIndex;
            return (
              <Pressable
                key={`${item.label}-${index}`}
                onPress={() => setOptionIndex(index)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${item.label}, ${formatINR(item.mrp)}`}
                style={({ pressed }) => [styles.option, pressed && styles.rowPressed]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>{item.label}</Text>
                  {item.code && <Text style={styles.optionCode}>{item.code}</Text>}
                </View>
                <Text style={styles.optionPrice}>{formatINR(item.mrp)}</Text>
                <View style={styles.check}>{selected && <Ionicons name="checkmark" size={20} color={colors.tint} />}</View>
              </Pressable>
            );
          })}
        </InsetGroup>
      )}

      {!product.options && (
        <TextField
          label="Your requirement"
          value={note}
          onChangeText={setNote}
          placeholder="Size / finish, e.g. 450 mm, SSS"
          accessibilityLabel="Size and finish required"
          containerStyle={styles.block}
        />
      )}

      <View style={styles.buyRow}>
        <QtyStepper value={qty} onChange={setQty} label={product.code} />
        <Button label="Add to Cart" icon="cart" onPress={addToCart} style={styles.addButton} />
      </View>
      <Button label="View Cart" variant="plain" size="medium" onPress={() => router.push('/cart')} style={styles.viewCart} />

      {complete && product.specs && (
        <InsetGroup header="Specifications" style={styles.block}>
          {product.specs.map((spec) => (
            <ValueRow key={spec.label} label={spec.label} value={spec.value} />
          ))}
        </InsetGroup>
      )}

      {complete && pageImage && (
        <InsetGroup header="Catalogue page" style={styles.block}>
          <Pressable
            onPress={() => setPageOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${pageTitle}`}
            style={({ pressed }) => [styles.pageRow, pressed && styles.rowPressed]}
          >
            <Image source={pageImage} style={styles.pageThumb} contentFit="cover" contentPosition="top" />
            <View style={{ flex: 1 }}>
              <Text style={type.subheadline}>{pageTitle}</Text>
              <Text style={styles.pageHint}>All sizes, finishes and MRP</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.tertiaryLabel} />
          </Pressable>
        </InsetGroup>
      )}

      <CatalogPageViewer visible={pageOpen} source={pageImage} title={pageTitle} onClose={() => setPageOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  media: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: radius.lg,
  },
  section: { ...type.subheadline, marginTop: 16, color: colors.secondaryLabel },
  title: { ...type.title2, marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8, marginTop: 8 },
  price: { ...type.title2, fontWeight: '600', ...tabularNums },
  priceNote: { ...type.footnote, color: colors.secondaryLabel },
  infoBox: { flexDirection: 'row', gap: 8, marginTop: 12, padding: 12, backgroundColor: colors.card, borderRadius: radius.md },
  infoText: { ...type.footnote, flex: 1, color: colors.secondaryLabel },
  block: { marginTop: 24, marginBottom: 0 },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 16, paddingRight: 12 },
  rowPressed: { backgroundColor: colors.fill },
  optionCode: { ...type.footnote, marginTop: 1, color: colors.secondaryLabel },
  optionPrice: { ...type.body, flexShrink: 0, color: colors.secondaryLabel, ...tabularNums },
  check: { width: 22, alignItems: 'center' },
  buyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24 },
  addButton: { flex: 1 },
  viewCart: { marginTop: 6, alignSelf: 'center' },
  pageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 12, paddingRight: 12 },
  pageThumb: { width: 52, height: 72, borderRadius: 4, backgroundColor: colors.white },
  pageHint: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
});
