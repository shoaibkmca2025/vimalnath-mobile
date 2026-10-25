import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import type { Order } from '@/providers/OrdersProvider';

/** Optional shop connection. Existing local app storage remains the order source of truth. */
export type AdminConnection = {
  enabled: boolean;
  baseUrl: string;
  deviceToken: string;
  activitySharing: boolean;
  allowLocalHttp: boolean;
  customerId?: string;
};
export type CentralOrder = { id: string; number?: string; status: string; mobileOrderId?: string; sourceId?: string; mobileEventId?: string; eventId?: string };
export type SyncStatus = {
  connection: AdminConnection;
  connected: boolean;
  syncing: boolean;
  pending: number;
  lastSyncedAt?: string;
  error?: string;
  centralOrders: CentralOrder[];
};
type Profile = { name: string; business: string; phone: string; email: string; city: string };
type Activity = { type: 'price_view' | 'catalogue_view'; productId?: string; productName?: string; optionIndex?: number; optionLabel?: string; price?: number };
type QueueEvent = { eventId: string; path: 'orders' | 'profile' | 'activity'; body: Record<string, unknown> };
type Outbox = { deviceId: string; customerId?: string; baseUrl?: string; events: QueueEvent[] };
type RemoteOrders = { customerId: string; orders: CentralOrder[] };

const CONNECTION_KEY = 'vimalnath:admin-connection:v1';
const OUTBOX_KEY = 'vimalnath:admin-outbox:v1';
const ORDERS_KEY = 'vimalnath:orders';
const PROFILE_KEY = 'vimalnath:profile';
const MAX_EVENTS = 400;
const MAX_QUEUE_CHARACTERS = 750_000;
const DEFAULT: AdminConnection = { enabled: false, baseUrl: '', deviceToken: '', activitySharing: false, allowLocalHttp: false };
let connection = { ...DEFAULT };
let outbox: Outbox = { deviceId: '', events: [] };
let current: SyncStatus = { connection, connected: false, syncing: false, pending: 0, centralOrders: [] };
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

async function request<T>(config: AdminConnection, path: string, body?: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.baseUrl}/api/mobile/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${config.deviceToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Shop connection rejected. Ask the shop owner to check your device token.');
      if (response.status === 429) throw new Error('The shop server is busy. Retry sync in a moment.');
      let detail = '';
      try {
        const failure = await response.json() as { error?: unknown };
        if (typeof failure.error === 'string') detail = failure.error.slice(0, 300);
      } catch { /* A proxy may return an HTML error page instead of JSON. */ }
      throw new Error(`Shop server returned ${response.status}. ${detail || 'Pending items remain saved for retry.'}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Shop connection timed out. Pending items remain saved for retry.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function remoteIdentity(remote: RemoteOrders): string {
  if (!remote || typeof remote.customerId !== 'string' || !Array.isArray(remote.orders)) throw new Error('The shop server response is not compatible with this app.');
  return remote.customerId;
}

export async function connectAdmin(input: Omit<AdminConnection, 'enabled' | 'customerId'>): Promise<void> {
  await initializeAdminSync();
  if (storageError) throw new Error(storageError);
  const config = { ...input, enabled: true, baseUrl: validateAdminUrl(input.baseUrl, input.allowLocalHttp), deviceToken: input.deviceToken.trim() };
  if (!config.deviceToken || /\s/.test(config.deviceToken)) throw new Error('Enter the device token issued by the shop owner.');
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
    publish({ connected: true, error: undefined, centralOrders: remote.orders });
  });
  const savedProfile = await AsyncStorage.getItem(PROFILE_KEY);
  if (savedProfile) await enqueueAdminProfile(JSON.parse(savedProfile) as Profile);
  await syncAdmin();
}

export async function disconnectAdmin(): Promise<void> {
  await initializeAdminSync();
  await locked(async () => {
    const next = { ...connection, enabled: false, activitySharing: false };
    await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(next));
    connection = next;
    // Keep credentials and pending events so reconnecting to the same customer can recover them.
    publish({ connected: false });
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
      if (remoteIdentity(remote) !== config.customerId) throw new Error('The device token is now assigned to a different customer. Sync stopped to protect your saved orders.');
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
        publish({ connected: true, centralOrders: fresh.orders, lastSyncedAt: new Date().toISOString(), error: undefined });
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

export function startAdminSync() {
  void syncAdmin();
  const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void syncAdmin(); });
  return () => subscription.remove();
}
