import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { formatINR } from '@/data/shop';
import { formatOrderDate } from '@/lib/format';
import { useOrders } from '@/providers/OrdersProvider';
import { colors, type } from '@/theme';

export default function OrdersScreen() {
  const { orders } = useOrders();

  return (
    <Screen title="Orders" subtitle={orders.length ? `${orders.length} order${orders.length === 1 ? '' : 's'} on this phone` : undefined} grouped>
      {orders.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No Orders Yet"
          message="Orders you place from your cart are saved here, ready to share as a PDF."
          action={{ label: 'Browse Products', onPress: () => router.navigate('/') }}
        />
      ) : (
        <InsetGroup separatorInset={64}>
          {orders.map((order) => {
            const items = order.lines.reduce((sum, line) => sum + line.qty, 0);
            return (
              <Pressable
                key={order.id}
                onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Order ${order.number} for ${order.customer}, ${formatINR(order.total)}, ${formatOrderDate(order.createdAt)}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.icon}>
                  <Ionicons name="receipt-outline" size={19} color={colors.tint} />
                </View>
                <View style={styles.copy}>
                  <View style={styles.titleLine}>
                    <Text style={[type.headline, styles.shrink]} numberOfLines={1}>
                      {order.number}
                    </Text>
                    <Text style={styles.total}>{formatINR(order.total)}</Text>
                  </View>
                  <Text style={styles.customer} numberOfLines={1}>
                    {order.customer}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {order.status} · {formatOrderDate(order.createdAt)} · {items} item{items === 1 ? '' : 's'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.tertiaryLabel} />
              </Pressable>
            );
          })}
        </InsetGroup>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 12 },
  rowPressed: { backgroundColor: colors.fill },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tintFill, borderRadius: 8 },
  copy: { flex: 1, gap: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  shrink: { flexShrink: 1 },
  total: { ...type.subheadline, fontWeight: '600', fontVariant: ['tabular-nums'] },
  customer: { ...type.subheadline },
  meta: { ...type.footnote, color: colors.secondaryLabel },
});
