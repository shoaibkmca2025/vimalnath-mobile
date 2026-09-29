import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CatalogPageViewer } from '@/components/CatalogPageViewer';
import { PageHeader } from '@/components/PageHeader';
import { QtyStepper } from '@/components/QtyStepper';
import { Screen } from '@/components/Screen';
import { catalogPages, findShopProduct, formatINR, productTitle, shopCategories } from '@/data/shop';
import { useAppUI } from '@/providers/AppUIProvider';
import { useCart } from '@/providers/CartProvider';
import { colors, fonts, type } from '@/theme';

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

  if (!product) {
    return (
      <Screen>
        <PageHeader eyebrow="PRODUCT" title="Product not found" fallback="/" />
        <Text style={type.body}>This product is no longer in the catalogue.</Text>
      </Screen>
    );
  }

  const category = shopCategories.find((item) => item.id === product.category);
  const option = product.options?.[optionIndex];
  const pageImage = catalogPages[`${product.catalogPage.source}-${product.catalogPage.page}`];
  const pageTitle = `${SOURCE_NAMES[product.catalogPage.source]} · page ${product.catalogPage.page}`;

  const addToCart = () => {
    add({ productId: product.id, optionIndex: product.options ? optionIndex : undefined, note: product.options ? undefined : note }, qty);
    showToast(`Added ${qty} × ${product.code} to cart.`);
    setQty(1);
  };

  return (
    <Screen>
      <PageHeader eyebrow={category?.label.toUpperCase() ?? 'PRODUCT'} title={product.code} fallback="/" />

      <View style={styles.media}>
        {product.image ? (
          <Image source={product.image} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} />
        ) : (
          <Feather name="package" size={48} color="#b9c8ec" />
        )}
      </View>

      <Text style={styles.section}>{product.section}</Text>
      <Text style={styles.title}>{productTitle(product)}</Text>

      {option ? (
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatINR(option.mrp)}</Text>
          <Text style={styles.priceNote}>MRP per {product.options && product.options.length > 1 ? 'selected option' : 'unit'}</Text>
        </View>
      ) : (
        <View style={styles.infoBox}>
          <Feather name="info" size={16} color={colors.blue} />
          <Text style={styles.infoText}>Sizes, finishes and MRP are on the catalogue page below. Add your requirement and we’ll confirm the price.</Text>
        </View>
      )}

      {product.options && (
        <>
          <Text style={[type.label, styles.blockLabel]}>CHOOSE OPTION</Text>
          <View style={styles.options}>
            {product.options.map((item, index) => {
              const selected = index === optionIndex;
              return (
                <Pressable
                  key={`${item.label}-${index}`}
                  onPress={() => setOptionIndex(index)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${item.label}, ${formatINR(item.mrp)}`}
                  style={[styles.option, selected && styles.optionActive]}
                >
                  <View style={[styles.radio, selected && styles.radioActive]}>{selected && <View style={styles.radioDot} />}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionLabel}>{item.label}</Text>
                    {item.code && <Text style={styles.optionCode}>{item.code}</Text>}
                  </View>
                  <Text style={styles.optionPrice}>{formatINR(item.mrp)}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {!product.options && (
        <>
          <Text style={[type.label, styles.blockLabel]}>YOUR REQUIREMENT</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Size / finish, e.g. 450mm, SSS"
            placeholderTextColor={colors.subtle}
            accessibilityLabel="Size and finish required"
            style={styles.noteInput}
          />
        </>
      )}

      <View style={styles.buyRow}>
        <QtyStepper value={qty} onChange={setQty} label={product.code} />
        <Pressable onPress={addToCart} accessibilityRole="button" accessibilityLabel="Add to cart" style={({ pressed }) => [styles.addButton, pressed && { backgroundColor: colors.blueDark }]}>
          <Feather name="shopping-cart" size={17} color={colors.white} />
          <Text style={styles.addText}>Add to cart</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => router.push('/cart')} accessibilityRole="button" style={styles.viewCart}>
        <Text style={styles.viewCartText}>View cart</Text>
        <Feather name="arrow-right" size={15} color={colors.blue} />
      </Pressable>

      {product.specs && (
        <>
          <Text style={[type.label, styles.blockLabel]}>SPECIFICATIONS</Text>
          <View style={styles.specs}>
            {product.specs.map((spec) => (
              <View key={spec.label} style={styles.specRow}>
                <Text style={styles.specLabel}>{spec.label}</Text>
                <Text style={styles.specValue}>{spec.value}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {pageImage && (
        <>
          <Text style={[type.label, styles.blockLabel]}>CATALOGUE PAGE</Text>
          <Pressable onPress={() => setPageOpen(true)} accessibilityRole="button" accessibilityLabel={`Open ${pageTitle}`} style={styles.pageCard}>
            <Image source={pageImage} style={styles.pageThumb} contentFit="cover" contentPosition="top" />
            <View style={styles.pageCopy}>
              <Text style={styles.pageTitle}>{pageTitle}</Text>
              <Text style={styles.pageHint}>All sizes, finishes and MRP · Tap to open</Text>
            </View>
            <Feather name="maximize-2" size={18} color={colors.blue} />
          </Pressable>
        </>
      )}

      <CatalogPageViewer visible={pageOpen} source={pageImage} title={pageTitle} onClose={() => setPageOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  media: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 20 },
  section: { marginTop: 16, color: colors.blue, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.3 },
  title: { marginTop: 4, color: colors.ink, fontFamily: fonts.display, fontSize: 22, lineHeight: 27, letterSpacing: -0.3 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 },
  price: { color: colors.ink, fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.5 },
  priceNote: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  infoBox: { flexDirection: 'row', gap: 10, marginTop: 12, padding: 12, backgroundColor: colors.blueTint, borderRadius: 12 },
  infoText: { flex: 1, color: colors.ink, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  blockLabel: { marginTop: 24, marginBottom: 10 },
  options: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
  },
  optionActive: { borderColor: colors.blue, backgroundColor: colors.blueWash },
  radio: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#b9c8ec', borderRadius: 10 },
  radioActive: { borderColor: colors.blue },
  radioDot: { width: 10, height: 10, backgroundColor: colors.blue, borderRadius: 5 },
  optionLabel: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  optionCode: { marginTop: 2, color: colors.muted, fontFamily: fonts.regular, fontSize: 11 },
  optionPrice: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  noteInput: {
    height: 50,
    paddingHorizontal: 14,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  buyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 },
  addButton: {
    flex: 1,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.blue,
    borderRadius: 14,
  },
  addText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  viewCart: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 6 },
  viewCartText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 14 },
  specs: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, overflow: 'hidden' },
  specRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line },
  specLabel: { width: '40%', color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  specValue: { flex: 1, color: colors.ink, fontFamily: fonts.semibold, fontSize: 13 },
  pageCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, backgroundColor: colors.blueWash, borderWidth: 1, borderColor: colors.line, borderRadius: 16 },
  pageThumb: { width: 64, height: 90, borderRadius: 8, backgroundColor: colors.white },
  pageCopy: { flex: 1 },
  pageTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  pageHint: { marginTop: 3, color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
});
