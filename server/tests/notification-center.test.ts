import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { test } from 'node:test';

import type postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { appRoutes, appUserAdminRoutes } from '../src/app-users.ts';
import { fcmSender, readServiceAccount, TokenGone, type FcmMessage } from '../src/fcm.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { inboxRoutes, notificationRoutes, sendQueued, type Message } from '../src/notifications.ts';
import { notifyCustomer, paymentReminders, prune, runScheduled } from '../src/notify.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { move } from '../src/stock.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const fcmToken = (name: string) => `${name}:${'APA91b'.repeat(25)}`;

testDatabase('notification_center', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  await sql`insert into stock_items (product_id, option_label, hsn, gst_rate, unit, quantity, min_stock, selling_price) values ('p1', 'BM', '8302', 18, 'pcs', 10, 5, 1700)`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/app-users', appUserAdminRoutes(sql));
  admin.route('/orders', orderAdminRoutes(sql));
  admin.route('/notifications', notificationRoutes(sql, { email: false, fcm: true }));
  admin.route('/inbox', inboxRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });
const json = async <T = Record<string, unknown>>(res: Response | Promise<Response>) => (await (await res).json()) as T;

async function staff(role: string) {
  const email = `staff${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Staff ${next}`}, ${email}, ${role}) returning id, name`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { id: row!.id as number, name: row!.name as string, headers: { Cookie: res.headers.get('set-cookie')!.split(';')[0]! } };
}

/** A customer account: registered on one phone; `phone()` logs in on another. */
async function account() {
  const mobile = `95${String(++next).padStart(8, '0')}`;
  const { token, customerId } = await json<{ token: string; customerId: string }>(send('/v1/app/register', 'POST', { name: `Customer ${next}`, phone: mobile, password: 'phone password' }));
  const phone = async () => ({ Authorization: `Bearer ${(await json<{ token: string }>(send('/v1/app/login', 'POST', { phone: mobile, password: 'phone password' }))).token}` });
  return { id: Number(customerId), auth: { Authorization: `Bearer ${token}` }, phone };
}

async function placeOrder(auth: Record<string, string>) {
  const order = { id: `order-${++next}`, createdAt: new Date().toISOString(), customer: 'Site B', phone: '', notes: '', lines: [{ productId: 'p1', code: 'TGH-55', name: 'Handle', option: 'SSS', qty: 2, mrp: 1500 }] };
  assert.equal((await send('/v1/app/orders', 'POST', { eventId: `event-${next}`, order }, auth)).status, 200);
  const [row] = await sql`select id, number from orders where client_order_id = ${order.id}`;
  return { id: row!.id as number, number: row!.number as string, clientId: order.id };
}

type Item = { id: string; event: string; category: string; title: string; body: string; read: boolean; data: Record<string, string> };
type Page = { notifications: Item[]; next: string | null; unread: number };
const appInbox = (auth: Record<string, string>, query = '') => json<Page>(send(`/v1/app/notifications${query}`, 'GET', undefined, auth));
const staffInbox = (headers: Record<string, string>, query = '') => json<Page>(send(`/v1/admin/inbox${query}`, 'GET', undefined, headers));

test('FCM: the server signs in as the Firebase service account, sends to one phone with its channel, count and privacy, and forgets a dropped token', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { project_id: 'vimalnath-test', client_email: 'push@vimalnath-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
  assert.deepEqual(readServiceAccount(JSON.stringify(key)), key);
  assert.deepEqual(readServiceAccount(Buffer.from(JSON.stringify(key)).toString('base64')), key, 'base64 of the JSON works too');
  assert.throws(() => readServiceAccount('{"project_id":"x"}'), /not a Firebase service account key/);

  const calls: { url: string; init: RequestInit }[] = [];
  let answer: { status: number; body: unknown } = { status: 200, body: {} };
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
    return Response.json(answer.body, { status: answer.status });
  }) as typeof fetch;
  const fcm = fcmSender(key, fake);
  const message: FcmMessage = { token: fcmToken('phone'), title: 'Payment received', body: '₹1,000 for VSC-0001.', data: { notificationId: '12', category: 'payments', channel: 'payments-alert', private: '1', orderId: 'order-9' }, badge: 3 };
  await fcm(message);
  await fcm({ ...message, data: { ...message.data, notificationId: '13' } });

  // One access token for both: a JWT signed with the service account's key, for FCM's scope.
  assert.deepEqual(calls.map((call) => call.url), ['https://oauth2.googleapis.com/token', 'https://fcm.googleapis.com/v1/projects/vimalnath-test/messages:send', 'https://fcm.googleapis.com/v1/projects/vimalnath-test/messages:send']);
  const jwt = new URLSearchParams(calls[0]!.init.body as string).get('assertion')!;
  const [head, claims, signature] = jwt.split('.') as [string, string, string];
  assert.ok(verify('sha256', Buffer.from(`${head}.${claims}`), publicKey, Buffer.from(signature, 'base64url')));
  const claimed = JSON.parse(Buffer.from(claims, 'base64url').toString()) as Record<string, string>;
  assert.deepEqual([claimed.iss, claimed.scope, claimed.aud], [key.client_email, 'https://www.googleapis.com/auth/firebase.messaging', 'https://oauth2.googleapis.com/token']);

  const sent = calls[1]!;
  assert.equal(new Headers(sent.init.headers).get('authorization'), 'Bearer ya29.test');
  const body = JSON.parse(sent.init.body as string) as { message: { token: string; notification: unknown; data: Record<string, string>; android: { priority: string; notification: Record<string, unknown> } } };
  assert.deepEqual(body.message.notification, { title: 'Payment received', body: '₹1,000 for VSC-0001.' });
  assert.deepEqual(body.message.data, { notificationId: '12', category: 'payments', channel: 'payments-alert', private: '1', orderId: 'order-9', badge: '3' });
  // A payment on a locked phone shows only "Contents hidden"; one tag per notification, so a resend doesn't show twice.
  assert.deepEqual(body.message.android, { priority: 'HIGH', notification: { channel_id: 'payments-alert', notification_count: 3, visibility: 'PRIVATE', tag: 'n12', default_sound: true } });

  answer = { status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } };
  await assert.rejects(fcm(message), TokenGone);
  answer = { status: 503, body: { error: { status: 'UNAVAILABLE' } } };
  await assert.rejects(fcm(message), /FCM answered 503/);
});

test('several phones, one account: each phone gets the push, on the channel its sound choices pick; a category turned off is listed already read', { skip }, async () => {
  const owner = await staff('owner');
  const customer = await account();
  const second = await customer.phone();
  assert.equal((await send('/v1/app/push-token', 'POST', { token: fcmToken('first') }, customer.auth)).status, 200);
  assert.equal((await send('/v1/app/push-token', 'POST', { token: 'ExponentPushToken[second]' }, second)).status, 200);
  // A new token from the same phone replaces its old one.
  assert.equal((await send('/v1/app/push-token', 'POST', { token: fcmToken('first-refreshed') }, customer.auth)).status, 200);
  assert.deepEqual((await sql`select token from device_tokens where account_id = ${customer.id} order by id`).map((row) => row.token), ['ExponentPushToken[second]', fcmToken('first-refreshed')]);

  const prefs = await json<Record<string, boolean>>(send('/v1/app/notifications/preferences', 'PUT', { payments_enabled: false, sound_enabled: false }, customer.auth));
  assert.deepEqual([prefs.payments_enabled, prefs.sound_enabled, prefs.orders_enabled, prefs.vibration_enabled], [false, false, true, true]);
  assert.equal((await send('/v1/app/notifications/preferences', 'PUT', { nonsense: true }, customer.auth)).status, 400);

  const order = await placeOrder(customer.auth);
  const pushes = await sql`select recipient, data->>'channel' as channel from notification_log where order_id = ${order.id} and channel = 'push' order by recipient`;
  assert.deepEqual(pushes.map((row) => [row.recipient, row.channel]), [['ExponentPushToken[second]', 'orders-vibrate'], [fcmToken('first-refreshed'), 'orders-vibrate']]);

  // Payments are off: the customer can still read it, but no phone buzzes and the badge doesn't count it.
  assert.equal((await send('/v1/admin/orders/payments', 'POST', { payments: [{ orderId: order.id, amount: 1000, method: 'upi', paidOn: today }] }, owner.headers)).status, 201);
  const [paid] = await sql`select id, title, message, is_read from notifications where account_id = ${customer.id} and event = 'payment_received'`;
  assert.deepEqual([paid!.title, paid!.message, paid!.is_read], ['Payment received', `Thank you! We’ve received ₹1,000 for ${order.number}. ₹2,000 is still to pay.`, true]);
  assert.equal((await sql`select count(*)::int as n from notification_log where notification_id = ${paid!.id}`)[0]!.n, 0);
  assert.equal((await appInbox(second)).unread, 1, 'the same count on both phones: only "received" is unread');

  // An event raised twice (a retry) notifies once.
  for (let time = 0; time < 2; time++) await notifyCustomer(sql, customer.id, 'confirmed', { number: order.number }, {}, `confirmed:${order.id}:retry`);
  assert.equal((await sql`select count(*)::int as n from notifications where account_id = ${customer.id} and event_key = ${`confirmed:${order.id}:retry`}`)[0]!.n, 1);

  // The badge each push carries is the account's unread count when it goes out.
  const badges: number[] = [];
  await sendQueued(sql, { push: async (message: Message) => void badges.push(message.badge), fcm: async (message: Message) => void badges.push(message.badge) });
  assert.ok(badges.length >= 2 && badges.every((badge) => badge === 2));
});

test('the Notification Center: pages, unread and read, a category, search; one read, all read, delete; never another account’s', { skip }, async () => {
  const customer = await account();
  const other = await account();
  for (const [event, values] of [
    ['confirmed', { number: 'VSC-0101' }],
    ['payment_due', { number: 'VSC-0101', amount: '₹2,000', due: '30 Nov' }],
    ['invoice_created', { number: 'VSC-26-27-500', total: '₹4,720' }],
    ['return_approved', { kind: 'Return', number: 'RET-0009' }],
    ['dispatched', { number: 'VSC-0102' }],
  ] as const)
    await notifyCustomer(sql, customer.id, event, values);
  const mine = await notifyCustomer(sql, other.id, 'confirmed', { number: 'VSC-0900' });

  const first = await appInbox(customer.auth, '?limit=2');
  assert.deepEqual(first.notifications.map((item) => item.event), ['dispatched', 'return_approved']);
  assert.equal(first.unread, 5);
  const second = await appInbox(customer.auth, `?limit=2&before=${first.next}`);
  assert.deepEqual(second.notifications.map((item) => item.event), ['invoice_created', 'payment_due']);
  assert.deepEqual((await appInbox(customer.auth, '?category=payments')).notifications.map((item) => item.title), ['Payment due 30 Nov']);
  assert.deepEqual((await appInbox(customer.auth, '?q=RET-0009')).notifications.map((item) => item.event), ['return_approved']);

  const dispatched = first.notifications[0]!.id;
  assert.deepEqual(await json(send('/v1/app/notifications/read', 'POST', { ids: [Number(dispatched), mine!] }, customer.auth)), { unread: 4 });
  assert.equal((await sql`select is_read from notifications where id = ${mine!}`)[0]!.is_read, false, 'another account’s notification is untouched');
  assert.deepEqual((await appInbox(customer.auth, '?filter=read')).notifications.map((item) => item.event), ['dispatched']);
  assert.equal((await appInbox(customer.auth, '?filter=unread')).notifications.length, 4);

  const removed = await json<{ removed: number; unread: number }>(send('/v1/app/notifications/delete', 'POST', { ids: [Number(second.notifications[0]!.id), mine!] }, customer.auth));
  assert.deepEqual(removed, { removed: 1, unread: 3 });
  assert.equal((await appInbox(customer.auth)).notifications.length, 4);
  assert.deepEqual(await json(send('/v1/app/notifications/read-all', 'POST', {}, customer.auth)), { unread: 0 });
  assert.deepEqual(await json(send('/v1/app/notifications/unread', 'GET', undefined, customer.auth)), { unread: 0 });
  assert.equal((await appInbox(other.auth)).unread, 1);
  assert.equal((await send('/v1/app/notifications', 'GET')).status, 401);
});

test('staff: a new order reaches the office (not the warehouse or the books); a payment reaches the Owner and Accountant, not whoever entered it', { skip }, async () => {
  const [owner, sales, inventory, accountant] = [await staff('owner'), await staff('sales'), await staff('inventory'), await staff('accountant')];
  const customer = await account();
  const order = await placeOrder(customer.auth);
  const placed = async (who: { headers: Record<string, string> }) => (await staffInbox(who.headers, '?category=orders')).notifications.filter((item) => item.event === 'placed').map((item) => item.title);
  assert.deepEqual(await placed(owner), [`New order ${order.number} from Site B`]);
  assert.deepEqual(await placed(sales), [`New order ${order.number} from Site B`]);
  assert.deepEqual(await placed(inventory), []);
  assert.deepEqual(await placed(accountant), []);
  assert.deepEqual((await staffInbox(sales.headers, '?category=orders')).notifications[0]!.data, { to: `/orders/${order.id}` });

  assert.equal((await send('/v1/admin/orders/payments', 'POST', { payments: [{ orderId: order.id, amount: 500, method: 'cash', paidOn: today }] }, accountant.headers)).status, 201);
  const payment = async (who: { headers: Record<string, string> }) => (await staffInbox(who.headers, '?category=payments')).notifications.map((item) => item.body);
  assert.deepEqual(await payment(owner), [`${accountant.name} recorded ₹500 from Site B for ${order.number}.`]);
  assert.deepEqual(await payment(accountant), [], 'not the person who recorded it');
  assert.deepEqual(await payment(sales), []);

  // Their own center: the count, all read, and choices.
  const count = await json<{ unread: number }>(send('/v1/admin/inbox/count', 'GET', undefined, owner.headers));
  assert.ok(count.unread >= 2);
  assert.deepEqual(await json(send('/v1/admin/inbox/read-all', 'POST', {}, owner.headers)), { unread: 0 });
  assert.equal((await json<Record<string, boolean>>(send('/v1/admin/inbox/preferences', 'PUT', { inventory_enabled: false }, inventory.headers))).inventory_enabled, false);
});

test('stock: running low and running out alert the warehouse once each; a hand count tells the Owner', { skip }, async () => {
  const [owner, sales, inventory] = [await staff('owner'), await staff('sales'), await staff('inventory')];
  await sql`update notification_preferences set inventory_enabled = true where staff_id = ${inventory.id}`;
  const item = { productId: 'p1', option: 'BM' };
  const step = (change: number, kind = 'delivered', by = 'System') => sql.begin((tx) => move(tx, item, change, { kind, by }));
  await step(-4); // 10 → 6: still above the minimum of 5
  await step(-2); // → 4: low
  await step(-1); // → 3: still low, no new alert
  await step(-3); // → 0: out
  const alerts = async (who: { headers: Record<string, string> }) => (await staffInbox(who.headers, '?category=inventory')).notifications.map((entry) => [entry.event, entry.body]);
  assert.deepEqual(await alerts(inventory), [
    ['out_of_stock', 'TGH-55 · BM is out of stock (0 pcs).'],
    ['low_stock', 'TGH-55 · BM is down to 4 pcs (minimum 5 pcs).'],
  ]);
  assert.deepEqual((await alerts(sales)).map(([event]) => event), ['out_of_stock']);
  await step(8, 'count', inventory.name);
  assert.deepEqual((await alerts(owner))[0], ['stock_updated', `${inventory.name} changed TGH-55 · BM by +8: now 8 pcs.`]);
  assert.equal((await alerts(inventory)).filter(([event]) => event === 'stock_updated').length, 0);
});

test('announcements: to chosen customers or to staff roles; system alerts come even when announcements are off; the history counts who read it', { skip }, async () => {
  const owner = await staff('owner');
  const sales = await staff('sales');
  const inventory = await staff('inventory');
  const [chosen, quiet, other] = [await account(), await account(), await account()];
  await send('/v1/app/push-token', 'POST', { token: fcmToken(`chosen-${chosen.id}`) }, chosen.auth);
  await send('/v1/app/notifications/preferences', 'PUT', { announcements_enabled: false }, quiet.auth);

  const offer = await json<{ id: number; users: number; queued: number }>(
    send('/v1/admin/notifications/announce', 'POST', { audience: 'customers', accountIds: [chosen.id, quiet.id], category: 'announcements', title: 'Diwali offer', body: '10% off fittings this week.' }, owner.headers),
  );
  assert.deepEqual([offer.users, offer.queued], [2, 1]);
  assert.equal((await appInbox(other.auth)).notifications.length, 0);
  assert.deepEqual((await appInbox(quiet.auth)).notifications.map((item) => [item.title, item.read]), [['Diwali offer', true]]);

  await send('/v1/admin/notifications/announce', 'POST', { audience: 'customers', accountIds: [quiet.id], category: 'system', title: 'App update', body: 'Please update the app.' }, owner.headers);
  assert.equal((await appInbox(quiet.auth)).unread, 1, 'a system alert comes through');

  const meeting = await json<{ users: number }>(send('/v1/admin/notifications/announce', 'POST', { audience: 'staff', roles: ['inventory'], category: 'announcements', title: 'Stock count Sunday', body: 'Be in by 9.' }, owner.headers));
  assert.ok(meeting.users >= 1);
  assert.deepEqual((await staffInbox(inventory.headers, '?category=announcements')).notifications.map((item) => item.title), ['Stock count Sunday']);
  assert.equal((await staffInbox(sales.headers, '?category=announcements')).notifications.length, 0);

  await send('/v1/app/notifications/read-all', 'POST', {}, chosen.auth);
  const history = await json<{ id: number; recipients: number; read: number; pushes: { pending: number } }[]>(send('/v1/admin/notifications/announcements', 'GET', undefined, owner.headers));
  const sent = history.find((row) => row.id === offer.id)!;
  assert.deepEqual([sent.recipients, sent.read, sent.pushes.pending], [2, 2, 1]);

  assert.equal((await send('/v1/admin/notifications/announce', 'POST', { audience: 'staff', accountIds: [chosen.id], title: 'x', body: 'y' }, owner.headers)).status, 400);
  assert.equal((await send('/v1/admin/notifications/announce', 'POST', { audience: 'customers', title: 'x', body: 'y' }, sales.headers)).status, 403);
});

test('payment reminders: the office gets a daily summary; customers hear only once the Owner turns reminders on, once per bill and step; old notifications are cleared', { skip }, async () => {
  const owner = await staff('owner');
  const accountant = await staff('accountant');
  const late = await account();
  const soon = await account();
  const deliver = async (auth: Record<string, string>, daysAgo: number) => {
    const order = await placeOrder(auth);
    await sql`update orders set status = 'delivered' where id = ${order.id}`;
    await sql`insert into order_events (order_id, status, at, by) values (${order.id}, 'delivered', now() - ${`${daysAgo} days`}::interval, 'Asha')`;
    return order;
  };
  const overdue = await deliver(late.auth, 40); // credit 30 days: 10 days late
  await deliver(soon.auth, 29); // due tomorrow
  const reminders = async (customer: { auth: Record<string, string> }) => (await appInbox(customer.auth, '?category=payments')).notifications.map((item) => item.title);

  await paymentReminders(sql, today);
  assert.deepEqual(await reminders(late), [], 'customer reminders start off');
  const summary = (await staffInbox(accountant.headers, '?category=payments')).notifications.filter((item) => item.event === 'payments_overdue');
  assert.equal(summary.length, 1);
  assert.match(summary[0]!.body, /past their due day/);

  const settings = await json<{ paymentReminders: boolean }>(send('/v1/admin/notifications/settings', 'PUT', { paymentReminders: true, remindDaysBefore: 2, overdueEveryDays: 7 }, owner.headers));
  assert.equal(settings.paymentReminders, true);
  await paymentReminders(sql, today);
  await paymentReminders(sql, today);
  assert.deepEqual(await reminders(late), [`Payment overdue: ${overdue.number}`]);
  assert.equal((await reminders(soon)).length, 1);
  assert.match((await reminders(soon))[0]!, /^Payment due /);
  assert.equal((await staffInbox(accountant.headers, '?category=payments')).notifications.filter((item) => item.event === 'payments_overdue').length, 1, 'one summary a day');

  // Scheduled: each job runs at its own pace, however often it's asked.
  await sql`update scheduled_runs set last_run_at = now()`;
  await runScheduled(sql);
  assert.equal((await sql`select count(*)::int as n from scheduled_runs where last_run_at > now() - interval '1 minute'`)[0]!.n, 2);

  // Retention: read ones after 180 days, any after a year, deleted ones after 30 days.
  const old = async (daysAgo: number, read: boolean, deletedDaysAgo?: number) =>
    (await sql`insert into notifications (account_id, event, category, title, message, is_read, created_at, deleted_at)
      values (${late.id}, 'test', 'orders', 'Old', 'Old', ${read}, now() - ${`${daysAgo} days`}::interval, ${deletedDaysAgo === undefined ? null : sql`now() - ${`${deletedDaysAgo} days`}::interval`}) returning id`)[0]!.id as string;
  const [readOld, unreadOld, yearOld, deletedOld, keep] = [await old(200, true), await old(200, false), await old(400, false), await old(40, true, 35), await old(10, true)];
  await prune(sql);
  const left = (await sql`select id from notifications where id in ${sql([readOld, unreadOld, yearOld, deletedOld, keep])} order by id`).map((row) => Number(row.id));
  assert.deepEqual(left, [Number(unreadOld), Number(keep)]);
});
