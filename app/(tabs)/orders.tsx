import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { formatINR } from '@/data/shop';
import { syncAdmin, useShopOrders, useShopRequests } from '@/lib/admin-sync';
import { formatOrderDate } from '@/lib/format';
import { useOrders } from '@/providers/OrdersProvider';
import { colors, tabularNums, type } from '@/theme';

type Row = { key: string; number: string; customer: string; total: number; createdAt: string; status: string; items: number; fromShop: boolean; open: () => void };

export default function OrdersScreen() {
  const { orders } = useOrders();
  const shop = useShopOrders();
  const requests = useShopRequests();

  // Requests from the shop arrive with a sync, so check each time the tab is opened.
  useFocusEffect(
    useCallback(() => {
      void syncAdmin();
    }, []),
  );

  const waiting = requests.filter((order) => order.status === 'Requested');
  const openShopOrder = (id: string) => router.push({ pathname: '/shop-order/[id]', params: { id } });

  // This phone's own orders and the shop's orders it confirmed or declined, newest first.
  const rows: Row[] = [
    ...orders.map((order) => {
      // Once the order reaches the shop, its shop number and status replace the ones this phone gave it.
      const remote = shop.get(order.id);
      return {
        key: `local-${order.id}`,
        number: remote?.number ?? order.number,
        customer: order.customer,
        total: order.total,
        createdAt: order.createdAt,
        status: remote?.status ?? order.status,
        items: order.lines.reduce((sum, line) => sum + line.qty, 0),
        fromShop: false,
        open: () => router.push({ pathname: '/order/[id]', params: { id: order.id } }),
      };
    }),
    ...requests
      .filter((order) => order.status !== 'Requested')
      .map((order) => ({
        key: `shop-${order.id}`,
        number: order.number ?? 'Shop order',
        customer: order.details.customer,
        total: order.details.total,
        createdAt: order.details.createdAt,
        status: order.status,
        items: order.details.lines.reduce((sum, line) => sum + line.qty, 0),
        fromShop: true,
        open: () => openShopOrder(order.id),
      })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const subtitle = waiting.length
    ? `${waiting.length} waiting for your confirmation`
    : rows.length
      ? `${rows.length} order${rows.length === 1 ? '' : 's'}`
      : undefined;

  return (
    <Screen title="Orders" subtitle={subtitle} grouped>
      {waiting.length > 0 && (
        <InsetGroup header="Waiting for Your Confirmation" footer="The shop made these orders for you. Open one to check it, then confirm or decline." separatorInset={64}>
          {waiting.map((order) => {
            const items = order.details.lines.reduce((sum, line) => sum + line.qty, 0);
            return (
              <Pressable
                key={order.id}
                onPress={() => openShopOrder(order.id)}
                accessibilityRole="button"
                accessibilityLabel={`Order ${order.number} from the shop for ${order.details.customer}, ${formatINR(order.details.total)}, waiting for your confirmation`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.icon, styles.requestIcon]}>
                  <Ionicons name="paper-plane-outline" size={19} color={colors.orange} />
                </View>
                <View style={styles.copy}>
                  <View style={styles.titleLine}>
                    <Text style={[type.headline, styles.shrink]} numberOfLines={1}>
                      {order.number}
                    </Text>
                    <Text style={styles.total}>{formatINR(order.details.total)}</Text>
                  </View>
                  <Text style={styles.customer} numberOfLines={1}>
                    {order.details.customer}
                  </Text>
                  <Text style={[styles.meta, styles.waiting]} numberOfLines={1}>
                    Tap to confirm · {items} item{items === 1 ? '' : 's'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.tertiaryLabel} />
              </Pressable>
            );
          })}
        </InsetGroup>
      )}

      {rows.length === 0 && waiting.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No Orders Yet"
          message="Orders you place from your cart are saved here, ready to share as a PDF. Orders the shop sends you appear here too."
          action={{ label: 'Browse Products', onPress: () => router.navigate('/') }}
        />
      ) : rows.length > 0 ? (
        <InsetGroup header={waiting.length ? 'Order History' : undefined} separatorInset={64}>
          {rows.map((row) => (
            <Pressable
              key={row.key}
              onPress={row.open}
              accessibilityRole="button"
              accessibilityLabel={`Order ${row.number} for ${row.customer}, ${formatINR(row.total)}, ${row.status}, ${formatOrderDate(row.createdAt)}`}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.icon}>
                <Ionicons name={row.fromShop ? 'storefront-outline' : 'receipt-outline'} size={19} color={colors.tint} />
              </View>
              <View style={styles.copy}>
                <View style={styles.titleLine}>
                  <Text style={[type.headline, styles.shrink]} numberOfLines={1}>
                    {row.number}
                  </Text>
                  <Text style={styles.total}>{formatINR(row.total)}</Text>
                </View>
                <Text style={styles.customer} numberOfLines={1}>
                  {row.customer}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {row.status} · {formatOrderDate(row.createdAt)} · {row.items} item{row.items === 1 ? '' : 's'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.tertiaryLabel} />
            </Pressable>
          ))}
        </InsetGroup>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 12 },
  rowPressed: { backgroundColor: colors.fill },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tintFill, borderRadius: 8 },
  requestIcon: { backgroundColor: colors.orangeFill },
  copy: { flex: 1, gap: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  shrink: { flexShrink: 1 },
  total: { ...type.subheadline, fontWeight: '600', ...tabularNums },
  customer: { ...type.subheadline },
  meta: { ...type.footnote, color: colors.secondaryLabel },
  waiting: { color: colors.orange, fontWeight: '600' },
});
