import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { Platform } from 'react-native';

import { getAdminSyncStatus, request, subscribeAdminSync } from '@/lib/admin-sync';

/**
 * Modules 3.5 and 10.1: phone notifications for order updates and the shop's messages, and the unread count on the
 * app icon. The native app asks once it is linked to the shop and registers with Expo (that needs a build made with the
 * shop's EAS project). The web app on a home screen uses Web Push through public/sw.js, once the customer turns it on.
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

// --- The web app: Web Push.

/** On iPhone only once the app is on the Home Screen (iOS 16.4 or later); in Android's Chrome too. */
const webPushAvailable = () => Platform.OS === 'web' && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** 'on', 'off' (refused, so only the phone's Settings can change it), 'ask' (not asked yet), or 'unavailable' here. */
export type NotificationAccess = 'on' | 'off' | 'ask' | 'unavailable';
export function notificationAccess(): NotificationAccess {
  if (Platform.OS !== 'web') return 'on';
  if (!webPushAvailable()) return 'unavailable';
  return Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'off' : 'ask';
}

const bytes = (base64url: string) => Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Gives the shop this browser's push address, made with the shop's key (a fresh one if the shop's key changed). */
async function subscribeWeb() {
  const { connection, connected } = getAdminSyncStatus();
  if (!connection.enabled || !connected || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await request<{ publicKey: string }>(connection, 'push-key');
  const key = bytes(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  const current = subscription?.options.applicationServerKey;
  if (subscription && (!current || new Uint8Array(current).join() !== key.join())) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const { endpoint, keys } = subscription.toJSON();
  await request(connection, 'push-token', { token: { endpoint, keys } });
}

/**
 * The phone's own "Allow notifications?" question, then this phone is registered. Call it from a tap: an iPhone asks
 * only then. Returns what the customer chose.
 */
export async function turnOnNotifications(): Promise<NotificationAccess> {
  if (!webPushAvailable()) return 'unavailable';
  if ((await Notification.requestPermission()) === 'granted') await subscribeWeb();
  return notificationAccess();
}

type Badging = { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
/** The number on the app icon: the bell's count. Android's web apps show a dot instead, if anything. */
function setIconBadge(count: number) {
  if (Platform.OS !== 'web') {
    void Notifications.setBadgeCountAsync(count).catch(() => {});
    return;
  }
  const badging = navigator as Navigator & Badging;
  void (count ? badging.setAppBadge?.(count) : badging.clearAppBadge?.())?.catch(() => {});
}

function startWebPush() {
  if (!webPushAvailable()) return () => {};
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Each start and each login, so the shop always has this phone's current address (they can change).
  const tryRegister = () => void subscribeWeb().catch(() => {});
  let linked = getAdminSyncStatus().connected;
  if (linked) tryRegister();
  const unsubscribe = subscribeAdminSync((status) => {
    if (status.connected && !linked) tryRegister();
    linked = status.connected;
  });
  // A notification tapped while the app is open: the background script asks it to show that order.
  const onMessage = (event: MessageEvent<{ type?: string; url?: string }>) => {
    if (event.data?.type === 'open' && event.data.url) router.push(event.data.url as Href);
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => {
    unsubscribe();
    navigator.serviceWorker.removeEventListener('message', onMessage);
  };
}

/** Call once navigation is mounted. Returns a function that stops listening. */
export function startPush() {
  // The icon's number follows the bell, on both kinds of app.
  let shown = -1;
  const stopBadge = subscribeAdminSync((status) => {
    if (status.unread === shown) return;
    shown = status.unread;
    setIconBadge(shown);
  });
  if (Platform.OS === 'web') {
    const stopWeb = startWebPush();
    return () => {
      stopBadge();
      stopWeb();
    };
  }
  // Updates show as a banner even while the app is open.
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) });
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
    stopBadge();
    unsubscribe();
    tapped.remove();
    refreshed.remove();
  };
}
