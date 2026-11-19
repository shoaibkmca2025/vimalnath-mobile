import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { useLogOut } from '@/hooks/useLogOut';
import { getAdminSyncStatus, setAdminActivitySharing, subscribeAdminSync, syncAdmin } from '@/lib/admin-sync';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

/** Who is logged in on this phone, how sync with the shop is going, and logging out. */
export function AccountSettings() {
  const { showToast } = useAppUI();
  const { confirmLogOut, loggingOut } = useLogOut();
  const [status, setStatus] = useState(getAdminSyncStatus);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeAdminSync(setStatus), []);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      showToast(getAdminSyncStatus().error ?? success);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const syncLabel = status.syncing ? 'Syncing…' : status.error ? 'Not synced' : status.connected ? 'Up to date' : 'Waiting';

  return (
    <>
      <InsetGroup header="Account" footer="Forgot your password? Call the shop and they’ll set a new one.">
        {status.connection.mobile && <ValueRow label="Mobile number" value={status.connection.mobile} />}
        <ValueRow label="Shop sync" value={syncLabel} />
        {status.pending > 0 && <ValueRow label="Waiting to send" value={String(status.pending)} />}
        {status.lastSyncedAt && <ValueRow label="Last synced" value={new Date(status.lastSyncedAt).toLocaleString()} />}
        {status.error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {status.error}
          </Text>
        )}
        <View style={styles.actions}>
          <Button label="Sync Now" icon="sync-outline" size="medium" variant="tinted" disabled={busy || status.syncing} onPress={() => void run(syncAdmin, 'Your orders are synced with the shop.')} style={styles.flex} />
          <Button label="Log Out" size="medium" variant="gray" destructive disabled={busy || loggingOut} onPress={confirmLogOut} style={styles.flex} />
        </View>
      </InsetGroup>

      <InsetGroup header="Activity sharing" footer="Off by default. When on, Vimalnath can see which product prices and catalogue pages you view and follow up on your interest. Turning it off removes unsent browsing updates.">
        <View style={styles.toggle}>
          <View style={styles.flex}>
            <Text style={type.body}>Share product interest</Text>
            <Text style={styles.hint}>Pricing and catalogue views</Text>
          </View>
          <Switch
            accessibilityLabel="Share product pricing and catalogue activity with Vimalnath"
            value={status.connection.activitySharing}
            disabled={busy}
            onValueChange={(value) => void run(() => setAdminActivitySharing(value), value ? 'Product activity sharing is on.' : 'Product activity sharing is off.')}
          />
        </View>
      </InsetGroup>

      {status.centralOrders.length > 0 && (
        <InsetGroup header="Latest shop order updates" footer="Your original order details and exported PDFs stay in Order History.">
          {status.centralOrders.slice(0, 5).map((order) => (
            <ValueRow key={order.id} label={order.number ?? order.mobileOrderId ?? order.id} value={order.status} />
          ))}
        </InsetGroup>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  hint: { ...type.footnote, color: colors.secondaryLabel, marginTop: 3 },
  error: { ...type.footnote, color: colors.red, paddingHorizontal: 16, paddingVertical: 12 },
});
