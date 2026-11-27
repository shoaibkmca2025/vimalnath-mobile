import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto';

import { Hono } from 'hono';
import nodemailer from 'nodemailer';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { fcmSender, readServiceAccount, TokenGone } from './fcm.ts';
import { announce, CATEGORIES, fill, inbox, markRead, notifyCustomer, notifyStaff, preferencesOf, PREFERENCE_CATEGORIES, remove, runScheduled, savePreferences, unreadOf, type Link } from './notify.ts';
import { only, type Env } from './staff.ts';
import { jsonBody } from './validate.ts';

/**
 * Module 10, notifications. A change that should notify someone queues its messages in the same transaction
 * (queueOrderEvent), so a slow or failed send never blocks saving it; sendQueued delivers them in the background,
 * three tries each, and the log keeps what happened.
 */

/** Staff hear when an order arrives from the app; the customer hears when staff move it on. */
const PUSH_EVENTS = ['confirmed', 'dispatched', 'delivered', 'cancelled'];
const MAX_ATTEMPTS = 3;

/** `badge`: the customer's unread count, the number for the app's icon. */
export type Message = { id: number; channel: 'push' | 'email'; recipient: string; title: string; body: string; data: Record<string, unknown> | null; attempts: number; badge: number };
/** A send function per channel; one left out isn't set up yet, and its messages are logged as skipped. */
export type Senders = { push?: (message: Message) => Promise<void>; fcm?: (message: Message) => Promise<void>; email?: (message: Message) => Promise<void> };
/** The push service's answer that this phone no longer takes notifications: stop sending to its address. */
export class DeviceGone extends Error {}

// --- Web Push (RFC 8291 and 8292), for the web app on a home screen. Node's own crypto; no library.

/** A browser's push subscription, as the app sends it: where to post, and its keys for encrypting to it. */
export type WebSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type WebPushKeys = { publicKey: string; privateKey: KeyObject };

/**
 * The browsers' own push services (Chrome, Safari, Firefox, Edge). A subscription naming any other address is refused,
 * so the server only ever posts to these, never to an address a phone made up.
 */
const PUSH_SERVICES = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
export function isPushService(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && PUSH_SERVICES.test(url.hostname);
  } catch {
    return false;
  }
}

const keyCache = new WeakMap<Sql, Promise<WebPushKeys>>();
/** The shop's key pair: made the first time it's needed (two servers at once keep the first), then read from the database. */
export function webPushKeys(sql: Sql): Promise<WebPushKeys> {
  let keys = keyCache.get(sql);
  if (!keys) {
    keys = (async () => {
      const made = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
      await sql`insert into web_push_keys (private_jwk) values (${sql.json(made as Record<string, string>)}) on conflict do nothing`;
      const [row] = await sql`select private_jwk from web_push_keys`;
      const jwk = row!.private_jwk as { x: string; y: string };
      // The public half as browsers want it: an uncompressed P-256 point.
      const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
      return { publicKey, privateKey: createPrivateKey({ key: row!.private_jwk, format: 'jwk' }) };
    })();
    keyCache.set(sql, keys);
    keys.catch(() => keyCache.delete(sql));
  }
  return keys;
}

/** RFC 8291: the message encrypted so only that browser can read it (aes128gcm, one record). */
export function encryptForBrowser(payload: string, subscription: WebSubscription): Buffer {
  const browserKey = Buffer.from(subscription.keys.p256dh, 'base64url');
  const authSecret = Buffer.from(subscription.keys.auth, 'base64url');
  const ours = createECDH('prime256v1');
  const ourKey = ours.generateKeys();
  const shared = ours.computeSecret(browserKey);
  const salt = randomBytes(16);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), browserKey, ourKey]), 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  // 2: this is the last (and only) record.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(ourKey.length, 20);
  return Buffer.concat([header, ourKey, sealed]);
}

/** RFC 8292: proves the message comes from this shop's server (a signed token the push service checks), valid 12 hours. */
function vapidAuthorization(endpoint: string, keys: WebPushKeys, contact: string) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${keys.publicKey}`;
}

/** Posts one message to a browser's push service. What the phone shows: title, body, the order to open, the icon's number. */
async function sendWebPush(sql: Sql, message: Message, contact: string) {
  const subscription = JSON.parse(message.recipient) as WebSubscription;
  if (!isPushService(subscription.endpoint)) throw new DeviceGone('Not a browser push service.');
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, await webPushKeys(sql), contact),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // Kept a day for a phone that's off; sent at once, so the phone wakes for it.
      TTL: '86400',
      Urgency: 'high',
    },
    body: new Uint8Array(encryptForBrowser(JSON.stringify({ title: message.title, body: message.body, data: message.data ?? {}, badge: message.badge }), subscription)),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return;
  // Notifications turned off or the app removed: the browser dropped this address.
  if (res.status === 404 || res.status === 410) throw new DeviceGone('This phone no longer accepts notifications.');
  throw new Error(`The push service answered ${res.status}. ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
}

const money = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

/** Where a tap on an order's notification goes in the app: the phone's own copy if it placed it, otherwise the shop's. */
export const orderLink = (order: { id: number; client_order_id?: string | null; source?: string | null }): Link => ({
  entityType: 'order',
  entityId: order.id,
  data: order.client_order_id && order.source !== 'admin' ? { orderId: order.client_order_id } : { shopOrderId: String(order.id) },
});

/**
 * The messages an order event causes, inside the caller's transaction: a new order emails the staff addresses and
 * reaches the office's notification center, and the customer hears it was received; staff moving it on, or sending
 * one to confirm, tells the customer. Each status change notifies once (a repeat of the same change doesn't).
 */
export async function queueOrderEvent(tx: TransactionSql, orderId: number, event: string) {
  if (!['placed', 'requested', ...PUSH_EVENTS].includes(event)) return;
  const [order] = await tx`
    select o.id, o.number, o.customer, o.total, coalesce(o.bill_amount, o.total) as bill, o.client_order_id, o.source, o.device_id,
      (select coalesce(sum(qty), 0)::int from order_lines where order_id = o.id) as items,
      (select count(*)::int from order_events where order_id = o.id and status = ${event}) as times
    from orders o where o.id = ${orderId}`;
  if (!order) return;
  const values = { number: order.number, customer: order.customer, total: money(order.bill), items: `${order.items} item${order.items === 1 ? '' : 's'}` };
  const key = `${event}:${order.id}:${order.times}`;
  const link = orderLink(order);
  if (event === 'placed') {
    const [template] = await tx`select title, body from notification_templates where event = 'placed'`;
    const recipients = await tx`select email from staff_alert_recipients order by email`;
    if (template && recipients.length)
      await tx`insert into notification_log ${tx(recipients.map(({ email }) => ({ event, channel: 'email', recipient: email, order_id: order.id, title: fill(template.title, values), body: fill(template.body, values) })))}`;
    await notifyStaff(tx, 'placed', values, { entityType: 'order', entityId: order.id, data: { to: `/orders/${order.id}` } }, { roles: ['sales'] }, key);
    await notifyCustomer(tx, order.device_id, 'received', values, link, key, order.id);
    return;
  }
  await notifyCustomer(tx, order.device_id, event, values, link, key, order.id);
}

/** Sends up to `limit` queued messages. Run on a timer; several servers can run it at once without sending twice. */
export async function sendQueued(sql: Sql, senders: Senders, limit = 50) {
  // The badge is the person's unread count when it goes out, the number for the app's icon.
  const batch = await sql<Message[]>`
    update notification_log set attempts = attempts + 1
    where id in (select id from notification_log where status = 'pending' order by id limit ${limit} for update skip locked)
    returning id, channel, recipient, title, body, data, attempts,
      (select count(*)::int from notifications n where n.account_id = notification_log.device_id and not n.is_read and n.deleted_at is null) as badge`;
  for (const message of batch) {
    // A phone's address says which service delivers to it: a browser's subscription, an Expo token, or an FCM token.
    const kind = message.channel === 'email' ? 'email' : message.recipient.startsWith('{') || /^Expo(nent)?PushToken\[/.test(message.recipient) ? 'push' : 'fcm';
    const send = senders[kind];
    if (!send) {
      const why = kind === 'email' ? 'Not set up: add SMTP_URL to the server’s settings to send email.' : 'Not set up: add FCM_SERVICE_ACCOUNT (the Firebase key) to the server’s settings to send to Android phones.';
      await sql`update notification_log set status = 'skipped', error = ${why} where id = ${message.id}`;
      continue;
    }
    try {
      await send(message);
      await sql`update notification_log set status = 'sent', sent_at = now(), error = null where id = ${message.id}`;
    } catch (error) {
      const gone = error instanceof DeviceGone || error instanceof TokenGone;
      const final = gone || message.attempts >= MAX_ATTEMPTS;
      await sql`update notification_log set status = ${final ? 'failed' : 'pending'}, error = ${(error instanceof Error ? error.message : 'Unknown error').slice(0, 300)} where id = ${message.id}`;
      if (gone) {
        await sql`delete from device_tokens where token = ${message.recipient}`;
        await sql`update app_devices set push_token = null where push_token = ${message.recipient}`;
      }
    }
  }
  return batch.length;
}

/**
 * The real senders. FCM for the Android app needs FCM_SERVICE_ACCOUNT (the Firebase project's service account key);
 * Web Push (the web app on a home screen, signed with the shop's own key) and Expo need nothing set up here. Email needs
 * SMTP_URL, e.g. smtps://user:password@smtp.gmail.com.
 */
export function realSenders(config: { SMTP_URL?: string; MAIL_FROM?: string; EXPO_ACCESS_TOKEN?: string; FCM_SERVICE_ACCOUNT?: string; ADMIN_ORIGIN: string }, sql: Sql): Senders {
  const mailer = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  const from = config.MAIL_FROM ?? (config.SMTP_URL ? decodeURIComponent(new URL(config.SMTP_URL).username) : '');
  const fcm = config.FCM_SERVICE_ACCOUNT ? fcmSender(readServiceAccount(config.FCM_SERVICE_ACCOUNT)) : null;
  return {
    // shortcut: trusts Expo's ticket ("received"); fetch receipts about 15 minutes later to also catch phones that refused it.
    push: async (message) => {
      // A browser's address is its subscription, as JSON; the push service may contact the shop at its admin's address.
      if (message.recipient.startsWith('{')) return sendWebPush(sql, message, config.ADMIN_ORIGIN);
      const channelId = typeof message.data?.channel === 'string' ? message.data.channel : 'orders';
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(config.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify({ to: message.recipient, title: message.title, body: message.body, data: message.data ?? {}, sound: 'default', channelId, badge: message.badge }),
        signal: AbortSignal.timeout(15_000),
      });
      const answer = (await res.json().catch(() => null)) as { data?: { status: string; message?: string; details?: { error?: string } } | { status: string; message?: string; details?: { error?: string } }[]; errors?: { message: string }[] } | null;
      const ticket = Array.isArray(answer?.data) ? answer.data[0] : answer?.data;
      if (res.ok && ticket?.status === 'ok') return;
      if (ticket?.details?.error === 'DeviceNotRegistered') throw new DeviceGone('This phone no longer accepts notifications.');
      throw new Error(ticket?.message ?? answer?.errors?.[0]?.message ?? `Expo answered ${res.status}.`);
    },
    fcm: fcm ? (message) => fcm({ token: message.recipient, title: message.title, body: message.body, data: message.data, badge: message.badge }) : undefined,
    email: mailer
      ? async (message) => {
          await mailer.sendMail({ from, to: message.recipient, subject: message.title, text: message.body });
        }
      : undefined,
  };
}

/** Delivers the queue every 10 seconds, and runs the scheduled jobs (reminders, retention) at their own pace. */
export function startNotifier(sql: Sql, senders: Senders) {
  const timer = setInterval(() => {
    sendQueued(sql, senders)
      .then(() => runScheduled(sql))
      .catch((error: unknown) => console.error('Sending notifications failed:', error));
  }, 10_000);
  return () => clearInterval(timer);
}

const Template = z.object({ event: z.string(), title: z.string().trim().min(1, 'Enter a title.').max(100, 'Use 100 characters or fewer.'), body: z.string().trim().min(1, 'Enter the message.').max(400, 'Use 400 characters or fewer.') });
const Email = z.string().trim().toLowerCase().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter email addresses like sales@company.com.');
const Announce = z
  .object({
    audience: z.enum(['customers', 'staff'], 'Choose customers or staff.'),
    accountIds: z.array(z.number().int().positive().max(2147483647)).min(1, 'Choose at least one customer.').max(5000).optional(),
    roles: z.array(z.enum(['owner', 'sales', 'catalogue', 'inventory', 'accountant'])).min(1, 'Choose at least one role.').optional(),
    category: z.enum(CATEGORIES, 'Choose a category.').default('announcements'),
    title: Template.shape.title,
    body: Template.shape.body,
  })
  .refine((input) => input.audience === 'customers' || !input.accountIds, { message: 'Choose customers, or send to staff by role.', path: ['accountIds'] });
const ReminderSettings = z.object({
  paymentReminders: z.boolean(),
  remindDaysBefore: z.number().int('Enter whole days.').min(0, 'Enter 0 or more.').max(30, 'Use 30 days or fewer.'),
  overdueEveryDays: z.number().int('Enter whole days.').min(1, 'Enter 1 day or more.').max(90, 'Use 90 days or fewer.'),
});

/** The admin's Notifications page: wording, who gets new-order emails, the delivery log, announcements. Owners only. */
export function notificationRoutes(sql: Sql, setup: { email: boolean; fcm?: boolean }) {
  const notifications = new Hono<Env>();
  notifications.use(only('owner'));

  const reminderSettings = async () => {
    const [row] = await sql`select payment_reminders as "paymentReminders", remind_days_before as "remindDaysBefore", overdue_every_days as "overdueEveryDays", updated_by as "updatedBy", updated_at as "updatedAt" from notification_settings`;
    return row;
  };

  notifications.get('/', async (c) => {
    const [templates, recipients, log, tokens] = await Promise.all([
      sql`select event, channel, audience, category, title, body from notification_templates order by sort_order`,
      sql`select email from staff_alert_recipients order by email`,
      // shortcut: the newest 300; add filters and paging when people need to look further back.
      sql`
        select l.id, l.event, l.channel, l.recipient, coalesce(d.label, '') as "appUser", o.number as "orderNumber", l.title, l.status, l.attempts, l.error,
          l.created_at as "createdAt", l.sent_at as "sentAt", t.kind as "deviceKind"
        from notification_log l left join app_devices d on d.id = l.device_id left join orders o on o.id = l.order_id left join device_tokens t on t.id = l.device_token_id
        order by l.id desc limit 300`,
      sql`select kind, count(*)::int as phones, count(distinct account_id)::int as accounts from device_tokens group by kind`,
    ]);
    return c.json({ setup: { email: setup.email, fcm: Boolean(setup.fcm) }, templates, recipients: recipients.map((row) => row.email), log, devices: tokens, reminders: await reminderSettings() });
  });

  notifications.put('/templates', jsonBody(z.object({ templates: z.array(Template).max(100) })), async (c) => {
    const { templates } = c.req.valid('json');
    await sql.begin(async (tx) => {
      for (const { event, title, body } of templates) await tx`update notification_templates set title = ${title}, body = ${body} where event = ${event}`;
    });
    return c.body(null, 204);
  });

  notifications.put('/recipients', jsonBody(z.object({ emails: z.array(Email).max(10, 'Up to 10 addresses.') })), async (c) => {
    const emails = [...new Set(c.req.valid('json').emails)];
    await sql.begin(async (tx) => {
      await tx`delete from staff_alert_recipients`;
      if (emails.length) await tx`insert into staff_alert_recipients ${tx(emails.map((email) => ({ email })))}`;
    });
    return c.body(null, 204);
  });

  // Payment reminders to customers (off until the Owner turns them on), and their timing.
  notifications.put('/settings', jsonBody(ReminderSettings), async (c) => {
    const input = c.req.valid('json');
    await sql`update notification_settings set payment_reminders = ${input.paymentReminders}, remind_days_before = ${input.remindDaysBefore}, overdue_every_days = ${input.overdueEveryDays}, updated_by = ${c.get('staff').name}, updated_at = now()`;
    return c.json(await reminderSettings());
  });

  // 10.5: one message to every app user, e.g. a new price list. `queued` counts the pushes, `users` everyone who gets it.
  notifications.post('/broadcast', jsonBody(Template.omit({ event: true })), async (c) => {
    const { title, body } = c.req.valid('json');
    const sent = await announce(sql, { audience: 'customers', category: 'announcements', title, body, by: c.get('staff').name });
    return c.json({ queued: sent.queued, users: sent.users });
  });

  // To all customers, chosen customers, or staff (all, or some roles), in a category people can turn off (system alerts always come).
  notifications.post('/announce', jsonBody(Announce), async (c) => {
    const input = c.req.valid('json');
    const sent = await announce(sql, { ...input, by: c.get('staff').name });
    return c.json(sent, 201);
  });

  // What was announced, to whom, how many have read it, and how its pushes went.
  notifications.get('/announcements', async (c) =>
    c.json(
      await sql`
        select a.id, a.audience, a.target, a.category, a.title, a.body, a.created_by as "createdBy", a.created_at as "createdAt",
          (select count(*)::int from notifications n where n.announcement_id = a.id) as recipients,
          (select count(*)::int from notifications n where n.announcement_id = a.id and n.is_read) as read,
          (select json_build_object(
              'sent', count(*) filter (where l.status = 'sent'), 'failed', count(*) filter (where l.status = 'failed'),
              'pending', count(*) filter (where l.status = 'pending'), 'skipped', count(*) filter (where l.status = 'skipped'))
            from notification_log l join notifications n on n.id = l.notification_id where n.announcement_id = a.id) as pushes
        from announcements a order by a.id desc limit 200`,
    ),
  );

  return notifications;
}

const InboxQuery = z.object({
  filter: z.enum(['all', 'unread', 'read']).default('all'),
  category: z.enum(CATEGORIES).optional(),
  q: z.string().trim().max(100).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const readInboxQuery = (query: Record<string, string>) => {
  const result = InboxQuery.safeParse(query);
  return result.success ? result.data : InboxQuery.parse({});
};
const Ids = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });
const PreferencesInput = z.object(Object.fromEntries([...PREFERENCE_CATEGORIES.map((category) => `${category}_enabled`), 'sound_enabled', 'vibration_enabled'].map((key) => [key, z.boolean().optional()]))).strict();
export { Ids as InboxIds, PreferencesInput };

/** /v1/admin/inbox: each staff member's own notification center, and their choices. */
export function inboxRoutes(sql: Sql) {
  const inboxes = new Hono<Env>();
  const me = (c: { get: (key: 'staff') => { id: number } }) => ({ staffId: c.get('staff').id });
  inboxes.get('/', async (c) => c.json(await inbox(sql, me(c), readInboxQuery(c.req.query()))));
  inboxes.get('/count', async (c) => c.json({ unread: await unreadOf(sql, me(c)) }));
  inboxes.post('/read', jsonBody(Ids), async (c) => c.json({ unread: await markRead(sql, me(c), c.req.valid('json').ids) }));
  inboxes.post('/read-all', async (c) => c.json({ unread: await markRead(sql, me(c), 'all') }));
  inboxes.post('/delete', jsonBody(Ids), async (c) => c.json(await remove(sql, me(c), c.req.valid('json').ids)));
  inboxes.get('/preferences', async (c) => c.json(await preferencesOf(sql, me(c))));
  inboxes.put('/preferences', jsonBody(PreferencesInput), async (c) => c.json(await savePreferences(sql, me(c), c.req.valid('json'))));
  return inboxes;
}
