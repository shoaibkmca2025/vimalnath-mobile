import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { Pill, ScreenTitle } from '@/components/ScreenTitle';
import { formatINR } from '@/data/shop';
import { formatOrderDate } from '@/lib/format';
import { useOrders } from '@/providers/OrdersProvider';
import { colors, fonts } from '@/theme';

export default function OrdersScreen() {
  const { orders } = useOrders();

  return (
    <Screen>
      <ScreenTitle eyebrow="PURCHASE HISTORY" title="Orders" accessory={<Pill>{`${orders.length} order${orders.length === 1 ? '' : 's'}`}</Pill>} />

      {orders.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Feather name="package" size={22} color={colors.blue} />
          </View>
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyBody}>Add products to your cart and place an order. It will be saved here.</Text>
          <Pressable onPress={() => router.navigate('/')} accessibilityRole="button" style={({ pressed }) => [styles.browse, pressed && { backgroundColor: colors.blueDark }]}>
            <Text style={styles.browseText}>Browse products</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {orders.map((order) => {
            const items = order.lines.reduce((sum, line) => sum + line.qty, 0);
            return (
              <Pressable
                key={order.id}
                onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Order ${order.number} for ${order.customer}, ${formatINR(order.total)}`}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardIcon}>
                    <Feather name="file-text" size={18} color={colors.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.number}>{order.number}</Text>
                    <Text style={styles.date}>{formatOrderDate(order.createdAt)}</Text>
                  </View>
                  <View style={styles.status}>
                    <Text style={styles.statusText}>{order.status}</Text>
                  </View>
                </View>
                <Text style={styles.customer} numberOfLines={1}>
                  {order.customer}
                </Text>
                <View style={styles.cardBottom}>
                  <Text style={styles.items}>
                    {items} item{items === 1 ? '' : 's'} · {order.lines.length} product{order.lines.length === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.total}>{formatINR(order.total)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', padding: 24, backgroundColor: colors.blueWash, borderWidth: 1, borderStyle: 'dashed', borderColor: '#c9d8ff', borderRadius: 18 },
  emptyIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 10, backgroundColor: colors.blueTint, borderRadius: 24 },
  emptyTitle: { color: colors.ink, fontFamily: fonts.display, fontSize: 17 },
  emptyBody: { marginTop: 4, color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  browse: { marginTop: 16, paddingHorizontal: 20, height: 46, justifyContent: 'center', backgroundColor: colors.blue, borderRadius: 13 },
  browseText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  list: { gap: 12 },
  card: { padding: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 18, boxShadow: '0 5px 15px rgba(20, 30, 50, 0.05)' },
  cardPressed: { borderColor: '#bcd0ff', transform: [{ scale: 0.99 }] },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.blueTint, borderRadius: 12 },
  number: { color: colors.ink, fontFamily: fonts.display, fontSize: 16 },
  date: { marginTop: 2, color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  status: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.blueTint, borderRadius: 10 },
  statusText: { color: colors.blue, fontFamily: fonts.bold, fontSize: 11 },
  customer: { marginTop: 12, color: colors.ink, fontFamily: fonts.semibold, fontSize: 14 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line },
  items: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  total: { color: colors.ink, fontFamily: fonts.display, fontSize: 17 },
});
