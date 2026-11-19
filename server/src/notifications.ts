import { Hono } from 'hono';
import nodemailer from 'nodemailer';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { jsonBody } from './validate.ts';

/**
 * Module 10, notifications. A change that should notify someone queues its messages in the same transaction
 * (queueOrderEvent), so a slow or failed send never blocks saving it; sendQueued delivers them in the background,
 * three tries each, and the log keeps what happened.
 */

/** Staff get an email when an order arrives from the app; the customer gets a push when staff move it on. */
const PUSH_EVENTS = ['confirmed', 'dispatched', 'delivered', 'cancelled'];
const MAX_ATTEMPTS = 3;

export type Message = { id: number; channel: 'push' | 'email'; recipient: string; title: string; body: string; data: Record<string, unknown> | null; attempts: number };
/** A send function per channel; one left out isn't set up yet, and its messages are logged as skipped. */
export type Senders = { push?: (message: Message) => Promise<void>; email?: (message: Message) => Promise<void> };
/** Expo's answer that this phone no longer takes notifications: stop sending to its address. */
export class DeviceGone extends Error {}

const money = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;
/** Why a customer's message wasn't sent as a push: it is still on the app's Notifications screen. */
const APP_ONLY = 'No push address (e.g. the web app): shown on the app’s Notifications screen only.';

/** Queues the messages an order event causes, inside the caller's transaction. Nothing is queued for nobody. */
export async function queueOrderEvent(tx: TransactionSql, orderId: number, event: string) {
  if (event !== 'placed' && !PUSH_EVENTS.includes(event)) return;
  const [order] = await tx`
    select o.id, o.number, o.customer, o.total, o.client_order_id, o.device_id, d.push_token,
      (select coalesce(sum(qty), 0)::int from order_lines where order_id = o.id) as items
    from orders o join app_devices d on d.id = o.device_id where o.id = ${orderId}`;
  const [template] = await tx`select channel, title, body from notification_templates where event = ${event}`;
  if (!order || !template) return;
  const values: Record<string, string> = { number: order.number, customer: order.customer, total: money(order.total), items: `${order.items} item${order.items === 1 ? '' : 's'}` };
  const fill = (text: string) => text.replace(/\{(number|customer|total|items)\}/g, (_, key: string) => values[key]!);
  const message = { event, order_id: order.id, title: fill(template.title), body: fill(template.body) };
  if (template.channel === 'email') {
    const recipients = await tx`select email from staff_alert_recipients order by email`;
    if (recipients.length) await tx`insert into notification_log ${tx(recipients.map(({ email }) => ({ ...message, channel: 'email', recipient: email })))}`;
  } else {
    // A tap opens the order: the phone's own copy if it placed it, otherwise the one the shop sent.
    const data = order.client_order_id ? { orderId: order.client_order_id } : { shopOrderId: String(order.id) };
    // Always kept for the app's Notifications screen; pushed only to a phone that gave an address.
    const delivery = order.push_token ? { recipient: order.push_token } : { recipient: '', status: 'skipped', error: APP_ONLY };
    await tx`insert into notification_log ${tx({ ...message, ...delivery, channel: 'push', device_id: order.device_id, data: tx.json(data) })}`;
  }
}

/** The app's Notifications screen: this account's order updates and the shop's messages, newest first. */
export const appInbox = (sql: Sql, deviceId: number) => sql`
  select l.id::text as id, l.event, l.title, l.body, coalesce(l.data, '{}') as data, l.created_at as "createdAt", l.read_at is not null as read
  from notification_log l where l.device_id = ${deviceId} and l.channel = 'push' order by l.id desc limit 100`;

/** The number on the app's bell, sent with every sync. */
export async function appUnread(sql: Sql, deviceId: number) {
  const [row] = await sql`select count(*)::int as unread from notification_log where device_id = ${deviceId} and channel = 'push' and read_at is null`;
  return row!.unread as number;
}

/** Sends up to `limit` queued messages. Run on a timer; several servers can run it at once without sending twice. */
export async function sendQueued(sql: Sql, senders: Senders, limit = 50) {
  const batch = await sql<Message[]>`
    update notification_log set attempts = attempts + 1
    where id in (select id from notification_log where status = 'pending' order by id limit ${limit} for update skip locked)
    returning id, channel, recipient, title, body, data, attempts`;
  for (const message of batch) {
    const send = senders[message.channel];
    if (!send) {
      await sql`update notification_log set status = 'skipped', error = 'Not set up: add SMTP_URL to the server’s settings to send email.' where id = ${message.id}`;
      continue;
    }
    try {
      await send(message);
      await sql`update notification_log set status = 'sent', sent_at = now(), error = null where id = ${message.id}`;
    } catch (error) {
      const gone = error instanceof DeviceGone;
      const final = gone || message.attempts >= MAX_ATTEMPTS;
      await sql`update notification_log set status = ${final ? 'failed' : 'pending'}, error = ${(error instanceof Error ? error.message : 'Unknown error').slice(0, 300)} where id = ${message.id}`;
      if (gone) await sql`update app_devices set push_token = null where push_token = ${message.recipient}`;
    }
  }
  return batch.length;
}

/**
 * The real senders. Push goes through Expo's service, which needs nothing here; phones only have an address once the
 * app is built with an EAS project. Email needs SMTP_URL, e.g. smtps://user:password@smtp.gmail.com.
 */
export function realSenders(config: { SMTP_URL?: string; MAIL_FROM?: string; EXPO_ACCESS_TOKEN?: string }): Senders {
  const mailer = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  const from = config.MAIL_FROM ?? (config.SMTP_URL ? decodeURIComponent(new URL(config.SMTP_URL).username) : '');
  return {
    // shortcut: trusts Expo's ticket ("received"); fetch receipts about 15 minutes later to also catch phones that refused it.
    push: async (message) => {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(config.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify({ to: message.recipient, title: message.title, body: message.body, data: message.data ?? {}, sound: 'default', channelId: 'orders' }),
        signal: AbortSignal.timeout(15_000),
      });
      const answer = (await res.json().catch(() => null)) as { data?: { status: string; message?: string; details?: { error?: string } } | { status: string; message?: string; details?: { error?: string } }[]; errors?: { message: string }[] } | null;
      const ticket = Array.isArray(answer?.data) ? answer.data[0] : answer?.data;
      if (res.ok && ticket?.status === 'ok') return;
      if (ticket?.details?.error === 'DeviceNotRegistered') throw new DeviceGone('This phone no longer accepts notifications.');
      throw new Error(ticket?.message ?? answer?.errors?.[0]?.message ?? `Expo answered ${res.status}.`);
    },
    email: mailer
      ? async (message) => {
          await mailer.sendMail({ from, to: message.recipient, subject: message.title, text: message.body });
        }
      : undefined,
  };
}

/** Delivers the queue every 10 seconds. Returns a function that stops it. */
export function startNotifier(sql: Sql, senders: Senders) {
  const timer = setInterval(() => {
    sendQueued(sql, senders).catch((error: unknown) => console.error('Sending notifications failed:', error));
  }, 10_000);
  return () => clearInterval(timer);
}

const Template = z.object({ event: z.string(), title: z.string().trim().min(1, 'Enter a title.').max(100, 'Use 100 characters or fewer.'), body: z.string().trim().min(1, 'Enter the message.').max(400, 'Use 400 characters or fewer.') });
const Email = z.string().trim().toLowerCase().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter email addresses like sales@company.com.');

/** The admin's Notifications page: wording, who gets new-order emails, the delivery log, and broadcasts. Owners only. */
export function notificationRoutes(sql: Sql, setup: { email: boolean }) {
  const notifications = new Hono<Env>();
  notifications.use(only('owner'));

  notifications.get('/', async (c) => {
    const [templates, recipients, log] = await Promise.all([
      sql`select event, channel, title, body from notification_templates order by sort_order`,
      sql`select email from staff_alert_recipients order by email`,
      // shortcut: the newest 300; add filters and paging when people need to look further back.
      sql`
        select l.id, l.event, l.channel, l.recipient, coalesce(d.label, '') as "appUser", o.number as "orderNumber", l.title, l.status, l.attempts, l.error,
          l.created_at as "createdAt", l.sent_at as "sentAt"
        from notification_log l left join app_devices d on d.id = l.device_id left join orders o on o.id = l.order_id
        order by l.id desc limit 300`,
    ]);
    return c.json({ setup, templates, recipients: recipients.map((row) => row.email), log });
  });

  notifications.put('/templates', jsonBody(z.object({ templates: z.array(Template).max(20) })), async (c) => {
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

  // 10.5: one message to every app user, e.g. a new price list: on each one's Notifications screen, and as a push where
  // the phone takes them. `queued` counts the pushes, `users` everyone who gets it.
  notifications.post('/broadcast', jsonBody(Template.omit({ event: true })), async (c) => {
    const { title, body } = c.req.valid('json');
    const rows = await sql`
      insert into notification_log (event, channel, recipient, device_id, title, body, status, error)
      select 'broadcast', 'push', coalesce(push_token, ''), id, ${title}, ${body},
        case when push_token is null then 'skipped' else 'pending' end, case when push_token is null then ${APP_ONLY} end
      from app_devices where not blocked
      returning status`;
    return c.json({ queued: rows.filter((row) => row.status === 'pending').length, users: rows.length });
  });

  return notifications;
}
