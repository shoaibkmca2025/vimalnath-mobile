import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { formatINR } from '@/data/shop';
import { respondToShopOrder, useShopRequests } from '@/lib/admin-sync';
import { confirmDestructive } from '@/lib/confirm';
import { formatOrderDate } from '@/lib/format';
import { buildOrderHtml } from '@/lib/order-pdf';
import { pdfFileName, sharePdf } from '@/lib/pdf-export';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, tabularNums, type } from '@/theme';

/** An order the shop made and sent to this phone: confirm it (the shop then packs it) or decline it. */
export default function ShopOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useShopRequests().find((item) => item.id === id);
  const { showToast } = useAppUI();
  const [busy, setBusy] = useState<'confirm' | 'decline' | 'share' | null>(null);

  if (!order) {
    return (
      <Screen title="Order" titleDisplay="inline" back={{ fallback: '/orders', label: 'Orders' }} grouped>
        <EmptyState icon="receipt-outline" title="Order Not Found" message="This order isn’t on your shop connection any more." />
      </Screen>
    );
  }

  const { details } = order;
  const number = order.number ?? 'Shop order';
  const waiting = order.status === 'Requested';
  const unpriced = details.lines.filter((line) => line.mrp === undefined).length;

  const answer = async (decision: 'confirm' | 'decline') => {
    setBusy(decision);
    try {
      await respondToShopOrder(order.id, decision);
      showToast(decision === 'confirm' ? `${number} confirmed. The shop will pack it next.` : `${number} declined. The shop has been told.`);
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'Unknown error';
      showToast(`Couldn’t send your answer: ${reason}`);
    } finally {
      setBusy(null);
    }
  };

  const decline = () => confirmDestructive('Decline This Order?', `${number} will be marked declined, and the shop won’t send it.`, 'Decline', () => answer('decline'));

  const share = async () => {
    setBusy('share');
    try {
      const html = buildOrderHtml({ id: order.id, number, status: order.status, ...details });
      await sharePdf(html, pdfFileName(`${number} ${details.customer}`), `Share order ${number}`);
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : 'Unknown error';
      showToast(`Couldn’t create the PDF: ${reason}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title={number} subtitle={`From the shop · ${formatOrderDate(details.createdAt)}`} back={{ fallback: '/orders', label: 'Orders' }} grouped>
      {waiting && (
        <View style={styles.notice} accessibilityRole="summary">
          <Ionicons name="paper-plane-outline" size={20} color={colors.orange} />
          <Text style={styles.noticeText}>The shop made this order for you. Check the items, then confirm it so the shop can pack and send it, or decline it.</Text>
        </View>
      )}

      <InsetGroup header="Details">
        <ValueRow label="Status" value={waiting ? 'Waiting for you' : order.status} />
        <ValueRow label="Customer / site" value={details.customer} />
        {details.phone ? <ValueRow label="Phone" value={details.phone} /> : null}
        {details.notes ? <ValueRow label="Delivery notes" value={details.notes} /> : null}
      </InsetGroup>

      {order.history?.length ? (
        <InsetGroup header="Progress at the shop">
          {order.history.map((step, index) => (
            <ValueRow key={`${step.status}-${index}`} label={step.status === 'Requested' ? 'Sent to you' : step.status} value={formatOrderDate(step.at)} />
          ))}
        </InsetGroup>
      ) : null}

      <InsetGroup header="Items">
        {details.lines.map((line, index) => (
          <View key={`${line.productId}-${index}`} style={styles.line}>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineCode}>{line.optionCode ?? line.code}</Text>
              <Text style={type.subheadline}>{line.name}</Text>
              {line.option ? <Text style={styles.lineDetail}>{line.option}</Text> : null}
              {line.note ? <Text style={styles.lineDetail}>{line.note}</Text> : null}
              <Text style={styles.lineDetail}>
                {line.qty} × {line.mrp === undefined ? 'price from catalogue' : formatINR(line.mrp)}
              </Text>
            </View>
            <Text style={styles.lineTotal}>{line.mrp === undefined ? '—' : formatINR(line.mrp * line.qty)}</Text>
          </View>
        ))}
      </InsetGroup>

      <InsetGroup footer={unpriced > 0 ? `${unpriced} product${unpriced === 1 ? ' is' : 's are'} priced from the catalogue and not included in the total.` : undefined}>
        <ValueRow label="Total (MRP)" value={formatINR(details.total)} emphasized />
      </InsetGroup>

      <View style={styles.actions}>
        {waiting ? (
          <>
            <Button label="Confirm Order" icon="checkmark-circle-outline" loading={busy === 'confirm'} loadingLabel="Confirming…" disabled={busy !== null} onPress={() => answer('confirm')} />
            <Button label="Decline" icon="close-circle-outline" variant="gray" destructive loading={busy === 'decline'} loadingLabel="Declining…" disabled={busy !== null} onPress={decline} />
          </>
        ) : null}
        <Button label="Share PDF" icon="share-outline" variant={waiting ? 'plain' : 'filled'} loading={busy === 'share'} loadingLabel="Creating PDF…" disabled={busy !== null} onPress={share} />
        {!waiting && <Button label="Back to Orders" variant="gray" onPress={() => router.navigate('/orders')} />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, marginBottom: 20, borderRadius: 12, backgroundColor: colors.orangeFill },
  noticeText: { ...type.subheadline, flex: 1, color: colors.label },
  line: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  lineCode: { ...type.caption1, color: colors.secondaryLabel, fontWeight: '500' },
  lineDetail: { ...type.footnote, marginTop: 2, color: colors.secondaryLabel },
  lineTotal: { ...type.subheadline, fontWeight: '600', ...tabularNums },
  actions: { gap: 12 },
});
