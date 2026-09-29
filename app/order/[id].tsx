import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { findShopProduct, formatINR } from '@/data/shop';
import { formatOrderDate } from '@/lib/format';
import { buildOrderHtml } from '@/lib/order-pdf';
import { pdfFileName, sharePdf } from '@/lib/pdf-export';
import { useAppUI } from '@/providers/AppUIProvider';
import { useCart } from '@/providers/CartProvider';
import { orderLineTotal, useOrders } from '@/providers/OrdersProvider';
import { colors, fonts, type } from '@/theme';

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { orders, removeOrder } = useOrders();
  const { add } = useCart();
  const { showToast } = useAppUI();
  const [sharing, setSharing] = useState(false);
  const order = orders.find((item) => item.id === id);

  if (!order) {
    return (
      <Screen>
        <PageHeader eyebrow="ORDER" title="Order not found" fallback="/orders" />
        <Text style={type.body}>This order may have been deleted.</Text>
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
      showToast(`Could not create the PDF: ${reason}`);
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
    showToast(added ? `Added ${added} product${added === 1 ? '' : 's'} to cart.` : 'These products are no longer in the catalogue.');
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
    Alert.alert('Delete order?', `${order.number} will be removed from this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doRemove },
    ]);
  };

  const unpriced = order.lines.filter((line) => line.mrp === undefined).length;

  return (
    <Screen>
      <PageHeader eyebrow="ORDER DETAILS" title={order.number} fallback="/orders" />

      <View style={styles.statusCard}>
        <View style={styles.statusIcon}>
          <Feather name="check" size={20} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.statusTitle}>Order {order.status.toLowerCase()}</Text>
          <Text style={styles.statusMeta}>{formatOrderDate(order.createdAt)}</Text>
        </View>
      </View>

      <View style={styles.party}>
        <Detail label="Customer / site" value={order.customer} />
        {order.phone && <Detail label="Phone" value={order.phone} />}
        {order.notes && <Detail label="Notes" value={order.notes} />}
      </View>

      <Text style={[type.label, styles.blockLabel]}>ITEMS</Text>
      <View style={styles.lines}>
        {order.lines.map((line, index) => {
          const total = orderLineTotal(line);
          return (
            <View key={`${line.productId}-${index}`} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineCode}>{line.code}</Text>
                <Text style={styles.lineName}>{line.name}</Text>
                {(line.option || line.note) && <Text style={styles.lineDetail}>{line.option ?? line.note}</Text>}
                <Text style={styles.lineQty}>
                  {line.qty} × {line.mrp === undefined ? 'price from catalogue' : formatINR(line.mrp)}
                </Text>
              </View>
              <Text style={styles.lineTotal}>{total === undefined ? '—' : formatINR(total)}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total (MRP)</Text>
        <Text style={styles.totalValue}>{formatINR(order.total)}</Text>
      </View>
      {unpriced > 0 && (
        <Text style={styles.footnote}>
          {unpriced} product{unpriced === 1 ? ' is' : 's are'} priced from the catalogue and not included in the total.
        </Text>
      )}

      <Pressable
        onPress={share}
        disabled={sharing}
        accessibilityRole="button"
        accessibilityLabel="Share order as PDF"
        style={({ pressed }) => [styles.primary, pressed && { backgroundColor: colors.blueDark }]}
      >
        {sharing ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <>
            <Feather name="share-2" size={17} color={colors.white} />
            <Text style={styles.primaryText}>Share order PDF</Text>
          </>
        )}
      </Pressable>
      <View style={styles.secondaryRow}>
        <Pressable onPress={reorder} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && { backgroundColor: colors.blueTint }]}>
          <Feather name="rotate-ccw" size={16} color={colors.blue} />
          <Text style={styles.secondaryText}>Reorder</Text>
        </Pressable>
        <Pressable onPress={remove} accessibilityRole="button" style={({ pressed }) => [styles.secondary, styles.danger, pressed && { backgroundColor: colors.redTint }]}>
          <Feather name="trash-2" size={16} color={colors.red} />
          <Text style={[styles.secondaryText, { color: colors.red }]}>Delete</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.blue, borderRadius: 16 },
  statusIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20 },
  statusTitle: { color: colors.white, fontFamily: fonts.display, fontSize: 17 },
  statusMeta: { marginTop: 2, color: '#dbe5ff', fontFamily: fonts.regular, fontSize: 12 },
  party: { marginTop: 14, padding: 14, gap: 8, backgroundColor: colors.blueWash, borderRadius: 16 },
  detailRow: { flexDirection: 'row', gap: 12 },
  detailLabel: { width: 108, color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  detailValue: { flex: 1, color: colors.ink, fontFamily: fonts.semibold, fontSize: 13 },
  blockLabel: { marginTop: 22, marginBottom: 10 },
  lines: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, overflow: 'hidden' },
  line: { flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  lineCode: { color: colors.blue, fontFamily: fonts.bold, fontSize: 11 },
  lineName: { marginTop: 2, color: colors.ink, fontFamily: fonts.semibold, fontSize: 14 },
  lineDetail: { marginTop: 2, color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  lineQty: { marginTop: 6, color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  lineTotal: { color: colors.ink, fontFamily: fonts.bold, fontSize: 14 },
  totalCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, padding: 16, backgroundColor: colors.blueTint, borderRadius: 16 },
  totalLabel: { color: colors.ink, fontFamily: fonts.bold, fontSize: 15 },
  totalValue: { color: colors.ink, fontFamily: fonts.display, fontSize: 21 },
  footnote: { marginTop: 8, color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  primary: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    backgroundColor: colors.blue,
    borderRadius: 15,
  },
  primaryText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  secondaryRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  secondary: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#c9d8ff',
    borderRadius: 14,
  },
  danger: { borderColor: '#f6c6c3' },
  secondaryText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 14 },
});
