import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { PlaceOrderSheet } from '@/components/PlaceOrderSheet';
import { QtyStepper } from '@/components/QtyStepper';
import { BarButton, Screen } from '@/components/Screen';
import { findShopProduct, formatINR, productTitle } from '@/data/shop';
import { needsUpdate, stockOf, useAppContent, type StockStates } from '@/lib/content-sync';
import { useAppUI } from '@/providers/AppUIProvider';
import { unitPrice, useCart, type CartLine } from '@/providers/CartProvider';
import { useOrders, type OrderDetails } from '@/providers/OrdersProvider';
import { colors, radius, type } from '@/theme';

export default function CartScreen() {
  const { showToast } = useAppUI();
  const { lines, count, setQty, clear } = useCart();
  const { placeOrder } = useOrders();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // Module 9.6: the shop can stop versions it knows send bad orders. Subscribing also refreshes the lines after a download.
  const { settings, stock } = useAppContent();
  const outdated = needsUpdate(settings.minAppVersion);
  // Counted out at the shop since it went in the cart: it has to come out before the order can go.
  const outOfStock = lines.filter((line) => lineStock(stock, line) === 'out').length;

  const priced = lines.filter((line) => unitPrice(line) !== undefined);
  const subtotal = priced.reduce((sum, line) => sum + (unitPrice(line) ?? 0) * line.qty, 0);
  const onRequest = lines.length - priced.length;

  const confirm = (details: OrderDetails) => {
    // The sheet can still be tapped while it closes, and by then the cart is empty.
    if (!lines.length) return;
    const order = placeOrder(lines, details);
    clear();
    setCheckoutOpen(false);
    showToast(`Order ${order.number} sent to the shop.`);
    router.replace({ pathname: '/order/[id]', params: { id: order.id } });
  };

  return (
    <Screen
      title="Cart"
      subtitle={lines.length ? `${count} item${count === 1 ? '' : 's'}` : undefined}
      back={{ fallback: '/' }}
      trailing={lines.length > 0 ? <BarButton label="Clear" accessibilityLabel="Clear cart" onPress={clear} /> : null}
      grouped
    >
      {lines.length === 0 ? (
        <EmptyState
          icon="cart-outline"
          title="Your Cart Is Empty"
          message="Add hardware, office partitions and sliding systems from the Shop."
          action={{ label: 'Browse Products', onPress: () => router.navigate('/') }}
        />
      ) : (
        <>
          <InsetGroup separatorInset={92}>
            {lines.map((line) => (
              <CartLineRow key={`${line.productId}|${line.optionIndex ?? ''}|${line.note ?? ''}`} line={line} state={lineStock(stock, line)} onChange={(qty) => setQty(line, qty)} />
            ))}
          </InsetGroup>

          <InsetGroup header="Summary" footer={onRequest > 0 ? 'Lines priced from the catalogue aren’t included in the total.' : undefined}>
            <ValueRow label="Items" value={String(count)} />
            {onRequest > 0 && <ValueRow label="Priced from catalogue" value={`${onRequest} line${onRequest > 1 ? 's' : ''}`} />}
            <ValueRow label="Total (MRP)" value={formatINR(subtotal)} emphasized />
          </InsetGroup>

          {outdated && (
            <View style={styles.update} accessibilityRole="alert">
              <Ionicons name="arrow-up-circle" size={20} color={colors.red} />
              <Text style={styles.updateText}>Update the app to place orders. This version is older than {settings.companyName} accepts. Your cart is kept.</Text>
            </View>
          )}
          {outOfStock > 0 && (
            <View style={styles.update} accessibilityRole="alert">
              <Ionicons name="close-circle" size={20} color={colors.red} />
              <Text style={styles.updateText}>
                {outOfStock === 1 ? 'One item is' : `${outOfStock} items are`} out of stock at the shop. Remove {outOfStock === 1 ? 'it' : 'them'} to place the order.
              </Text>
            </View>
          )}
          <Button label="Place Order" disabled={outdated || outOfStock > 0} onPress={() => setCheckoutOpen(true)} />
          <Button label="Continue Shopping" variant="plain" size="medium" onPress={() => router.navigate('/')} style={styles.continue} />
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

/** The shop's stock word for a cart line's product and option. */
function lineStock(stock: StockStates, line: CartLine) {
  const option = line.optionIndex === undefined ? undefined : findShopProduct(line.productId)?.options?.[line.optionIndex];
  return stockOf(stock, line.productId, option?.label);
}

function CartLineRow({ line, state, onChange }: { line: CartLine; state: 'out' | 'low' | undefined; onChange: (qty: number) => void }) {
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
        style={({ pressed }) => [styles.lineMedia, pressed && { opacity: 0.7 }]}
      >
        {product.image ? (
          <Image cachePolicy="memory-disk" source={product.image} style={StyleSheet.absoluteFill} contentFit="contain" />
        ) : (
          <Ionicons name="cube-outline" size={24} color={colors.tertiaryLabel} />
        )}
      </Pressable>
      <View style={styles.lineCopy}>
        <Text style={styles.lineCode}>{product.code}</Text>
        <Text style={type.subheadline}>
          {productTitle(product)}
        </Text>
        {(option || line.note) && (
          <Text style={styles.lineDetail}>
            {option?.label ?? line.note}
          </Text>
        )}
        {state && <Text style={[styles.lineStock, state === 'out' && styles.lineStockOut]}>{state === 'out' ? 'Out of stock' : 'Low stock'}</Text>}
        <View style={styles.lineFooter}>
          <Text style={[type.headline, styles.linePrice]}>{price === undefined ? 'From catalogue' : formatINR(price * line.qty)}</Text>
          <QtyStepper value={line.qty} onChange={onChange} label={product.code} removable />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  update: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12, padding: 14, backgroundColor: colors.card, borderRadius: radius.md },
  updateText: { ...type.subheadline, flex: 1 },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  lineMedia: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: radius.sm,
  },
  lineCopy: { flex: 1, gap: 2 },
  lineCode: { ...type.caption1, color: colors.secondaryLabel, fontWeight: '500' },
  lineDetail: { ...type.footnote, color: colors.secondaryLabel },
  lineStock: { ...type.footnote, fontWeight: '600', color: colors.orange },
  lineStockOut: { color: colors.red },
  lineFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  linePrice: { flexShrink: 1 },
  continue: { marginTop: 8, alignSelf: 'center' },
});
