import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PageHeader } from '@/components/PageHeader';
import { PlaceOrderSheet } from '@/components/PlaceOrderSheet';
import { QtyStepper } from '@/components/QtyStepper';
import { Screen } from '@/components/Screen';
import { findShopProduct, formatINR, productTitle } from '@/data/shop';
import { useAppUI } from '@/providers/AppUIProvider';
import { unitPrice, useCart, type CartLine } from '@/providers/CartProvider';
import { useOrders, type OrderDetails } from '@/providers/OrdersProvider';
import { colors, fonts } from '@/theme';

export default function CartScreen() {
  const { showToast } = useAppUI();
  const { lines, count, setQty, clear } = useCart();
  const { placeOrder } = useOrders();
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const priced = lines.filter((line) => unitPrice(line) !== undefined);
  const subtotal = priced.reduce((sum, line) => sum + (unitPrice(line) ?? 0) * line.qty, 0);
  const onRequest = lines.length - priced.length;

  const confirm = (details: OrderDetails) => {
    const order = placeOrder(lines, details);
    clear();
    setCheckoutOpen(false);
    showToast(`Order ${order.number} placed. Your cart is now empty.`);
    router.replace({ pathname: '/order/[id]', params: { id: order.id } });
  };

  return (
    <Screen>
      <PageHeader
        eyebrow="YOUR ORDER"
        title="Cart"
        fallback="/"
        accessory={
          lines.length > 0 ? (
            <Pressable onPress={clear} accessibilityRole="button" accessibilityLabel="Clear cart" style={styles.clear}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          ) : undefined
        }
      />

      {lines.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Feather name="shopping-cart" size={22} color={colors.blue} />
          </View>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyBody}>Browse Hardware, Office Partition and sliding systems on the Home screen.</Text>
          <Pressable onPress={() => router.navigate('/')} accessibilityRole="button" style={({ pressed }) => [styles.browse, pressed && { backgroundColor: colors.blueDark }]}>
            <Text style={styles.browseText}>Browse products</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.lines}>
            {lines.map((line) => (
              <CartLineRow key={`${line.productId}|${line.optionIndex ?? ''}|${line.note ?? ''}`} line={line} onChange={(qty) => setQty(line, qty)} />
            ))}
          </View>

          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Items</Text>
              <Text style={styles.summaryValue}>{count}</Text>
            </View>
            {onRequest > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Priced from catalogue</Text>
                <Text style={styles.summaryValue}>{onRequest} line{onRequest > 1 ? 's' : ''}</Text>
              </View>
            )}
            <View style={[styles.summaryRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total (MRP)</Text>
              <Text style={styles.totalValue}>{formatINR(subtotal)}</Text>
            </View>
          </View>

          <Pressable
            onPress={() => setCheckoutOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Place order"
            style={({ pressed }) => [styles.placeButton, pressed && { backgroundColor: colors.blueDark }]}
          >
            <Feather name="check-circle" size={18} color={colors.white} />
            <Text style={styles.placeText}>Place order</Text>
          </Pressable>
          <Pressable onPress={() => router.navigate('/')} accessibilityRole="button" style={styles.continue}>
            <Text style={styles.continueText}>Continue shopping</Text>
          </Pressable>
        </>
      )}

      <PlaceOrderSheet
        visible={checkoutOpen}
        summary={`${count} item${count === 1 ? '' : 's'} · ${formatINR(subtotal)}${onRequest ? ` + ${onRequest} priced from catalogue` : ''}`}
        onClose={() => setCheckoutOpen(false)}
        onSubmit={confirm}
      />
    </Screen>
  );
}

function CartLineRow({ line, onChange }: { line: CartLine; onChange: (qty: number) => void }) {
  const product = findShopProduct(line.productId);
  if (!product) return null;
  const option = line.optionIndex === undefined ? undefined : product.options?.[line.optionIndex];
  const price = unitPrice(line);

  return (
    <View style={styles.line}>
      <Pressable
        onPress={() => router.push({ pathname: '/product/[id]', params: { id: product.id } })}
        accessibilityRole="button"
        accessibilityLabel={`Open ${product.code}`}
        style={styles.lineMedia}
      >
        {product.image ? <Image source={product.image} style={StyleSheet.absoluteFill} contentFit="contain" /> : <Feather name="package" size={22} color="#b9c8ec" />}
      </Pressable>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.lineCode}>{product.code}</Text>
        <Text style={styles.lineTitle} numberOfLines={2}>
          {productTitle(product)}
        </Text>
        {(option || line.note) && (
          <Text style={styles.lineDetail} numberOfLines={2}>
            {option?.label ?? line.note}
          </Text>
        )}
        <View style={styles.lineFooter}>
          <Text style={styles.linePrice}>{price === undefined ? 'Price from catalogue' : formatINR(price * line.qty)}</Text>
          <QtyStepper value={line.qty} onChange={onChange} label={product.code} removable />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clear: { paddingHorizontal: 12, paddingVertical: 8, marginTop: 6, backgroundColor: colors.blueTint, borderRadius: 10 },
  clearText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 13 },
  empty: { alignItems: 'center', padding: 24, backgroundColor: colors.blueWash, borderWidth: 1, borderStyle: 'dashed', borderColor: '#c9d8ff', borderRadius: 18 },
  emptyIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 10, backgroundColor: colors.blueTint, borderRadius: 24 },
  emptyTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: 17 },
  emptyBody: { marginTop: 4, color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  browse: { marginTop: 16, paddingHorizontal: 20, height: 46, justifyContent: 'center', backgroundColor: colors.blue, borderRadius: 13 },
  browseText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  lines: { gap: 10 },
  line: { flexDirection: 'row', gap: 12, padding: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16 },
  lineMedia: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 12 },
  lineCode: { color: colors.blue, fontFamily: fonts.bold, fontSize: 11 },
  lineTitle: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  lineDetail: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  lineFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  linePrice: { flexShrink: 1, color: colors.ink, fontFamily: fonts.display, fontSize: 15 },
  summary: { marginTop: 18, padding: 16, backgroundColor: colors.blueTint, borderRadius: 16, gap: 8 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  summaryValue: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 13 },
  totalRow: { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#c9d8ff' },
  totalLabel: { color: colors.ink, fontFamily: fonts.bold, fontSize: 15 },
  totalValue: { color: colors.ink, fontFamily: fonts.display, fontSize: 20 },
  placeButton: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: colors.blue,
    borderRadius: 15,
  },
  placeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  continue: { alignItems: 'center', paddingVertical: 14 },
  continueText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 14 },
});
