import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, type IconName } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { InsetGroup } from '@/components/InsetGroup';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { deleteNotifications, fetchNotifications, markNotificationsRead, useUnreadNotifications, type AppNotification, type NotificationCategory, type NotificationQuery } from '@/lib/admin-sync';
import { confirmDestructive } from '@/lib/confirm';
import { formatOrderDate } from '@/lib/format';
import { dismissDelivered, phoneAlertAccess, turnOnNotifications, type NotificationAccess } from '@/lib/push';
import { useAppUI } from '@/providers/AppUIProvider';
import { colors, type } from '@/theme';

/** Each kind of message gets its own symbol and colour, as Settings and Mail do. */
const CATEGORY: Record<NotificationCategory, { label: string; icon: IconName; color: string }> = {
  orders: { label: 'Orders', icon: 'cube', color: colors.tint },
  payments: { label: 'Payments', icon: 'wallet', color: colors.green },
  billing: { label: 'Invoices', icon: 'document-text', color: '#5856d6' },
  returns: { label: 'Returns', icon: 'return-down-back', color: colors.orange },
  announcements: { label: 'Shop News', icon: 'megaphone', color: colors.orange },
  system: { label: 'Important', icon: 'alert-circle', color: colors.red },
  inventory: { label: 'Stock', icon: 'archive', color: colors.secondaryLabel },
  customers: { label: 'Account', icon: 'person', color: colors.secondaryLabel },
};
/** Order steps keep the symbols customers know from before. */
const EVENT_ICON: Record<string, { icon: IconName; color: string }> = {
  confirmed: { icon: 'checkmark-circle', color: colors.green },
  dispatched: { icon: 'car', color: colors.tint },
  delivered: { icon: 'cube', color: colors.green },
  cancelled: { icon: 'close-circle', color: colors.red },
};
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'read', label: 'Read' },
] as const;
type Filter = (typeof FILTERS)[number]['value'];
const CHIPS: (NotificationCategory | 'all')[] = ['all', 'orders', 'payments', 'billing', 'returns', 'announcements'];

/** "Today, 10:42", "Yesterday, 18:05", then the date. */
function when(iso: string) {
  const date = new Date(iso);
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(date)) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return days === 0 ? `Today, ${time}` : days === 1 ? `Yesterday, ${time}` : formatOrderDate(iso);
}

/** Where a notification opens: its order, or nothing more (news, invoices and returns are read here). */
const target = (item: AppNotification) => (item.data.orderId ? { pathname: '/order/[id]' as const, params: { id: item.data.orderId } } : item.data.shopOrderId ? { pathname: '/shop-order/[id]' as const, params: { id: item.data.shopOrderId } } : null);

/**
 * The Notification Center: this account's updates and the shop's messages, newest first, a page at a time. Unread ones
 * carry a red dot until opened; the count is the server's, so the bell, the app icon and the account's other phones agree.
 */
export default function NotificationsScreen() {
  const { showToast } = useAppUI();
  const unread = useUnreadNotifications();
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AppNotification[]>();
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [more, setMore] = useState(false);
  const [access, setAccess] = useState<NotificationAccess>('on');
  const asked = useRef(0);

  // The search waits for a pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const ask = ++asked.current;
    setError(undefined);
    void phoneAlertAccess().then(setAccess).catch(() => {});
    try {
      const page = await fetchNotifications({ filter, category: category === 'all' ? undefined : category, q: query || undefined } satisfies NotificationQuery);
      if (ask !== asked.current) return;
      setItems(page.notifications);
      setNext(page.next);
    } catch (failure) {
      if (ask === asked.current) setError(failure instanceof Error ? failure.message : 'Couldn’t load notifications.');
    }
  }, [filter, category, query]);
  // Every visit and every change of filter, so something that arrived while the app was open shows straight away.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loadMore = async () => {
    if (!next) return;
    setMore(true);
    try {
      const page = await fetchNotifications({ filter, category: category === 'all' ? undefined : category, q: query || undefined, before: next });
      setItems((current) => [...(current ?? []), ...page.notifications]);
      setNext(page.next);
    } catch (failure) {
      showToast(failure instanceof Error ? failure.message : 'Couldn’t load more.');
    } finally {
      setMore(false);
    }
  };

  const open = (item: AppNotification) => {
    if (!item.read) {
      setItems((current) => current?.map((one) => (one.id === item.id ? { ...one, read: true } : one)));
      void markNotificationsRead([item.id]).catch(() => {});
      void dismissDelivered([item.id]);
    }
    const to = target(item);
    if (to) router.push(to);
  };

  const remove = (item: AppNotification) =>
    confirmDestructive('Delete this notification?', item.title, 'Delete', () => {
      setItems((current) => current?.filter((one) => one.id !== item.id));
      void dismissDelivered([item.id]);
      deleteNotifications([item.id]).catch(() => {
        showToast('Couldn’t delete it. Try again.');
        void load();
      });
    });

  const readAll = async () => {
    try {
      await markNotificationsRead();
      void dismissDelivered();
      setItems((current) => (filter === 'unread' ? [] : current?.map((one) => ({ ...one, read: true }))));
      showToast('All notifications marked as read.');
    } catch (failure) {
      showToast(failure instanceof Error ? failure.message : 'Couldn’t mark them read.');
    }
  };

  const filtered = filter !== 'all' || category !== 'all' || Boolean(query);
  return (
    <Screen
      title="Notifications"
      back={{ fallback: '/' }}
      trailing={
        unread > 0 ? (
          <Pressable onPress={() => void readAll()} accessibilityRole="button" accessibilityLabel={`Mark all ${unread} as read`} hitSlop={8} style={({ pressed }) => pressed && styles.pressedText}>
            <Text style={styles.headerAction}>Mark All Read</Text>
          </Pressable>
        ) : null
      }
      grouped
    >
      <PhoneAlerts access={access} onChange={setAccess} />

      <View style={styles.controls}>
        <SegmentedControl options={[...FILTERS]} value={filter} onChange={setFilter} accessibilityLabel="Show" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
          {CHIPS.map((chip) => {
            const selected = chip === category;
            return (
              <Pressable
                key={chip}
                onPress={() => setCategory(chip)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{chip === 'all' ? 'All' : CATEGORY[chip].label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <TextField value={search} onChangeText={setSearch} placeholder="Search notifications" accessibilityLabel="Search notifications" returnKeyType="search" autoCorrect={false} surface="card" />
      </View>

      {error && !items ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn’t Load Notifications" message={error} action={{ label: 'Try Again', onPress: () => void load() }} />
      ) : !items ? (
        <ActivityIndicator style={styles.loading} color={colors.secondaryLabel} accessibilityLabel="Loading notifications" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={filtered ? 'search-outline' : 'notifications-outline'}
          title={filtered ? (filter === 'unread' && category === 'all' && !query ? 'All Caught Up' : 'Nothing Here') : 'No Notifications Yet'}
          message={filtered ? 'Nothing matches. Try another filter.' : 'When the shop confirms, sends or delivers an order, records a payment, or has news for you, it shows here.'}
        />
      ) : (
        <>
          <InsetGroup separatorInset={60} footer="Touch and hold a notification to delete it.">
            {items.map((item) => {
              const look = EVENT_ICON[item.event] ?? CATEGORY[item.category] ?? CATEGORY.system;
              const linked = Boolean(target(item));
              return (
                <Pressable
                  key={item.id}
                  onPress={() => open(item)}
                  onLongPress={() => remove(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.read ? '' : 'Unread. '}${item.title}. ${item.body}. ${when(item.createdAt)}`}
                  accessibilityHint={linked ? 'Opens the order' : item.read ? undefined : 'Marks it read'}
                  accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
                  onAccessibilityAction={(event) => event.nativeEvent.actionName === 'delete' && remove(item)}
                  style={({ pressed }) => [styles.row, !item.read && styles.rowUnread, pressed && styles.pressed]}
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
                    <Text style={styles.time}>
                      {CATEGORY[item.category]?.label ?? 'Notice'} · {when(item.createdAt)}
                    </Text>
                  </View>
                  {linked && <Ionicons name="chevron-forward" size={18} color={colors.tertiaryLabel} style={styles.chevron} />}
                </Pressable>
              );
            })}
          </InsetGroup>
          {next && <Button label="Load More" variant="plain" onPress={() => void loadMore()} loading={more} style={styles.more} />}
        </>
      )}
    </Screen>
  );
}

/** Whether this phone also rings for them, and how to change that. A link to the choices when they're on. */
function PhoneAlerts({ access, onChange }: { access: NotificationAccess; onChange: (access: NotificationAccess) => void }) {
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    try {
      onChange(await turnOnNotifications());
    } finally {
      setBusy(false);
    }
  };
  if (access === 'on')
    return (
      <InsetGroup>
        <Pressable onPress={() => router.push('/notification-settings')} accessibilityRole="button" style={({ pressed }) => [styles.settingsRow, pressed && styles.pressed]}>
          <Ionicons name="options-outline" size={20} color={colors.tint} />
          <Text style={styles.settingsLabel}>Notification Settings</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.tertiaryLabel} />
        </Pressable>
      </InsetGroup>
    );
  return (
    <InsetGroup>
      <View style={styles.alerts}>
        <Ionicons name={access === 'ask' ? 'notifications-outline' : 'notifications-off-outline'} size={22} color={access === 'ask' ? colors.tint : colors.red} />
        <View style={styles.copy}>
          <Text style={styles.alertsTitle}>{access === 'ask' ? 'Get Alerts on Your Phone' : access === 'off' ? 'Phone Alerts Are Off' : 'Alerts Need the Home Screen App'}</Text>
          <Text style={styles.body}>
            {access === 'ask'
              ? 'A notification for each update, even when the app is closed.'
              : access === 'off'
                ? 'You’ll still see updates here. To get alerts, allow notifications for Vimalnath in your phone’s Settings.'
                : 'On iPhone, add this app to your Home Screen (tap Share, then Add to Home Screen) and open it from there.'}
          </Text>
          {access === 'ask' && <Button label="Turn On Notifications" size="medium" onPress={() => void turnOn()} loading={busy} style={styles.alertsButton} />}
          {access === 'off' && Platform.OS !== 'web' && <Button label="Open Phone Settings" size="medium" variant="secondary" onPress={() => void Linking.openSettings()} style={styles.alertsButton} />}
        </View>
      </View>
    </InsetGroup>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 48 },
  controls: { gap: 12, marginBottom: 16, paddingHorizontal: 16 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.card },
  chipSelected: { backgroundColor: colors.tint },
  chipText: { ...type.subheadline, fontWeight: '500', color: colors.label },
  chipTextSelected: { color: colors.white },
  headerAction: { ...type.body, color: colors.tint },
  pressedText: { opacity: 0.5 },
  alerts: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16 },
  alertsTitle: { ...type.headline },
  alertsButton: { alignSelf: 'flex-start', marginTop: 12 },
  settingsRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  settingsLabel: { ...type.body, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 12 },
  rowUnread: { backgroundColor: 'rgba(215, 0, 21, 0.04)' },
  pressed: { backgroundColor: colors.fill },
  icon: { width: 32, height: 32, marginTop: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  copy: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...type.body, flexShrink: 1, fontWeight: '500' },
  titleNew: { fontWeight: '700' },
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.red },
  body: { ...type.subheadline, color: colors.secondaryLabel },
  time: { ...type.footnote, marginTop: 2, color: colors.tertiaryLabel },
  chevron: { alignSelf: 'center' },
  more: { alignSelf: 'center', marginBottom: 24 },
});
