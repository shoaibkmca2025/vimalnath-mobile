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
import { useAppUI } from '@/providers/AppUIProvider';
import { unitPrice, useCart, type CartLine } from '@/providers/CartProvider';
import { useOrders, type OrderDetails } from '@/providers/OrdersProvider';
import { colors, radius, type } from '@/theme';

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
    showToast(`Order ${order.number} placed.`);
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
              <CartLineRow key={`${line.productId}|${line.optionIndex ?? ''}|${line.note ?? ''}`} line={line} onChange={(qty) => setQty(line, qty)} />
            ))}
          </InsetGroup>

          <InsetGroup header="Summary" footer={onRequest > 0 ? 'Lines priced from the catalogue aren’t included in the total.' : undefined}>
            <ValueRow label="Items" value={String(count)} />
            {onRequest > 0 && <ValueRow label="Priced from catalogue" value={`${onRequest} line${onRequest > 1 ? 's' : ''}`} />}
            <ValueRow label="Total (MRP)" value={formatINR(subtotal)} emphasized />
          </InsetGroup>

          <Button label="Place Order" onPress={() => setCheckoutOpen(true)} />
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
        style={({ pressed }) => [styles.lineMedia, pressed && { opacity: 0.7 }]}
      >
        {product.image ? (
          <Image source={product.image} style={StyleSheet.absoluteFill} contentFit="contain" />
        ) : (
          <Ionicons name="cube-outline" size={24} color={colors.tertiaryLabel} />
        )}
      </Pressable>
      <View style={styles.lineCopy}>
        <Text style={styles.lineCode}>{product.code}</Text>
        <Text style={type.subheadline} numberOfLines={2}>
          {productTitle(product)}
        </Text>
        {(option || line.note) && (
          <Text style={styles.lineDetail} numberOfLines={2}>
            {option?.label ?? line.note}
          </Text>
        )}
        <View style={styles.lineFooter}>
          <Text style={[type.headline, styles.linePrice]}>{price === undefined ? 'From catalogue' : formatINR(price * line.qty)}</Text>
          <QtyStepper value={line.qty} onChange={onChange} label={product.code} removable />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  lineFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  linePrice: { flexShrink: 1 },
  continue: { marginTop: 8, alignSelf: 'center' },
});
