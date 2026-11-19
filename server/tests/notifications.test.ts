import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { appRoutes, appUserAdminRoutes } from '../src/app-users.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { DeviceGone, notificationRoutes, sendQueued, type Message } from '../src/notifications.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
const TOKEN = 'ExponentPushToken[abc123]';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('notifications', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/app-users', appUserAdminRoutes(sql));
  admin.route('/orders', orderAdminRoutes(sql));
  admin.route('/notifications', notificationRoutes(sql, { email: false }));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

async function staff(role: string) {
  const email = `staff${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Staff ${next}`}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

/** A linked phone that places one order of 2 × p1 (₹1,500 each) and returns the shop's order id. */
async function phoneWithOrder(owner: Record<string, string>, pushToken?: string) {
  void owner;
  const { token } = (await (await send('/v1/app/register', 'POST', { name: `Phone ${++next}`, phone: `96${String(next).padStart(8, '0')}`, password: 'phone password' })).json()) as { token: string };
  const auth = { Authorization: `Bearer ${token}` };
  if (pushToken) assert.equal((await send('/v1/app/push-token', 'POST', { token: pushToken }, auth)).status, 200);
  const order = { id: `phone-order-${next}`, number: 'VSC-0001', createdAt: '2026-11-10T10:00:00.000Z', customer: 'Site A', status: 'Placed', lines: [{ productId: 'p1', code: 'TGH-55', name: 'Handle', option: 'SSS', qty: 2, mrp: 1500 }], total: 3000 };
  assert.equal((await send('/v1/app/orders', 'POST', { eventId: `event-${next}`, order }, auth)).status, 200);
  const [row] = await sql`select id, number from orders where client_order_id = ${order.id}`;
  return { id: row!.id as number, number: row!.number as string, phoneOrderId: order.id, auth };
}

const queued = (orderId: number) => sql`select event, channel, recipient, title, body, data, status from notification_log where order_id = ${orderId} order by id`;

test('a new app order queues an email to each staff address, in the template’s words', { skip }, async () => {
  const owner = await staff('owner');
  assert.equal((await send('/v1/admin/notifications/recipients', 'PUT', { emails: ['Orders@Vimalnath.in', 'owner@vimalnath.in', 'orders@vimalnath.in'] }, owner)).status, 204);
  const order = await phoneWithOrder(owner);
  const rows = await queued(order.id);
  assert.deepEqual(rows.map((row) => [row.channel, row.recipient, row.status]), [['email', 'orders@vimalnath.in', 'pending'], ['email', 'owner@vimalnath.in', 'pending']]);
  assert.equal(rows[0]!.title, `New order ${order.number} from Site A`);
  assert.equal(rows[0]!.body, `Site A placed ${order.number} in the app: 2 items, ₹3,000 at MRP. Open the admin to confirm it.`);

  assert.equal((await send('/v1/admin/notifications/recipients', 'PUT', { emails: [] }, owner)).status, 204);
  assert.equal((await queued((await phoneWithOrder(owner)).id)).length, 0);
});

test('staff moving an order on queues a push for a phone that takes notifications; a tap opens that order', { skip }, async () => {
  const owner = await staff('owner');
  const order = await phoneWithOrder(owner, TOKEN);
  assert.equal((await send('/v1/admin/orders/status', 'POST', { ids: [order.id], status: 'confirmed' }, owner)).status, 200);
  const [push] = await queued(order.id);
  assert.deepEqual(
    { channel: push!.channel, recipient: push!.recipient, title: push!.title, body: push!.body, data: push!.data },
    { channel: 'push', recipient: TOKEN, title: `Order ${order.number} confirmed`, body: `Vimalnath has confirmed your order ${order.number}.`, data: { orderId: order.phoneOrderId } },
  );
  // Packing is the warehouse's step, not news for the customer.
  await send('/v1/admin/orders/status', 'POST', { ids: [order.id], status: 'packed' }, owner);
  assert.equal((await queued(order.id)).length, 1);
  // A phone without a push address (the web app) keeps it for its Notifications screen, and nothing is sent.
  const quiet = await phoneWithOrder(owner);
  await send('/v1/admin/orders/status', 'POST', { ids: [quiet.id], status: 'dispatched' }, owner);
  assert.deepEqual((await queued(quiet.id)).map((row) => [row.channel, row.recipient, row.status]), [['push', '', 'skipped']]);
});

test('the app’s Notifications screen: this account’s updates and the shop’s messages, newest first; opening it clears the bell', { skip }, async () => {
  const owner = await staff('owner');
  const mine = await phoneWithOrder(owner);
  const theirs = await phoneWithOrder(owner);
  const bell = async (auth: Record<string, string>) => ((await (await send('/v1/app/orders', 'GET', undefined, auth)).json()) as { unread: number }).unread;
  type Item = { event: string; title: string; data: Record<string, string>; read: boolean };
  const inbox = async (auth: Record<string, string>) => ((await (await send('/v1/app/notifications', 'GET', undefined, auth)).json()) as { notifications: Item[] }).notifications;
  assert.equal(await bell(mine.auth), 0);

  await send('/v1/admin/orders/status', 'POST', { ids: [mine.id], status: 'confirmed' }, owner);
  await send('/v1/admin/orders/status', 'POST', { ids: [mine.id], status: 'dispatched' }, owner);
  const broadcast = await send('/v1/admin/notifications/broadcast', 'POST', { title: 'Closed on Sunday', body: 'For Diwali.' }, owner);
  assert.equal(((await broadcast.json()) as { users: number }).users > 0, true);
  assert.equal(await bell(mine.auth), 3);
  const items = await inbox(mine.auth);
  assert.deepEqual(
    items.map((item) => [item.event, item.title, item.read]),
    [['broadcast', 'Closed on Sunday', false], ['dispatched', `Order ${mine.number} dispatched`, false], ['confirmed', `Order ${mine.number} confirmed`, false]],
  );
  assert.deepEqual(items[1]!.data, { orderId: mine.phoneOrderId });
  // Only this account's orders: the other customer sees the shop's message, not this order.
  assert.deepEqual((await inbox(theirs.auth)).map((item) => item.event), ['broadcast']);

  assert.equal((await send('/v1/app/notifications/read', 'POST', {}, mine.auth)).status, 200);
  assert.equal(await bell(mine.auth), 0);
  assert.deepEqual((await inbox(mine.auth)).map((item) => item.read), [true, true, true]);
  assert.equal(await bell(theirs.auth), 1);
  assert.equal((await send('/v1/app/notifications', 'GET', undefined, { Authorization: 'Bearer nope' })).status, 401);
});

test('sending: delivered once; a failure is tried three times; email without SMTP is skipped; a phone Expo no longer knows is dropped', { skip }, async () => {
  await sql`update notification_log set status = 'sent' where status = 'pending'`;
  const owner = await staff('owner');
  const order = await phoneWithOrder(owner, 'ExponentPushToken[gone]');
  const add = (channel: string, recipient: string) => sql<{ id: number }[]>`insert into notification_log (event, channel, recipient, order_id, title, body) values ('test', ${channel}, ${recipient}, ${order.id}, 'T', 'B') returning id`;
  const [[ok], [flaky], [mail], [gone]] = [await add('push', 'ExponentPushToken[ok]'), await add('push', 'ExponentPushToken[flaky]'), await add('email', 'a@b.in'), await add('push', 'ExponentPushToken[gone]')];
  const delivered: string[] = [];
  const push = async (message: Message) => {
    if (message.recipient.includes('flaky')) throw new Error('Expo answered 503.');
    if (message.recipient.includes('gone')) throw new DeviceGone('This phone no longer accepts notifications.');
    delivered.push(message.recipient);
  };
  const statusOf = async (row: { id: number }) => (await sql`select status, attempts, error from notification_log where id = ${row.id}`)[0]!;

  await sendQueued(sql, { push });
  assert.deepEqual(delivered, ['ExponentPushToken[ok]']);
  assert.equal((await statusOf(ok!)).status, 'sent');
  assert.deepEqual({ ...(await statusOf(flaky!)) }, { status: 'pending', attempts: 1, error: 'Expo answered 503.' });
  assert.match((await statusOf(mail!)).error, /Not set up: add SMTP_URL/);
  assert.equal((await statusOf(mail!)).status, 'skipped');
  assert.equal((await statusOf(gone!)).status, 'failed');
  assert.equal((await sql`select push_token from app_devices where push_token = 'ExponentPushToken[gone]'`).length, 0);

  await sendQueued(sql, { push });
  await sendQueued(sql, { push });
  assert.deepEqual({ ...(await statusOf(flaky!)) }, { status: 'failed', attempts: 3, error: 'Expo answered 503.' });
  await sendQueued(sql, { push });
  assert.deepEqual(delivered, ['ExponentPushToken[ok]']);
});

test('the Owner edits wording and recipients and broadcasts; others can’t; bad input is refused', { skip }, async () => {
  const owner = await staff('owner');
  assert.equal((await send('/v1/admin/notifications', 'GET', undefined, await staff('sales'))).status, 403);
  const page = (await (await send('/v1/admin/notifications', 'GET', undefined, owner)).json()) as { setup: { email: boolean }; templates: { event: string; title: string; body: string }[] };
  assert.deepEqual(page.setup, { email: false });
  assert.deepEqual(page.templates.map((template) => template.event), ['placed', 'confirmed', 'dispatched', 'delivered', 'cancelled']);

  const edited = page.templates.map((template) => (template.event === 'dispatched' ? { ...template, title: '{number} is on the way', body: 'Track it with us on WhatsApp.' } : template));
  assert.equal((await send('/v1/admin/notifications/templates', 'PUT', { templates: edited }, owner)).status, 204);
  const order = await phoneWithOrder(owner, 'ExponentPushToken[words]');
  await send('/v1/admin/orders/status', 'POST', { ids: [order.id], status: 'dispatched' }, owner);
  assert.equal((await queued(order.id))[0]!.title, `${order.number} is on the way`);

  assert.equal((await send('/v1/admin/notifications/templates', 'PUT', { templates: [{ event: 'placed', title: ' ', body: 'x' }] }, owner)).status, 400);
  assert.equal((await send('/v1/admin/notifications/recipients', 'PUT', { emails: ['not an email'] }, owner)).status, 400);
  assert.equal((await send('/v1/app/push-token', 'POST', { token: 'https://evil.example' }, order.auth)).status, 400);

  // A phone the shop turned off gets nothing, even though it once gave an address.
  await phoneWithOrder(owner, 'ExponentPushToken[blocked]');
  await sql`update app_devices set blocked = true where push_token = 'ExponentPushToken[blocked]'`;
  const devices = Number((await sql`select count(*) from app_devices where push_token is not null and not blocked`)[0]!.count);
  const users = Number((await sql`select count(*) from app_devices where not blocked`)[0]!.count);
  const broadcast = (await (await send('/v1/admin/notifications/broadcast', 'POST', { title: 'New price list', body: 'The Feb 2027 prices are in the app.' }, owner)).json()) as { queued: number; users: number };
  assert.equal(broadcast.queued, devices);
  assert.equal(broadcast.users, users);
  assert.ok(devices > 0 && users > devices);
});
