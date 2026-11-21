import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, type IconName } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { fetchNotifications, markNotificationsRead, type AppNotification } from '@/lib/admin-sync';
import { formatOrderDate } from '@/lib/format';
import { notificationAccess, turnOnNotifications, type NotificationAccess } from '@/lib/push';
import { colors, type } from '@/theme';

/** Each kind of message gets its own symbol and colour, as Settings and Mail do. */
const LOOK: Record<string, { icon: IconName; color: string }> = {
  confirmed: { icon: 'checkmark-circle', color: colors.green },
  dispatched: { icon: 'car', color: colors.tint },
  delivered: { icon: 'cube', color: colors.green },
  cancelled: { icon: 'close-circle', color: colors.red },
  broadcast: { icon: 'megaphone', color: colors.orange },
};
const DEFAULT_LOOK = { icon: 'notifications' as IconName, color: colors.tint };

/** "Today, 10:42", "Yesterday, 18:05", then the date. */
function when(iso: string) {
  const date = new Date(iso);
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(date)) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return days === 0 ? `Today, ${time}` : days === 1 ? `Yesterday, ${time}` : formatOrderDate(iso);
}

/** Order updates and the shop's messages for this account, newest first. Opening it clears the bell. */
export default function NotificationsScreen() {
  const [items, setItems] = useState<AppNotification[]>();
  const [error, setError] = useState<string>();
  const [access, setAccess] = useState<NotificationAccess>(notificationAccess);

  const load = useCallback(async () => {
    setError(undefined);
    // Also re-read whether phone alerts are on: the customer may have changed it in Settings.
    setAccess(notificationAccess());
    try {
      const list = await fetchNotifications();
      // Shown as they were, so what's new stays marked while the customer reads it.
      setItems(list);
      if (list.some((item) => !item.read)) await markNotificationsRead();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t load notifications.');
    }
  }, []);
  // Every visit, so something that arrived while the app was open shows straight away.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = (item: AppNotification) => {
    if (item.data.orderId) router.push({ pathname: '/order/[id]', params: { id: item.data.orderId } });
    else if (item.data.shopOrderId) router.push({ pathname: '/shop-order/[id]', params: { id: item.data.shopOrderId } });
  };

  return (
    <Screen title="Notifications" back={{ fallback: '/' }} trailing={null} grouped>
      <PhoneAlerts access={access} onChange={setAccess} />
      {error && !items ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn’t Load Notifications" message={error} action={{ label: 'Try Again', onPress: () => void load() }} />
      ) : !items ? (
        <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} accessibilityLabel="Loading notifications" />
      ) : items.length === 0 ? (
        <EmptyState icon="notifications-outline" title="No Notifications Yet" message="When the shop confirms, sends or delivers an order, or has news for you, it shows here." />
      ) : (
        <InsetGroup separatorInset={60}>
          {items.map((item) => {
            const look = LOOK[item.event] ?? DEFAULT_LOOK;
            const linked = Boolean(item.data.orderId || item.data.shopOrderId);
            return (
              <Pressable
                key={item.id}
                onPress={linked ? () => open(item) : undefined}
                disabled={!linked}
                accessibilityRole={linked ? 'button' : 'text'}
                accessibilityLabel={`${item.read ? '' : 'New. '}${item.title}. ${item.body}. ${when(item.createdAt)}`}
                accessibilityHint={linked ? 'Opens the order' : undefined}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={[styles.icon, { backgroundColor: look.color }]}>
                  <Ionicons name={look.icon} size={18} color={colors.white} />
                </View>
                <View style={styles.copy}>
                  <View style={styles.titleLine}>
                    <Text style={[styles.title, !item.read && styles.titleNew]}>{item.title}</Text>
                    {!item.read && <View style={styles.dot} />}
                  </View>
                  <Text style={styles.body}>{item.body}</Text>
                  <Text style={styles.time}>{when(item.createdAt)}</Text>
                </View>
                {linked && <Ionicons name="chevron-forward" size={18} color={colors.tertiaryLabel} style={styles.chevron} />}
              </Pressable>
            );
          })}
        </InsetGroup>
      )}
    </Screen>
  );
}

/** Whether this phone also rings for them, and how to change that. Nothing when they're on. */
function PhoneAlerts({ access, onChange }: { access: NotificationAccess; onChange: (access: NotificationAccess) => void }) {
  const [busy, setBusy] = useState(false);
  if (access === 'on') return null;
  const turnOn = async () => {
    setBusy(true);
    try {
      onChange(await turnOnNotifications());
    } finally {
      setBusy(false);
    }
  };
  return (
    <InsetGroup>
      <View style={styles.alerts}>
        <Ionicons name={access === 'ask' ? 'notifications-outline' : 'notifications-off-outline'} size={22} color={access === 'ask' ? colors.tint : colors.secondaryLabel} />
        <View style={styles.copy}>
          <Text style={styles.alertsTitle}>{access === 'ask' ? 'Get Alerts on Your Phone' : access === 'off' ? 'Phone Alerts Are Off' : 'Alerts Need the Home Screen App'}</Text>
          <Text style={styles.body}>
            {access === 'ask'
              ? 'A notification with sound for each update, even when the app is closed.'
              : access === 'off'
                ? 'You’ll still see updates here. To get alerts, allow notifications for Vimalnath in your phone’s Settings.'
                : 'On iPhone, add this app to your Home Screen (tap Share, then Add to Home Screen) and open it from there.'}
          </Text>
          {access === 'ask' && <Button label="Turn On Notifications" size="medium" onPress={() => void turnOn()} loading={busy} style={styles.alertsButton} />}
        </View>
      </View>
    </InsetGroup>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 48 },
  alerts: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16 },
  alertsTitle: { ...type.headline },
  alertsButton: { alignSelf: 'flex-start', marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 12 },
  pressed: { backgroundColor: colors.fill },
  icon: { width: 32, height: 32, marginTop: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  copy: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...type.body, flexShrink: 1, fontWeight: '500' },
  titleNew: { fontWeight: '700' },
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.tint },
  body: { ...type.subheadline, color: colors.secondaryLabel },
  time: { ...type.footnote, marginTop: 2, color: colors.tertiaryLabel },
  chevron: { alignSelf: 'center' },
});
