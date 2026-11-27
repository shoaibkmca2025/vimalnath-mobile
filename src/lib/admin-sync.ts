import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import type { Order } from '@/providers/OrdersProvider';

/** The customer's login on this phone: `enabled` while logged in. Local app storage remains the order source of truth. */
export type AdminConnection = {
  enabled: boolean;
  baseUrl: string;
  deviceToken: string;
  activitySharing: boolean;
  allowLocalHttp: boolean;
  customerId?: string;
  /** The 10-digit number the customer logs in with. */
  mobile?: string;
};
/** An order the shop made and sent to this phone; the phone has no copy of its own, so the shop sends the details. */
export type ShopOrderDetails = {
  createdAt: string;
  customer: string;
  phone?: string;
  notes?: string;
  total: number;
  lines: { productId: string; code: string; name: string; option?: string; optionCode?: string; note?: string; qty: number; mrp?: number }[];
};
export type CentralOrder = {
  id: string;
  number?: string;
  status: string;
  mobileOrderId?: string;
  sourceId?: string;
  mobileEventId?: string;
  eventId?: string;
  history?: { status: string; at: string }[];
  /** 'admin' for an order the shop sent for the customer to confirm. */
  source?: 'app' | 'admin';
  details?: ShopOrderDetails | null;
};
export type SyncStatus = {
  connection: AdminConnection;
  connected: boolean;
  syncing: boolean;
  pending: number;
  lastSyncedAt?: string;
  error?: string;
  centralOrders: CentralOrder[];
  /** The bell's number: order updates and shop messages not yet seen on the Notifications screen. */
  unread: number;
};
/** One row of the Notifications screen. A tap opens the order it is about, if any. */
export type NotificationCategory = 'orders' | 'payments' | 'inventory' | 'billing' | 'returns' | 'customers' | 'announcements' | 'system';
export type AppNotification = {
  id: string;
  event: string;
  category: NotificationCategory;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  data: { orderId?: string; shopOrderId?: string };
  createdAt: string;
  read: boolean;
};
export type NotificationPage = { notifications: AppNotification[]; next: string | null; unread: number };
export type NotificationQuery = { filter?: 'all' | 'unread' | 'read'; category?: NotificationCategory; q?: string; before?: string };
/** On or off per category, and how the phone alerts: what Settings → Notifications changes. */
export type NotificationPreferences = Record<'orders_enabled' | 'payments_enabled' | 'billing_enabled' | 'returns_enabled' | 'announcements_enabled' | 'sound_enabled' | 'vibration_enabled', boolean>;
type Profile = { name: string; business: string; phone: string; email: string; city: string };
type Activity = { type: 'price_view' | 'catalogue_view'; productId?: string; productName?: string; optionIndex?: number; optionLabel?: string; price?: number };
type QueueEvent = { eventId: string; path: 'orders' | 'profile' | 'activity'; body: Record<string, unknown> };
type Outbox = { deviceId: string; customerId?: string; baseUrl?: string; events: QueueEvent[] };
type RemoteOrders = { customerId: string; orders: CentralOrder[]; unread?: number };

const CONNECTION_KEY = 'vimalnath:admin-connection:v1';
const OUTBOX_KEY = 'vimalnath:admin-outbox:v1';
const ORDERS_KEY = 'vimalnath:orders';
const PROFILE_KEY = 'vimalnath:profile';
// Built in; a development build points at a local server with EXPO_PUBLIC_SHOP_URL in .env.
const SHOP_URL = process.env.EXPO_PUBLIC_SHOP_URL || 'https://vimalnath-admin.shoaibk-mca2024.workers.dev';
const MAX_EVENTS = 400;
const MAX_QUEUE_CHARACTERS = 750_000;
const DEFAULT: AdminConnection = { enabled: false, baseUrl: '', deviceToken: '', activitySharing: false, allowLocalHttp: false };
let connection = { ...DEFAULT };
let outbox: Outbox = { deviceId: '', events: [] };
let current: SyncStatus = { connection, connected: false, syncing: false, pending: 0, centralOrders: [], unread: 0 };
let loaded: Promise<void> | undefined;
let storageError: string | undefined;
let serial: Promise<unknown> = Promise.resolve();
let syncing: Promise<void> | undefined;
const listeners = new Set<(status: SyncStatus) => void>();

function publish(patch: Partial<SyncStatus> = {}) {
  current = { ...current, ...patch, connection: { ...connection }, pending: outbox.events.length };
  listeners.forEach((listener) => listener(current));
}

/** Serialize every queue read/write so concurrent order, profile and activity events cannot overwrite each other. */
function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = serial.then(operation);
  serial = result.catch(() => {});
  return result;
}

export function getAdminSyncStatus() { return current; }

/** The shop's copy of each order this phone sent (its shop number, status and history), by the phone's own order id. */
export function useShopOrders() {
  const [orders, setOrders] = useState(() => current.centralOrders);
  useEffect(() => subscribeAdminSync((status) => setOrders(status.centralOrders)), []);
  return useMemo(() => new Map(orders.map((order) => [order.mobileOrderId, order])), [orders]);
}
/** Orders the shop sent to this phone, newest first: requests to confirm, and what happened to them after. */
export function useShopRequests() {
  const [orders, setOrders] = useState(() => current.centralOrders);
  useEffect(() => subscribeAdminSync((status) => setOrders(status.centralOrders)), []);
  return useMemo(() => orders.filter((order): order is CentralOrder & { details: ShopOrderDetails } => order.source === 'admin' && Boolean(order.details)), [orders]);
}

export function subscribeAdminSync(listener: (status: SyncStatus) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function initializeAdminSync(): Promise<void> {
  if (!loaded) loaded = (async () => {
    try {
      const [savedConnection, savedQueue] = await Promise.all([AsyncStorage.getItem(CONNECTION_KEY), AsyncStorage.getItem(OUTBOX_KEY)]);
      if (savedConnection) connection = { ...DEFAULT, ...JSON.parse(savedConnection) };
      if (savedQueue) {
        const saved = JSON.parse(savedQueue) as Outbox;
        if (!saved || !Array.isArray(saved.events) || saved.events.some((event) => !event.eventId || !['orders', 'profile', 'activity'].includes(event.path))) {
          throw new Error('The saved sync queue needs recovery. Local orders are still available.');
        }
        outbox = saved;
      }
      if (!outbox.deviceId) {
        outbox = { ...outbox, deviceId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
        await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
      }
      publish();
    } catch {
      // Do not replace corrupt/unreadable queue data with an empty queue.
      storageError = 'Could not read sync storage. Your local orders remain saved. Restart the app or contact the shop.';
      publish({ error: storageError });
    }
  })();
  return loaded;
}

export function validateAdminUrl(value: string, allowLocalHttp: boolean): string {
  let parsed: URL;
  try { parsed = new URL(value.trim()); } catch { throw new Error('Enter a full server address, for example https://shop.example.com.'); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Server address cannot include login details, a query or a fragment.');
  const host = parsed.hostname.toLowerCase();
  const octets = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host.split('.').map(Number) : [];
  const privateIpv4 = octets.length === 4 && octets.every((part) => part <= 255) && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  const privateHost = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || privateIpv4;
  if (parsed.protocol !== 'https:' && !(allowLocalHttp && parsed.protocol === 'http:' && privateHost)) {
    throw new Error('Use HTTPS. Local development HTTP must be enabled and use a private LAN address or localhost.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export async function request<T>(config: AdminConnection, path: string, body?: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.baseUrl}/v1/app/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { ...(config.deviceToken ? { Authorization: `Bearer ${config.deviceToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error('The shop server is busy. Try again in a moment.');
      let detail = '';
      try {
        const failure = await response.json() as { error?: { message?: unknown } };
        if (typeof failure.error?.message === 'string') detail = failure.error.message.slice(0, 300);
      } catch { /* A proxy may return an HTML error page instead of JSON. */ }
      // The token stopped working: logged in on another phone, or the shop set a new password. Back to the login screen.
      if (response.status === 401 && config.deviceToken && config.deviceToken === connection.deviceToken) void endSession(detail || 'You were logged out. Log in again.');
      throw new Error(detail || `Shop server returned ${response.status}. Pending items remain saved for retry.`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Shop connection timed out. Pending items remain saved for retry.');
    // fetch's own failure: no signal, or the server can't be reached.
    if (error instanceof TypeError) throw new Error('Couldn’t reach the shop. Check your internet connection and try again.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function remoteIdentity(remote: RemoteOrders): string {
  if (!remote || typeof remote.customerId !== 'string' || !Array.isArray(remote.orders)) throw new Error('The shop server response is not compatible with this app.');
  return remote.customerId;
}

async function connectAdmin(input: Omit<AdminConnection, 'enabled' | 'customerId'>): Promise<void> {
  await initializeAdminSync();
  if (storageError) throw new Error(storageError);
  const config = { ...input, enabled: true, baseUrl: validateAdminUrl(input.baseUrl, input.allowLocalHttp) };
  const remote = await request<RemoteOrders>(config, 'orders');
  const customerId = remoteIdentity(remote);
  await locked(async () => {
    const boundId = outbox.customerId ?? connection.customerId;
    const boundUrl = outbox.baseUrl ?? (connection.customerId ? connection.baseUrl : undefined);
    if (boundId && (boundId !== customerId || boundUrl !== config.baseUrl)) {
      throw new Error('This phone is already linked to another customer or server. Ask the shop owner to recover or migrate its saved orders before changing the connection.');
    }
    const next = { ...config, customerId };
    await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(next));
    connection = next;
    outbox = { ...outbox, customerId, baseUrl: config.baseUrl };
    await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    publish({ connected: true, error: undefined, centralOrders: remote.orders, unread: remote.unread ?? 0 });
  });
  await syncAdmin();
}

type Account = { token: string; customerId: string; profile?: Profile };

/** Registers or logs in, then links this phone to the account and sends anything it has waiting. */
async function signIn(path: 'register' | 'login', body: Partial<Profile> & { phone: string; password: string }): Promise<void> {
  await initializeAdminSync();
  const mobile = body.phone.replace(/\D/g, '').slice(-10);
  // Only after the shop ended the session (see endSession): the order history here belongs to that account, and sync
  // would send any of it the shop hasn't acknowledged to whoever logs in next.
  if ((outbox.customerId ?? connection.customerId) && (path === 'register' || mobile !== connection.mobile)) {
    throw new Error(`This phone holds the orders of ${connection.mobile ?? 'another account'}. Log in with that number, then log out in Settings to use another account.`);
  }
  const baseUrl = validateAdminUrl(SHOP_URL, true);
  const account = await request<Account>({ ...connection, baseUrl, deviceToken: '' }, path, body);
  const { password: _, ...details } = body;
  const profile = account.profile ?? { name: '', business: '', email: '', city: '', ...details, phone: mobile };
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  await connectAdmin({ baseUrl, deviceToken: account.token, activitySharing: connection.activitySharing, allowLocalHttp: true, mobile });
}

export const registerAccount = (details: Profile & { password: string }) => signIn('register', details);
export const logIn = (phone: string, password: string) => signIn('login', { phone, password });

/** The shop no longer accepts this phone's token. Pending orders stay, to be sent once the same account logs back in. */
async function endSession(reason: string) {
  await locked(async () => {
    if (!connection.enabled) return;
    connection = { ...connection, enabled: false, deviceToken: '' };
    await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
    // The reason goes out with the switch to the login screen, which shows it as that screen opens.
    publish({ connected: false, error: reason });
  });
}

/**
 * Sends everything waiting, signs this phone out at the shop, and forgets the account here, with its order history,
 * so the next person to log in can't send or see it. Refuses, changing nothing, while anything can't be sent.
 */
export async function logOut(): Promise<void> {
  await syncAdmin();
  if (current.error) throw new Error(current.error);
  if (outbox.events.length) throw new Error('Some updates haven’t reached the shop yet. Try again when you have signal.');
  await request({ ...connection }, 'logout', {});
  await locked(async () => {
    // Orders go before the account: if the app stops in between, no other account can pick them up.
    // Also the last delivery address (PlaceOrderSheet), so the next account on this phone doesn't see it.
    await AsyncStorage.multiRemove([ORDERS_KEY, PROFILE_KEY, 'vimalnath:delivery-address']);
    connection = { ...DEFAULT };
    outbox = { deviceId: outbox.deviceId, events: [] };
    await AsyncStorage.multiSet([[OUTBOX_KEY, JSON.stringify(outbox)], [CONNECTION_KEY, JSON.stringify(connection)]]);
    publish({ connected: false, centralOrders: [], unread: 0, lastSyncedAt: undefined, error: undefined });
  });
}

export async function setAdminActivitySharing(enabled: boolean): Promise<void> {
  await initializeAdminSync();
  await locked(async () => {
    if (storageError) throw new Error(storageError);
    const next = { ...connection, activitySharing: enabled };
    await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(next));
    connection = next;
    // Turning sharing off also cancels unsent browsing activity. Orders and profiles remain queued.
    if (!enabled) {
      const nextQueue = { ...outbox, events: outbox.events.filter((event) => event.path !== 'activity') };
      await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(nextQueue));
      outbox = nextQueue;
    }
    publish();
  });
}

async function append(event: QueueEvent): Promise<boolean> {
  await initializeAdminSync();
  return locked(async () => {
    if (storageError) throw new Error(storageError);
    if (!connection.enabled || (event.path === 'activity' && !connection.activitySharing)) return false;
    if (outbox.events.some((saved) => saved.eventId === event.eventId)) return true;
    const next = { ...outbox, customerId: connection.customerId, baseUrl: connection.baseUrl, events: [...outbox.events, event] };
    const serialized = JSON.stringify(next);
    if (next.events.length > MAX_EVENTS || serialized.length > MAX_QUEUE_CHARACTERS) {
      throw new Error(event.path === 'orders'
        ? 'Sync queue is full. This order remains in local Order History and will be recovered on the next successful sync. Do not clear Order History yet.'
        : 'Sync queue is full. Sync pending items before saving more profile or browsing updates.');
    }
    try { await AsyncStorage.setItem(OUTBOX_KEY, serialized); }
    catch { throw new Error('Could not save pending shop updates. Your order remains in local Order History. Do not clear Order History until sync succeeds.'); }
    outbox = next;
    publish();
    return true;
  });
}

function report(error: unknown) {
  publish({ error: error instanceof Error ? error.message : 'Sync is unavailable. Pending orders remain saved locally.', connected: false });
}

function orderEventId(order: Order) { return `order:${outbox.deviceId}:${order.id}:${order.createdAt}`; }

export async function enqueueAdminOrder(order: Order): Promise<void> {
  try {
    await initializeAdminSync();
    const eventId = orderEventId(order);
    if (await append({ eventId, path: 'orders', body: { eventId, order } })) void syncAdmin();
  } catch (error) { report(error); }
}

export async function enqueueAdminProfile(profile: Profile): Promise<void> {
  try {
    await initializeAdminSync();
    const eventId = `profile:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
    if (await append({ eventId, path: 'profile', body: { eventId, profile } })) void syncAdmin();
  } catch (error) { report(error); }
}

export async function trackAdminActivity(activity: Activity): Promise<void> {
  try {
    await initializeAdminSync();
    if (!connection.enabled || !connection.activitySharing) return;
    const eventId = `activity:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
    if (await append({ eventId, path: 'activity', body: { ...activity, eventId, occurredAt: new Date().toISOString() } })) void syncAdmin();
  } catch (error) { report(error); }
}

/** Retry on demand and app foreground. Stop at the first failed event to preserve FIFO order. */
export function syncAdmin(): Promise<void> {
  if (syncing) return syncing;
  syncing = (async () => {
    await initializeAdminSync();
    if (!connection.enabled) return;
    if (storageError) { report(new Error(storageError)); return; }
    const config = { ...connection };
    publish({ syncing: true, error: undefined });
    try {
      const remote = await request<RemoteOrders>(config, 'orders');
      if (remoteIdentity(remote) !== config.customerId) throw new Error('This login now belongs to a different customer. Sync stopped to protect your saved orders.');
      const acknowledged = new Set(remote.orders.map((order) => order.mobileEventId ?? order.eventId).filter(Boolean));
      const saved = await AsyncStorage.getItem(ORDERS_KEY);
      const local = saved ? JSON.parse(saved) as Order[] : [];
      if (!Array.isArray(local)) throw new Error('Local order history needs recovery before sync can continue.');
      const queuedIds = new Set(outbox.events.filter((event) => event.path === 'orders').map((event) => event.eventId));
      // Recover orders that could not fit in the bounded queue; local history is never silently discarded.
      const missing = local.filter((order) => !acknowledged.has(orderEventId(order)) && !queuedIds.has(orderEventId(order))).reverse();
      let index = 0;
      while (connection.enabled && connection.customerId === config.customerId) {
        // Fill only a single recovered order at a time, allowing an existing full queue to drain.
        if (!outbox.events.length && index < missing.length) {
          const order = missing[index++];
          const eventId = orderEventId(order);
          await append({ eventId, path: 'orders', body: { eventId, order } });
        }
        const event = outbox.events[0];
        if (!event) break;
        if (event.path === 'activity' && !connection.activitySharing) {
          await locked(async () => {
            const next = { ...outbox, events: outbox.events.filter((item) => item.eventId !== event.eventId) };
            await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
            outbox = next;
          });
          continue;
        }
        await request(config, event.path, event.body);
        await locked(async () => {
          const next = { ...outbox, events: outbox.events.filter((item) => item.eventId !== event.eventId) };
          // Only acknowledge locally after successful durable queue storage. Retrying is idempotent on the server.
          await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
          outbox = next;
          publish();
        });
      }
      if (connection.enabled) {
        const fresh = await request<RemoteOrders>(config, 'orders');
        remoteIdentity(fresh);
        publish({ connected: true, centralOrders: fresh.orders, unread: fresh.unread ?? 0, lastSyncedAt: new Date().toISOString(), error: undefined });
      }
    } catch (error) { report(error); }
    finally { publish({ syncing: false }); }
  })().finally(() => {
    syncing = undefined;
    // An event can arrive while the final status GET is in flight. Drain it immediately after a
    // successful run; failures wait for foreground/manual retry so they cannot create a retry loop.
    if (connection.enabled && !current.error && outbox.events.length) void syncAdmin();
  });
  return syncing;
}

/**
 * Confirms or declines an order the shop sent. Confirming passes it to the shop's inventory team to pack.
 * Sent straight away rather than queued: the customer should know at once whether the shop got the answer.
 */
export async function respondToShopOrder(id: string, decision: 'confirm' | 'decline'): Promise<void> {
  await initializeAdminSync();
  if (!connection.enabled) throw new Error('Log in first.');
  const result = await request<{ orders: CentralOrder[] }>({ ...connection }, `orders/${encodeURIComponent(id)}/respond`, { decision });
  publish({ connected: true, centralOrders: result.orders, error: undefined, lastSyncedAt: new Date().toISOString() });
}

export type FeedbackKind = 'feedback' | 'problem' | 'suggestion';
export type Feedback = { rating: number | null; kind: FeedbackKind; message: string; appVersion: string; platform: string };

/** The menu's Feedback screen. Sent straight away rather than queued: the screen says when it didn't go. */
export async function sendFeedback(feedback: Feedback): Promise<void> {
  await initializeAdminSync();
  if (!connection.enabled) throw new Error('Log in first, so the shop knows who it’s from.');
  try {
    await request({ ...connection }, 'feedback', feedback);
  } catch (error) {
    // A shop server from before feedback answers that the address doesn't exist.
    if (error instanceof Error && /does not exist|returned 404/.test(error.message)) throw new Error('The shop’s server can’t take feedback yet.');
    throw error;
  }
}

/** The Notifications screen's list, newest first (up to 100). */
async function linked() {
  await initializeAdminSync();
  if (!connection.enabled) throw new Error('Log in first.');
  return { ...connection };
}

/** A page of the Notification Center, newest first; the unread count comes with it and updates the bell and the icon. */
export async function fetchNotifications(query: NotificationQuery = {}): Promise<NotificationPage> {
  // Built by hand: React Native's URLSearchParams is incomplete.
  const params = Object.entries(query)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  const page = await request<Partial<NotificationPage>>(await linked(), `notifications${params ? `?${params}` : ''}`);
  // A shop server from before the Notification Center sends the whole list, without kinds or a count.
  const notifications = (page.notifications ?? []).map((item) => ({ ...item, category: item.category ?? (item.event === 'broadcast' ? 'announcements' : 'orders') }));
  const unread = page.unread ?? notifications.filter((item) => !item.read).length;
  publish({ unread });
  return { notifications, next: page.next ?? null, unread };
}

/** Read: one or some (ids), or all of them (no ids). The count is the server's, so every phone agrees. */
export async function markNotificationsRead(ids?: string[]): Promise<number> {
  // Everything read is the same request on a shop server from before the Notification Center (it has no read-all).
  const answer = await request<{ unread?: number }>(await linked(), 'notifications/read', ids ? { ids: ids.map(Number) } : {});
  const unread = answer.unread ?? 0;
  publish({ unread });
  return unread;
}

export async function deleteNotifications(ids: string[]): Promise<number> {
  const { unread } = await request<{ unread: number }>(await linked(), 'notifications/delete', { ids: ids.map(Number) });
  publish({ unread });
  return unread;
}

/** The unread count from the server: after a push arrives, and when the app comes back. Never a count kept here. */
export async function refreshUnread(): Promise<void> {
  if (!connection.enabled) return;
  const { unread } = await request<{ unread: number }>({ ...connection }, 'notifications/unread');
  publish({ unread });
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  return request<NotificationPreferences>(await linked(), 'notifications/preferences');
}

export async function saveNotificationPreferences(changes: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  return request<NotificationPreferences>(await linked(), 'notifications/preferences', changes);
}

export function useUnreadNotifications() {
  const [unread, setUnread] = useState(() => current.unread);
  useEffect(() => subscribeAdminSync((status) => setUnread(status.unread)), []);
  return unread;
}

export function startAdminSync() {
  void syncAdmin();
  const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void syncAdmin(); });
  return () => subscription.remove();
}
