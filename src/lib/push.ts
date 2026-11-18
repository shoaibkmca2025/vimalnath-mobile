import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { getAdminSyncStatus, request, subscribeAdminSync } from '@/lib/admin-sync';

/**
 * Modules 3.5 and 10.1. Once the phone is linked to the shop it asks, once, to show order updates, tells the shop
 * where to send them, and opens the order when one is tapped. Push needs a build made with the shop's EAS project
 * (Expo Go can't receive it on Android); without that, and on the web, this quietly does nothing.
 */

type Tap = { orderId?: string; shopOrderId?: string };

async function register() {
  const { connection, connected } = getAdminSyncStatus();
  const projectId = Constants.easConfig?.projectId ?? (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  if (!connection.enabled || !connected || !projectId) return;
  // Android shows nothing for a channel the app hasn't made; the server sends to 'orders'.
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('orders', { name: 'Order updates', importance: Notifications.AndroidImportance.HIGH });
  // The system asks only the first time; after that this just reads the answer.
  if (!(await Notifications.requestPermissionsAsync()).granted) return;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await request(connection, 'push-token', { token });
}

function open(response: Notifications.NotificationResponse | null) {
  const tap = response?.notification.request.content.data as Tap | undefined;
  if (tap?.orderId) router.push(`/order/${encodeURIComponent(tap.orderId)}`);
  else if (tap?.shopOrderId) router.push(`/shop-order/${encodeURIComponent(tap.shopOrderId)}`);
}

/** Call once navigation is mounted. Returns a function that stops listening. */
export function startPush() {
  if (Platform.OS === 'web') return () => {};
  // Updates show as a banner even while the app is open.
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
  // A failed registration (no signal, permission refused) is tried again on the next link or token change.
  const tryRegister = () => void register().catch(() => {});
  let linked = getAdminSyncStatus().connected;
  if (linked) tryRegister();
  const unsubscribe = subscribeAdminSync((status) => {
    if (status.connected && !linked) tryRegister();
    linked = status.connected;
  });
  const tapped = Notifications.addNotificationResponseReceivedListener(open);
  const refreshed = Notifications.addPushTokenListener(tryRegister);
  // A tap that started the app from closed.
  void Notifications.getLastNotificationResponseAsync().then(open);
  return () => {
    unsubscribe();
    tapped.remove();
    refreshed.remove();
  };
}
