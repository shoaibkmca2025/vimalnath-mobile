import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { findShopProduct, formatINR } from '@/data/shop';
import { formatOrderDate } from '@/lib/format';
import { buildOrderHtml } from '@/lib/order-pdf';
import { pdfFileName, sharePdf } from '@/lib/pdf-export';
import { useAppUI } from '@/providers/AppUIProvider';
import { useCart } from '@/providers/CartProvider';
import { orderLineTotal, useOrders } from '@/providers/OrdersProvider';
import { colors, type } from '@/theme';

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { orders, removeOrder } = useOrders();
  const { add } = useCart();
  const { showToast } = useAppUI();
  const [sharing, setSharing] = useState(false);
  const order = orders.find((item) => item.id === id);

  if (!order) {
    return (
      <Screen title="Order" titleDisplay="inline" back={{ fallback: '/orders', label: 'Orders' }} grouped>
        <EmptyState icon="receipt-outline" title="Order Not Found" message="This order may have been deleted." />
      </Screen>
    );
  }

  const share = async () => {
    setSharing(true);
    try {
      await sharePdf(buildOrderHtml(order), pdfFileName(`${order.number} ${order.customer}`), `Share order ${order.number}`);
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
      if (!findShopProduct(line.productId)) continue;
      add({ productId: line.productId, optionIndex: line.optionIndex, note: line.note }, line.qty);
      added += 1;
    }
    showToast(added ? `Added ${added} product${added === 1 ? '' : 's'} to your cart.` : 'These products are no longer in the catalogue.');
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
    Alert.alert('Delete This Order?', `${order.number} will be removed from this phone. This can’t be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doRemove },
    ]);
  };

  const unpriced = order.lines.filter((line) => line.mrp === undefined).length;

  return (
    <Screen title={order.number} subtitle={formatOrderDate(order.createdAt)} back={{ fallback: '/orders', label: 'Orders' }} grouped>
      <InsetGroup header="Details">
        <ValueRow label="Status" value={order.status} />
        <ValueRow label="Customer / site" value={order.customer} />
        {order.phone ? <ValueRow label="Phone" value={order.phone} /> : null}
        {order.notes ? <ValueRow label="Notes" value={order.notes} /> : null}
      </InsetGroup>

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
  lineTotal: { ...type.subheadline, fontWeight: '600', fontVariant: ['tabular-nums'] },
  actions: { gap: 12 },
});
