import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { findShopProduct, formatINR } from '@/data/shop';
import { useShopOrders } from '@/lib/admin-sync';
import { formatOrderDate } from '@/lib/format';
import { buildOrderHtml } from '@/lib/order-pdf';
import { pdfFileName, sharePdf } from '@/lib/pdf-export';
import { useAppUI } from '@/providers/AppUIProvider';
import { useCart } from '@/providers/CartProvider';
import { orderLineTotal, useOrders } from '@/providers/OrdersProvider';
import { colors, tabularNums, type } from '@/theme';

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { orders, removeOrder } = useOrders();
  const { add } = useCart();
  const { showToast } = useAppUI();
  const [sharing, setSharing] = useState(false);
  const order = orders.find((item) => item.id === id);
  const shop = useShopOrders().get(id);

  if (!order) {
    return (
      <Screen title="Order" titleDisplay="inline" back={{ fallback: '/orders', label: 'Orders' }} grouped>
        <EmptyState icon="receipt-outline" title="Order Not Found" message="This order may have been deleted." />
      </Screen>
    );
  }

  // Once the order reaches the shop, its shop number and status replace the ones this phone gave it, so the
  // customer and the shop quote the same number.
  const number = shop?.number ?? order.number;
  const status = shop?.status ?? order.status;

  const share = async () => {
    setSharing(true);
    try {
      await sharePdf(buildOrderHtml({ ...order, number, status }), pdfFileName(`${number} ${order.customer}`), `Share order ${number}`);
    } catch (err) {
      console.error('Order PDF export failed:', err);
      const reason = err instanceof Error && err.message ? err.message : 'Unknown error';
      showToast(`Couldn’t create the PDF: ${reason}`);
    } finally {
      setSharing(false);
    }
  };

  const reorder = () => {
    let added = 0;
    for (const line of order.lines) {
      const product = findShopProduct(line.productId);
      if (!product) continue;
      // By name, not position: a catalogue update can add or move options.
      const optionIndex = line.optionIndex === undefined ? undefined : (product.options?.findIndex((option) => option.label === line.option) ?? -1);
      if (optionIndex === -1) continue;
      add({ productId: line.productId, optionIndex, note: line.note }, line.qty);
      added += 1;
    }
    const missing = order.lines.length - added;
    showToast(
      added
        ? `Added ${added} product${added === 1 ? '' : 's'} to your cart.${missing ? ` ${missing} no longer in the catalogue.` : ''}`
        : 'These products are no longer in the catalogue.',
    );
    if (added) router.push('/cart');
  };

  const remove = () => {
    const doRemove = () => {
      removeOrder(order.id);
      router.replace('/orders');
    };
    if (Platform.OS === 'web') {
      doRemove();
      return;
    }
    Alert.alert('Delete This Order?', `${number} will be removed from this phone. This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doRemove },
    ]);
  };

  const unpriced = order.lines.filter((line) => line.mrp === undefined).length;

  return (
    <Screen title={number} subtitle={formatOrderDate(order.createdAt)} back={{ fallback: '/orders', label: 'Orders' }} grouped>
      <InsetGroup header="Details">
        <ValueRow label="Status" value={status} />
        {number !== order.number ? <ValueRow label="Number on this phone" value={order.number} /> : null}
        <ValueRow label="Customer / site" value={order.customer} />
        {order.phone ? <ValueRow label="Phone" value={order.phone} /> : null}
        {order.notes ? <ValueRow label="Notes" value={order.notes} /> : null}
      </InsetGroup>

      {shop?.history?.length ? (
        <InsetGroup header="Progress at the shop">
          {shop.history.map((step, index) => (
            <ValueRow key={`${step.status}-${index}`} label={step.status} value={formatOrderDate(step.at)} />
          ))}
        </InsetGroup>
      ) : null}

      <InsetGroup header="Items">
        {order.lines.map((line, index) => {
          const total = orderLineTotal(line);
          return (
            <View key={`${line.productId}-${index}`} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineCode}>{line.code}</Text>
                <Text style={type.subheadline}>{line.name}</Text>
                {(line.option || line.note) && <Text style={styles.lineDetail}>{line.option ?? line.note}</Text>}
                <Text style={styles.lineDetail}>
                  {line.qty} × {line.mrp === undefined ? 'price from catalogue' : formatINR(line.mrp)}
                </Text>
              </View>
              <Text style={styles.lineTotal}>{total === undefined ? '—' : formatINR(total)}</Text>
            </View>
          );
        })}
      </InsetGroup>

      <InsetGroup
        footer={unpriced > 0 ? `${unpriced} product${unpriced === 1 ? ' is' : 's are'} priced from the catalogue and not included in the total.` : undefined}
      >
        <ValueRow label="Total (MRP)" value={formatINR(order.total)} emphasized />
      </InsetGroup>

      <View style={styles.actions}>
        <Button label="Share PDF" icon="share-outline" loading={sharing} loadingLabel="Creating PDF…" onPress={share} />
        <Button label="Reorder" icon="refresh-outline" variant="gray" onPress={reorder} />
        <Button label="Delete Order" icon="trash-outline" variant="gray" destructive onPress={remove} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  lineCode: { ...type.caption1, color: colors.secondaryLabel, fontWeight: '500' },
  lineDetail: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
  lineTotal: { ...type.subheadline, fontWeight: '600', ...tabularNums },
  actions: { gap: 12 },
});
