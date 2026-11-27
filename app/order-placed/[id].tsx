import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { addressLine } from '@/components/AddressFields';
import { Button } from '@/components/Button';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { formatINR } from '@/data/shop';
import { getAdminSyncStatus, subscribeAdminSync } from '@/lib/admin-sync';
import { formatPhone } from '@/lib/format';
import { useOrders } from '@/providers/OrdersProvider';
import { colors, type } from '@/theme';

/**
 * After Place Order: the order is safe on this phone and on its way to the shop. Shows where it goes and whether it has
 * reached the shop yet (without signal it goes by itself later; the shop's confirmation arrives as a notification).
 */
export default function OrderPlacedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { orders } = useOrders();
  const order = orders.find((one) => one.id === id);
  const [pending, setPending] = useState(() => getAdminSyncStatus().pending);
  useEffect(() => subscribeAdminSync((status) => setPending(status.pending)), []);

  const delivery = order?.delivery;
  const sent = pending === 0;
  return (
    <Screen title="Order Placed" titleDisplay="inline" grouped>
      <View style={styles.hero} accessible accessibilityRole="header" accessibilityLabel={`Order ${order?.number ?? ''} placed. ${sent ? 'Sent to the shop.' : 'It goes to the shop as soon as the phone is online.'}`}>
        <View style={styles.check}>
          <Ionicons name="checkmark" size={44} color={colors.white} />
        </View>
        <Text style={styles.title}>Thank you!</Text>
        <Text style={styles.subtitle}>Order {order?.number ?? ''} is placed.</Text>
        <View style={[styles.status, sent ? styles.statusSent : styles.statusWaiting]}>
          <Ionicons name={sent ? 'cloud-done-outline' : 'cloud-upload-outline'} size={16} color={sent ? colors.green : colors.orange} />
          <Text style={[styles.statusText, { color: sent ? colors.green : colors.orange }]}>{sent ? 'Sent to Vimalnath' : 'Waiting for signal: it goes by itself'}</Text>
        </View>
      </View>

      {order && (
        <InsetGroup header="Order" footer="You’ll get a notification when the shop confirms, dispatches and delivers it.">
          <ValueRow label="Items" value={String(order.lines.reduce((sum, line) => sum + line.qty, 0))} />
          <ValueRow label="Total (MRP)" value={formatINR(order.total)} emphasized />
        </InsetGroup>
      )}

      {delivery && (
        <InsetGroup header="Delivering to">
          <View style={styles.delivery}>
            <Text style={styles.receiver}>{delivery.receiverName}</Text>
            <Text style={styles.detail}>{formatPhone(delivery.contact)}{delivery.alternateContact ? ` · ${formatPhone(delivery.alternateContact)}` : ''}</Text>
            {delivery.siteName ? <Text style={styles.detail}>Site: {delivery.siteName}</Text> : null}
            <Text style={styles.detail}>{addressLine(delivery)}</Text>
            {delivery.instructions ? <Text style={styles.detail}>“{delivery.instructions}”</Text> : null}
          </View>
        </InsetGroup>
      )}

      <View style={styles.actions}>
        {order && <Button label="Track Order" icon="navigate-outline" onPress={() => router.replace({ pathname: '/order/[id]', params: { id: order.id } })} />}
        <Button label="Continue Shopping" variant="plain" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 6, paddingTop: 16, paddingBottom: 28 },
  check: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', marginBottom: 10, borderRadius: 42, backgroundColor: colors.green },
  title: { ...type.title1, fontWeight: '700' },
  subtitle: { ...type.body, color: colors.secondaryLabel },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16 },
  statusSent: { backgroundColor: 'rgba(36, 138, 61, 0.12)' },
  statusWaiting: { backgroundColor: colors.orangeFill },
  statusText: { ...type.footnote, fontWeight: '600' },
  delivery: { gap: 2, paddingVertical: 12, paddingHorizontal: 16 },
  receiver: { ...type.body, fontWeight: '600' },
  detail: { ...type.subheadline, color: colors.secondaryLabel },
  actions: { gap: 8, marginBottom: 24 },
});
