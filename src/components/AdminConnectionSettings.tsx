import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { InsetGroup, ValueRow } from '@/components/InsetGroup';
import { TextField } from '@/components/TextField';
import { connectAdmin, disconnectAdmin, getAdminSyncStatus, initializeAdminSync, setAdminActivitySharing, subscribeAdminSync, syncAdmin } from '@/lib/admin-sync';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

/** Connection stays optional: all existing tools, local orders and exports work without a server. */
export function AdminConnectionSettings() {
  const { showToast } = useAppUI();
  const [status, setStatus] = useState(getAdminSyncStatus);
  const [baseUrl, setBaseUrl] = useState('');
  const [deviceToken, setDeviceToken] = useState('');
  const [activitySharing, setActivitySharing] = useState(false);
  const [allowLocalHttp, setAllowLocalHttp] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const unsubscribe = subscribeAdminSync((next) => { if (alive) setStatus(next); });
    void initializeAdminSync().then(() => {
      if (!alive) return;
      const next = getAdminSyncStatus();
      setStatus(next);
      setBaseUrl(next.connection.baseUrl);
      setDeviceToken(next.connection.deviceToken);
      setActivitySharing(next.connection.activitySharing);
      setAllowLocalHttp(next.connection.allowLocalHttp);
    });
    return () => { alive = false; unsubscribe(); };
  }, []);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      setActivitySharing(getAdminSyncStatus().connection.activitySharing);
      showToast(getAdminSyncStatus().error ?? success);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update the shop connection.');
    } finally { setBusy(false); }
  };

  const connectionLabel = !status.connection.enabled ? 'Off' : status.syncing ? 'Syncing…' : status.connected ? 'Connected' : 'Waiting to sync';

  return (
    <>
      <InsetGroup header="Shop connection" footer="Connecting shares your saved orders and profile with Vimalnath. Use the server address and customer device token issued by the shop owner. Browsing activity is shared only when you turn it on below.">
        <View style={styles.fields}>
          <TextField label="Shop server address" value={baseUrl} onChangeText={setBaseUrl} placeholder="https://shop.example.com" autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy} />
          <TextField label="Customer device token" value={deviceToken} onChangeText={setDeviceToken} placeholder="Token from the shop owner" autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!busy} />
          <Button label={status.connection.enabled ? 'Save and reconnect' : 'Connect to shop'} onPress={() => { void run(() => connectAdmin({ baseUrl, deviceToken, activitySharing, allowLocalHttp }), 'Shop connection saved.'); }} loading={busy} disabled={!baseUrl.trim() || !deviceToken.trim()} />
        </View>
        <ValueRow label="Connection" value={connectionLabel} />
        <ValueRow label="Pending updates" value={String(status.pending)} />
        {status.lastSyncedAt && <ValueRow label="Last synced" value={new Date(status.lastSyncedAt).toLocaleString()} />}
        {status.error && <Text style={styles.error} accessibilityLiveRegion="polite">{status.error}</Text>}
        <View style={styles.actions}>
          <Button label="Sync now" icon="sync-outline" size="medium" variant="tinted" disabled={!status.connection.enabled || busy || status.syncing} onPress={() => { void run(syncAdmin, 'Your shop updates are synced.'); }} style={styles.flex} />
          <Button label="Disconnect" size="medium" variant="gray" disabled={!status.connection.enabled || busy} onPress={() => { void run(disconnectAdmin, 'Shop connection is off. Pending updates are kept on this phone.'); }} style={styles.flex} />
        </View>
      </InsetGroup>

      <InsetGroup header="Activity sharing" footer="Off by default. When enabled, Vimalnath can see which product prices and catalogue pages you view and follow up on your interest. Turning it off removes unsent browsing updates. Orders and profile updates use the shop connection separately.">
        <View style={styles.toggle}>
          <View style={styles.flex}>
            <Text style={type.body}>Share product interest</Text>
            <Text style={styles.hint}>Pricing and catalogue views</Text>
          </View>
          <Switch accessibilityLabel="Share product pricing and catalogue activity with Vimalnath" value={activitySharing} disabled={busy} onValueChange={(value) => {
            setActivitySharing(value);
            if (status.connection.enabled) void run(() => setAdminActivitySharing(value), value ? 'Product activity sharing is on.' : 'Product activity sharing is off.');
          }} />
        </View>
      </InsetGroup>

      {status.centralOrders.length > 0 && (
        <InsetGroup header="Latest shop order updates" footer="Shop progress is shown here. Your original order details and exported PDFs stay available in Order History.">
          {status.centralOrders.slice(0, 5).map((order) => <ValueRow key={order.id} label={order.number ?? order.mobileOrderId ?? order.id} value={order.status} />)}
        </InsetGroup>
      )}

      <InsetGroup header="Local development" footer="Use HTTPS for the shop connection. Enable this only when testing with a private LAN address or localhost. Your phone must be able to reach the computer running the server.">
        <View style={styles.toggle}>
          <Text style={[type.body, styles.flex]}>Allow local HTTP server</Text>
          <Switch accessibilityLabel="Allow private LAN HTTP for local development" value={allowLocalHttp} disabled={busy} onValueChange={setAllowLocalHttp} />
        </View>
      </InsetGroup>
    </>
  );
}

const styles = StyleSheet.create({
  fields: { padding: 16, gap: 14 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  hint: { ...type.footnote, color: colors.secondaryLabel, marginTop: 3 },
  error: { ...type.footnote, color: colors.red, paddingHorizontal: 16, paddingVertical: 12 },
});
