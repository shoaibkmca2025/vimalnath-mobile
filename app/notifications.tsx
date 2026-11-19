import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { IconName } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { fetchNotifications, markNotificationsRead, type AppNotification } from '@/lib/admin-sync';
import { formatOrderDate } from '@/lib/format';
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

  const load = useCallback(async () => {
    setError(undefined);
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
      {error && !items ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn’t Load Notifications" message={error} action={{ label: 'Try Again', onPress: () => void load() }} />
      ) : !items ? (
        <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} accessibilityLabel="Loading notifications" />
      ) : items.length === 0 ? (
        <EmptyState icon="notifications-outline" title="No Notifications Yet" message="When the shop confirms, sends or delivers an order, or has news for you, it shows here." />
      ) : (
        <InsetGroup
          separatorInset={60}
          footer={Platform.OS === 'web' ? 'Updates from the shop collect here. The installed app also alerts you on your phone.' : undefined}
        >
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

const styles = StyleSheet.create({
  loading: { marginTop: 48 },
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
