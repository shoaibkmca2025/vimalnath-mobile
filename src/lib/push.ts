import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { Platform } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchNotificationPreferences, getAdminSyncStatus, markNotificationsRead, refreshUnread, request, subscribeAdminSync, type NotificationPreferences } from '@/lib/admin-sync';

/**
 * Phone notifications and the unread count on the app icon. The Android app registers its Firebase (FCM) token with
 * the shop once it's linked (Expo's token if the build has no Firebase config but an EAS project); the shop's server
 * sends each push. The web app on a home screen uses Web Push through public/sw.js, once the customer turns it on.
 * The count always comes from the shop's server, so every phone on the account shows the same number.
 */

type Tap = { orderId?: string; shopOrderId?: string; notificationId?: string };

// ---------- Android channels ----------

type ChannelCategory = 'orders' | 'payments' | 'billing' | 'returns' | 'announcements' | 'system';
/** One channel per kind of message, so people can tune each in Android's own settings too. Private ones hide on a locked phone. */
const CHANNELS: { category: ChannelCategory; name: string; description: string; private?: boolean }[] = [
  { category: 'orders', name: 'Orders', description: 'Your orders: received, confirmed, dispatched, delivered or cancelled.' },
  { category: 'payments', name: 'Payments', description: 'Payments received, and bills due or overdue.', private: true },
  { category: 'billing', name: 'Invoices', description: 'Tax invoices and credit notes.', private: true },
  { category: 'returns', name: 'Returns & Replacements', description: 'Your returns and replacements.', private: true },
  { category: 'announcements', name: 'Shop News', description: 'Offers, new price lists and messages from Vimalnath.' },
  { category: 'system', name: 'Important', description: 'Account and app alerts.' },
];
const PREFERENCES_KEY = 'vimalnath:notification-preferences';
const DEFAULT_SOUND = { sound_enabled: true, vibration_enabled: true };

/** "alert" (sound and vibration), "sound", "vibrate" or "silent": a channel's sound can't change, so each choice has its own. */
const variantOf = (choice: Pick<NotificationPreferences, 'sound_enabled' | 'vibration_enabled'>) =>
  choice.sound_enabled ? (choice.vibration_enabled ? 'alert' : 'sound') : choice.vibration_enabled ? 'vibrate' : 'silent';

/**
 * Makes this phone's channels for the person's sound and vibration choice (the server sends each push to the matching
 * one) and removes the others. Called at start and whenever the choice changes in Settings → Notifications.
 */
export async function applyChannels(choice: Pick<NotificationPreferences, 'sound_enabled' | 'vibration_enabled'> = DEFAULT_SOUND) {
  if (Platform.OS !== 'android') return;
  void AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(choice)).catch(() => {});
  const variant = variantOf(choice);
  for (const channel of CHANNELS) {
    await Notifications.setNotificationChannelAsync(`${channel.category}-${variant}`, {
      name: channel.name,
      description: channel.description,
      importance: Notifications.AndroidImportance.HIGH,
      sound: choice.sound_enabled ? 'default' : null,
      enableVibrate: choice.vibration_enabled,
      vibrationPattern: choice.vibration_enabled ? [0, 250, 200, 250] : null,
      lockscreenVisibility: channel.private ? Notifications.AndroidNotificationVisibility.PRIVATE : Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: true,
    });
  }
  for (const channel of await Notifications.getNotificationChannelsAsync()) {
    // The other choices' channels, and the single "orders" channel apps before these made.
    const stale = channel.id === 'orders' || (/-(alert|sound|vibrate|silent)$/.test(channel.id) && !channel.id.endsWith(`-${variant}`));
    if (stale) await Notifications.deleteNotificationChannelAsync(channel.id);
  }
}

/** The last choice this phone knew, for making channels before the server answers. */
async function savedChoice() {
  try {
    const saved = await AsyncStorage.getItem(PREFERENCES_KEY);
    return saved ? (JSON.parse(saved) as typeof DEFAULT_SOUND) : DEFAULT_SOUND;
  } catch {
    return DEFAULT_SOUND;
  }
}

// ---------- The phone's address for pushes ----------

/** The Firebase token (needs the build's google-services.json), else Expo's (needs an EAS project), else none. */
async function pushToken(): Promise<string | null> {
  try {
    const device = await Notifications.getDevicePushTokenAsync();
    if (typeof device.data === 'string' && device.data) return device.data;
  } catch {
    // No Firebase config in this build: try Expo's service.
  }
  const projectId = Constants.easConfig?.projectId ?? (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  if (!projectId) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

async function register() {
  const { connection, connected } = getAdminSyncStatus();
  if (!connection.enabled || !connected) return;
  // Channels first: on Android 13 and later the permission question only appears once a channel exists.
  await applyChannels(await savedChoice());
  void fetchNotificationPreferences()
    .then((choice) => applyChannels(choice))
    .catch(() => {});
  // The system asks only the first time; after that this just reads the answer.
  if (!(await Notifications.requestPermissionsAsync()).granted) return;
  const token = await pushToken();
  if (token) await request(connection, 'push-token', { token, deviceType: Platform.OS === 'ios' ? 'ios' : 'android' });
}

/** What the phone allows: 'on', 'ask' (not asked yet, or can ask again) or 'off' (only the phone's Settings can change it). */
export async function phoneAlertAccess(): Promise<NotificationAccess> {
  if (Platform.OS === 'web') return notificationAccess();
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted ? 'on' : permission.canAskAgain ? 'ask' : 'off';
}

/** Takes the notifications off the phone's shade once they're read here (all of them when nothing is unread). */
export async function dismissDelivered(ids?: string[]) {
  if (Platform.OS === 'web') return;
  try {
    if (!ids) return await Notifications.dismissAllNotificationsAsync();
    const wanted = new Set(ids);
    for (const shown of await Notifications.getPresentedNotificationsAsync()) {
      const id = (shown.request.content.data as Tap | undefined)?.notificationId;
      if (id && wanted.has(id)) await Notifications.dismissNotificationAsync(shown.request.identifier);
    }
  } catch {
    // Nothing to tidy.
  }
}

/** A tap on a notification: it's read, and the screen it's about opens (the Notification Center for news). */
function open(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const tap = response.notification.request.content.data as Tap | undefined;
  if (tap?.notificationId) void markNotificationsRead([tap.notificationId]).catch(() => {});
  if (tap?.orderId) router.push(`/order/${encodeURIComponent(tap.orderId)}`);
  else if (tap?.shopOrderId) router.push(`/shop-order/${encodeURIComponent(tap.shopOrderId)}`);
  else router.push('/notifications');
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
  if (Platform.OS !== 'web') {
    await register().catch(() => {});
    return phoneAlertAccess();
  }
  if (!webPushAvailable()) return 'unavailable';
  if ((await Notification.requestPermission()) === 'granted') await subscribeWeb();
  return notificationAccess();
}

type Badging = { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
/**
 * The number on the app icon: the bell's count. Launchers that show numbers take it from here and from each push's
 * count; those that show only a dot show it while notifications are on the shade, so nothing unread clears them.
 */
function setIconBadge(count: number) {
  if (Platform.OS !== 'web') {
    void Notifications.setBadgeCountAsync(count).catch(() => {});
    if (count === 0) void dismissDelivered();
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
  // Updates show as a banner even while the app is open (once: the system doesn't show a push itself while the app is
  // open), and the count is fetched again so the bell and icon catch up at once.
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) });
  const received = Notifications.addNotificationReceivedListener(() => void refreshUnread().catch(() => {}));
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
    received.remove();
    tapped.remove();
    refreshed.remove();
  };
}
