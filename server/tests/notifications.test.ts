import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { test } from 'node:test';

import type postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { appRoutes, appUserAdminRoutes } from '../src/app-users.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { DeviceGone, inboxRoutes, notificationRoutes, realSenders, sendQueued, type Message } from '../src/notifications.ts';
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
  admin.route('/inbox', inboxRoutes(sql));
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
  const pushes = await queued(order.id);
  assert.deepEqual(pushes.map((row) => row.event), ['received', 'confirmed']);
  const push = pushes[1]!;
  const { notificationId, ...data } = push.data as Record<string, string>;
  assert.deepEqual(
    { channel: push.channel, recipient: push.recipient, title: push.title, body: push.body, data },
    { channel: 'push', recipient: TOKEN, title: `Order ${order.number} confirmed`, body: `Vimalnath has confirmed your order ${order.number}.`, data: { orderId: order.phoneOrderId, category: 'orders', channel: 'orders-alert', private: '' } },
  );
  assert.match(notificationId!, /^\d+$/);
  // Packing is the warehouse's step, not news for the customer. The same confirmation again tells nobody twice.
  await send('/v1/admin/orders/status', 'POST', { ids: [order.id], status: 'packed' }, owner);
  assert.equal((await queued(order.id)).length, 2);
  // A phone without a push address (the web app) has it on its Notifications screen, and nothing is sent.
  const quiet = await phoneWithOrder(owner);
  await send('/v1/admin/orders/status', 'POST', { ids: [quiet.id], status: 'dispatched' }, owner);
  assert.equal((await queued(quiet.id)).length, 0);
  assert.deepEqual((await sql`select n.event from notifications n join orders o on o.device_id = n.account_id where o.id = ${quiet.id} order by n.id`).map((row) => row.event), ['received', 'dispatched']);
});

test('the app’s Notifications screen: this account’s updates and the shop’s messages, newest first; opening it clears the bell', { skip }, async () => {
  const owner = await staff('owner');
  const mine = await phoneWithOrder(owner);
  const theirs = await phoneWithOrder(owner);
  const bell = async (auth: Record<string, string>) => ((await (await send('/v1/app/orders', 'GET', undefined, auth)).json()) as { unread: number }).unread;
  type Item = { event: string; title: string; data: Record<string, string>; read: boolean };
  const inbox = async (auth: Record<string, string>) => ((await (await send('/v1/app/notifications', 'GET', undefined, auth)).json()) as { notifications: Item[] }).notifications;
  assert.equal(await bell(mine.auth), 1);

  await send('/v1/admin/orders/status', 'POST', { ids: [mine.id], status: 'confirmed' }, owner);
  await send('/v1/admin/orders/status', 'POST', { ids: [mine.id], status: 'dispatched' }, owner);
  const broadcast = await send('/v1/admin/notifications/broadcast', 'POST', { title: 'Closed on Sunday', body: 'For Diwali.' }, owner);
  assert.equal(((await broadcast.json()) as { users: number }).users > 0, true);
  assert.equal(await bell(mine.auth), 4);
  const items = await inbox(mine.auth);
  assert.deepEqual(
    items.map((item) => [item.event, item.title, item.read]),
    [
      ['broadcast', 'Closed on Sunday', false],
      ['dispatched', `Order ${mine.number} dispatched`, false],
      ['confirmed', `Order ${mine.number} confirmed`, false],
      ['received', `Order ${mine.number} received`, false],
    ],
  );
  assert.deepEqual(items[1]!.data, { orderId: mine.phoneOrderId });
  // Only this account's orders: the other customer sees the shop's message and their own order, not this one.
  assert.deepEqual((await inbox(theirs.auth)).map((item) => item.event), ['broadcast', 'received']);

  // What the app before the Notification Center sends (no body): everything read.
  assert.equal((await send('/v1/app/notifications/read', 'POST', {}, mine.auth)).status, 200);
  assert.equal(await bell(mine.auth), 0);
  assert.deepEqual((await inbox(mine.auth)).map((item) => item.read), [true, true, true, true]);
  assert.equal(await bell(theirs.auth), 2);
  assert.equal((await send('/v1/app/notifications', 'GET', undefined, { Authorization: 'Bearer nope' })).status, 401);
});

test('web push: the web app registers its browser; messages are signed by the shop, readable only by that browser, and carry the icon’s number', { skip }, async () => {
  const owner = await staff('owner');
  const order = await phoneWithOrder(owner);
  const { publicKey } = (await (await send('/v1/app/push-key', 'GET', undefined, order.auth)).json()) as { publicKey: string };
  assert.equal(Buffer.from(publicKey, 'base64url').length, 65);
  assert.equal((await (await send('/v1/app/push-key', 'GET', undefined, order.auth)).json()).publicKey, publicKey, 'the same key every time');

  // The phone's browser: its own key pair and secret, as PushManager.subscribe() makes them.
  const browser = createECDH('prime256v1');
  const keys = { p256dh: browser.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  const endpoint = 'https://fcm.googleapis.com/fcm/send/phone-1';
  for (const fake of ['https://evil.example/fcm.googleapis.com', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x']) {
    assert.equal((await send('/v1/app/push-token', 'POST', { token: { endpoint: fake, keys } }, order.auth)).status, 400, fake);
  }
  assert.equal((await send('/v1/app/push-token', 'POST', { token: { endpoint, keys } }, order.auth)).status, 200);

  await sql`update notification_log set status = 'sent' where status = 'pending'`;
  await send('/v1/admin/orders/status', 'POST', { ids: [order.id], status: 'confirmed' }, owner);
  const posted: { url: string; headers: Headers; body: Buffer }[] = [];
  const answer = { status: 201 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    posted.push({ url, headers: new Headers(init.headers), body: Buffer.from(init.body as Uint8Array) });
    return new Response(null, { status: answer.status });
  }) as typeof fetch;
  try {
    await sendQueued(sql, realSenders({ ADMIN_ORIGIN: ORIGIN }, sql));
    assert.equal(posted.length, 1);
    const [{ url, headers, body }] = posted as [(typeof posted)[0]];
    assert.equal(url, endpoint);
    assert.equal(headers.get('content-encoding'), 'aes128gcm');

    // Signed by the shop: the push service checks this token against the key the browser subscribed with.
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(headers.get('authorization')!)!;
    assert.equal(key, publicKey);
    const [head, claims, signature] = token!.split('.') as [string, string, string];
    const point = Buffer.from(publicKey, 'base64url');
    const shopKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(verify('sha256', Buffer.from(`${head}.${claims}`), { key: shopKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
    const claimed = JSON.parse(Buffer.from(claims, 'base64url').toString());
    assert.deepEqual([claimed.aud, claimed.sub], ['https://fcm.googleapis.com', ORIGIN]);

    // Readable by that browser alone (RFC 8291): decrypted here with its private key.
    const salt = body.subarray(0, 16);
    const ours = body.subarray(21, 21 + body[20]!);
    const ikm = Buffer.from(hkdfSync('sha256', browser.computeSecret(ours), Buffer.from(keys.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(keys.p256dh, 'base64url'), ours]), 32));
    const decipher = createDecipheriv('aes-128-gcm', Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)), Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)));
    const sealed = body.subarray(21 + body[20]!);
    decipher.setAuthTag(sealed.subarray(-16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
    assert.equal(plain.at(-1), 2);
    const payload = JSON.parse(plain.subarray(0, -1).toString());
    assert.deepEqual({ ...payload, data: { ...payload.data, notificationId: 'n' } }, {
      title: `Order ${order.number} confirmed`,
      body: `Vimalnath has confirmed your order ${order.number}.`,
      data: { orderId: order.phoneOrderId, notificationId: 'n', category: 'orders', channel: 'orders-alert', private: '' },
      badge: 2,
    });
    assert.equal((await sql`select status from notification_log where order_id = ${order.id} and channel = 'push'`)[0]!.status, 'sent');

    // The customer turned notifications off: the push service says the address is gone, and the server forgets it.
    answer.status = 410;
    await send('/v1/admin/orders/status', 'POST', { ids: [order.id], status: 'dispatched' }, owner);
    await sendQueued(sql, realSenders({ ADMIN_ORIGIN: ORIGIN }, sql));
    assert.equal(posted.length, 2);
    assert.equal((await sql`select count(*)::int as n from device_tokens where token like ${`%${endpoint}%`}`)[0]!.n, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
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
  assert.equal((await sql`select token from device_tokens where token = 'ExponentPushToken[gone]'`).length, 0);

  await sendQueued(sql, { push });
  await sendQueued(sql, { push });
  assert.deepEqual({ ...(await statusOf(flaky!)) }, { status: 'failed', attempts: 3, error: 'Expo answered 503.' });
  await sendQueued(sql, { push });
  assert.deepEqual(delivered, ['ExponentPushToken[ok]']);
});

test('the Owner edits wording and recipients and broadcasts; others can’t; bad input is refused', { skip }, async () => {
  const owner = await staff('owner');
  assert.equal((await send('/v1/admin/notifications', 'GET', undefined, await staff('sales'))).status, 403);
  const page = (await (await send('/v1/admin/notifications', 'GET', undefined, owner)).json()) as { setup: { email: boolean; fcm: boolean }; templates: { event: string; audience: string; category: string; title: string; body: string }[] };
  assert.deepEqual(page.setup, { email: false, fcm: false });
  assert.deepEqual(page.templates.slice(0, 5).map((template) => template.event), ['placed', 'confirmed', 'dispatched', 'delivered', 'cancelled']);
  assert.ok(page.templates.length > 30);
  assert.deepEqual(page.templates.find((template) => template.event === 'low_stock')!.audience, 'staff');

  const edited = page.templates.map((template) => (template.event === 'dispatched' ? { ...template, title: '{number} is on the way', body: 'Track it with us on WhatsApp.' } : template));
  assert.equal((await send('/v1/admin/notifications/templates', 'PUT', { templates: edited }, owner)).status, 204);
  const order = await phoneWithOrder(owner, 'ExponentPushToken[words]');
  await send('/v1/admin/orders/status', 'POST', { ids: [order.id], status: 'dispatched' }, owner);
  assert.equal((await queued(order.id)).find((row) => row.event === 'dispatched')!.title, `${order.number} is on the way`);

  assert.equal((await send('/v1/admin/notifications/templates', 'PUT', { templates: [{ event: 'placed', title: ' ', body: 'x' }] }, owner)).status, 400);
  assert.equal((await send('/v1/admin/notifications/recipients', 'PUT', { emails: ['not an email'] }, owner)).status, 400);
  assert.equal((await send('/v1/app/push-token', 'POST', { token: 'https://evil.example' }, order.auth)).status, 400);

  // A phone the shop turned off gets nothing, even though it once gave an address.
  await phoneWithOrder(owner, 'ExponentPushToken[blocked]');
  await sql`update app_devices set blocked = true where id = (select account_id from device_tokens where token = 'ExponentPushToken[blocked]')`;
  const devices = Number((await sql`select count(*) from device_tokens t join app_devices d on d.id = t.account_id where not d.blocked`)[0]!.count);
  const users = Number((await sql`select count(*) from app_devices where not blocked`)[0]!.count);
  const broadcast = (await (await send('/v1/admin/notifications/broadcast', 'POST', { title: 'New price list', body: 'The Feb 2027 prices are in the app.' }, owner)).json()) as { queued: number; users: number };
  assert.equal(broadcast.queued, devices);
  assert.equal(broadcast.users, users);
  assert.ok(devices > 0 && users > devices);
});
