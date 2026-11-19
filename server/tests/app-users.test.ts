import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { appRoutes, appUserAdminRoutes } from '../src/app-users.ts';
import { migrate } from '../src/migrate.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

type AppUser = { id: number; name: string; business: string; phone: string; email: string; blocked: boolean; lastSeenAt: string | null; profileUpdatedAt: string | null; orders: number; views: number };
type Orders = { customerId: string; orders: { id: string; mobileEventId: string; mobileOrderId: string; status: string }[] };

testDatabase('app_users', async (client) => {
  sql = client;
  await migrate(sql);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/app-users', appUserAdminRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

/** A signed-in staff member's cookie header. */
async function staff(role: string) {
  const email = `staff${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Staff ${next}`}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

const PHONE_PASSWORD = 'phone password';

/** A customer who registered in the app, and their phone calling the API with the token it got. */
async function customer(name = 'Ravi Glass Works') {
  const mobile = `98${String(++next).padStart(8, '0')}`;
  const res = await send('/v1/app/register', 'POST', { name, phone: mobile, password: PHONE_PASSWORD });
  assert.equal(res.status, 201);
  const { token, customerId } = (await res.json()) as { token: string; customerId: string };
  const phone = (path: string, body?: unknown, auth = token) => send(`/v1/app${path}`, body === undefined ? 'GET' : 'POST', body, { Authorization: `Bearer ${auth}` });
  return { id: Number(customerId), phone, mobile };
}

const logIn = (phone: string, password: string) => send('/v1/app/login', 'POST', { phone, password });
const reason = async (res: Response) => [res.status, ((await res.json()) as { error: { message: string } }).error.message];

const order = (id: string) => ({
  id,
  number: 'VSC-0001',
  createdAt: '2026-11-10T10:00:00.000Z',
  customer: 'Site A',
  status: 'Placed',
  lines: [{ productId: 'p1', code: 'TGH-55', name: 'Handle', qty: 2, mrp: 450 }],
  total: 900,
});

const appUser = async (id: number) => ((await (await send('/v1/admin/app-users', 'GET', undefined, await staff('owner'))).json()) as AppUser[]).find((user) => user.id === id)!;

test('connect: the token from the admin opens the app routes, and nothing else does', { skip }, async () => {
  const { id, phone } = await customer();
  const res = await phone('/orders');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { customerId: String(id), orders: [] });
  assert.equal((await phone('/orders', undefined, 'not-the-token')).status, 401);
  assert.equal((await send('/v1/app/orders')).status, 401);
});

test('orders: a resent order is stored once, and the phone is told it arrived', { skip }, async () => {
  const { id, phone } = await customer();
  const body = { eventId: 'order:dev1:o1:2026', order: order('o1') };
  assert.equal((await phone('/orders', body)).status, 200);
  assert.equal((await phone('/orders', body)).status, 200);
  const { orders } = (await (await phone('/orders')).json()) as Orders;
  assert.deepEqual(orders.map((sent) => [sent.mobileEventId, sent.mobileOrderId, sent.status]), [['order:dev1:o1:2026', 'o1', 'Placed']]);
  assert.equal((await appUser(id)).orders, 1);
});

test('orders: another customer using the same event ID does not hide or replace this one', { skip }, async () => {
  const first = await customer('First');
  const second = await customer('Second');
  await first.phone('/orders', { eventId: 'same', order: order('a') });
  await second.phone('/orders', { eventId: 'same', order: order('b') });
  assert.equal(((await (await first.phone('/orders')).json()) as Orders).orders[0]!.mobileOrderId, 'a');
  assert.equal(((await (await second.phone('/orders')).json()) as Orders).orders[0]!.mobileOrderId, 'b');
});

test('orders: an order without lines is refused, naming the field', { skip }, async () => {
  const { phone } = await customer();
  const res = await phone('/orders', { eventId: 'empty', order: { ...order('o2'), lines: [] } });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: { field: string } }).error.field, 'order.lines');
});

test('profile and activity: staff see them; long text is cut, not refused, and extra fields are dropped', { skip }, async () => {
  const { id, phone } = await customer();
  const profile = { name: '  Ravi Kumar  ', business: 'x'.repeat(300), phone: '98200 00000' };
  assert.equal((await phone('/profile', { eventId: 'p1', profile })).status, 200);
  const activity = { eventId: 'a1', type: 'price_view', occurredAt: '2026-11-10T10:00:00.000Z', productId: 'p1', price: 450, extra: 'x'.repeat(5000) };
  assert.equal((await phone('/activity', activity)).status, 200);
  assert.equal((await phone('/activity', activity)).status, 200);

  const row = await appUser(id);
  assert.equal(row.name, 'Ravi Kumar');
  assert.equal(row.business.length, 200);
  assert.equal(row.email, '');
  assert.ok(row.profileUpdatedAt && row.lastSeenAt);
  assert.equal(row.views, 1);
  const [stored] = await sql`select body from app_events where device_id = ${id} and kind = 'activity'`;
  assert.deepEqual(stored!.body, { type: 'price_view', occurredAt: activity.occurredAt, productId: 'p1', price: 450 });
});

test('block and new password: a blocked phone is refused; a new password signs the phone out and works for the same customer', { skip }, async () => {
  const owner = await staff('owner');
  const { id, phone, mobile } = await customer();
  const blocked = await send(`/v1/admin/app-users/${id}`, 'PATCH', { blocked: true }, owner);
  assert.equal(((await blocked.json()) as AppUser).blocked, true);
  assert.equal((await phone('/orders')).status, 403);
  assert.deepEqual(await reason(await logIn(mobile, PHONE_PASSWORD)), [403, 'The shop has turned off this account. Please call the shop.']);
  await send(`/v1/admin/app-users/${id}`, 'PATCH', { blocked: false }, owner);

  assert.equal((await send(`/v1/admin/app-users/${id}`, 'PATCH', { password: 'a new password' }, owner)).status, 200);
  assert.equal((await phone('/orders')).status, 401);
  assert.equal((await logIn(mobile, PHONE_PASSWORD)).status, 401);
  const { token } = (await (await logIn(mobile, 'a new password')).json()) as { token: string };
  const res = await phone('/orders', undefined, token);
  assert.equal(res.status, 200);
  // The phone checks this ID on every sync, so it must not change with the token.
  assert.equal(((await res.json()) as Orders).customerId, String(id));
});

test('access: only Owners and Sales manage app users', { skip }, async () => {
  assert.equal((await send('/v1/admin/app-users')).status, 401);
  assert.equal((await send('/v1/admin/app-users', 'GET', undefined, await staff('catalogue'))).status, 403);
  assert.equal((await send('/v1/admin/app-users', 'GET', undefined, await staff('sales'))).status, 200);
  const { id } = await customer();
  assert.deepEqual(await reason(await send(`/v1/admin/app-users/${id}`, 'PATCH', { password: 'short' }, await staff('sales'))), [400, 'Use at least 8 characters.']);
  assert.equal((await send('/v1/admin/app-users/999999', 'PATCH', { blocked: true }, await staff('owner'))).status, 404);
});

test('web version: the browser may call the app routes from another address', { skip }, async () => {
  const res = await app.request('/v1/app/orders', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:8091', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /authorization/);
});

test('register: one account per mobile number, however it is typed; the token opens the app routes', { skip }, async () => {
  const { id, phone, mobile } = await customer('Meera Interiors');
  assert.deepEqual(await (await phone('/orders')).json(), { customerId: String(id), orders: [] });
  const row = await appUser(id);
  assert.deepEqual([row.name, row.phone], ['Meera Interiors', mobile]);

  const again = await send('/v1/app/register', 'POST', { name: 'Someone else', phone: `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`, password: 'another password' });
  assert.deepEqual(await reason(again), [409, 'This mobile number already has an account. Log in instead.']);
  assert.deepEqual(await reason(await send('/v1/app/register', 'POST', { name: 'X', phone: '12345', password: 'long enough' })), [400, 'Enter your 10-digit mobile number.']);
  assert.deepEqual(await reason(await send('/v1/app/register', 'POST', { name: 'X', phone: '9000000001', password: 'short' })), [400, 'Use at least 8 characters.']);
  assert.deepEqual(await reason(await send('/v1/app/register', 'POST', { name: ' ', phone: '9000000001', password: 'long enough' })), [400, 'Enter your name.']);
});

test('login: the right password gives a new token and signs the old one out; 5 wrong tries lock it; unknown numbers get the same answer', { skip }, async () => {
  const { id, phone, mobile } = await customer();
  const res = await logIn(`0${mobile}`, PHONE_PASSWORD);
  assert.equal(res.status, 200);
  const { token, customerId, profile } = (await res.json()) as { token: string; customerId: string; profile: { name: string; phone: string } };
  assert.deepEqual([customerId, profile.name, profile.phone], [String(id), 'Ravi Glass Works', mobile]);
  assert.equal((await phone('/orders')).status, 401);
  assert.equal((await phone('/orders', undefined, token)).status, 200);

  const wrong = 'Wrong mobile number or password. After 5 wrong tries, login is locked for 15 minutes.';
  assert.deepEqual(await reason(await logIn('9111111111', PHONE_PASSWORD)), [401, wrong]);
  for (let attempt = 0; attempt < 5; attempt++) assert.deepEqual(await reason(await logIn(mobile, 'not my password')), [401, wrong]);
  assert.deepEqual(await reason(await logIn(mobile, PHONE_PASSWORD)), [401, wrong]);
});

test('logout: the token stops working and the phone stops getting order updates; logging in again works', { skip }, async () => {
  const { id, phone, mobile } = await customer();
  assert.equal((await phone('/push-token', { token: 'ExponentPushToken[logout]' })).status, 200);
  assert.equal((await phone('/logout', {})).status, 200);
  assert.deepEqual(await reason(await phone('/orders')), [401, 'You were logged out. Log in again.']);
  assert.equal((await sql`select push_token from app_devices where id = ${id}`)[0]!.push_token, null);
  assert.equal((await logIn(mobile, PHONE_PASSWORD)).status, 200);
});

test('photo: the customer adds and replaces their photo; only Owners and Sales see it, never the public', { skip }, async () => {
  const mobile = `97${String(++next).padStart(8, '0')}`;
  const { token, customerId } = (await (await send('/v1/app/register', 'POST', { name: 'Photo Co', phone: mobile, password: PHONE_PASSWORD })).json()) as { token: string; customerId: string };
  const sharp = (await import('sharp')).default;
  const jpeg = (r: number) => sharp({ create: { width: 1200, height: 900, channels: 3, background: { r, g: 120, b: 200 } } }).jpeg().toBuffer();
  const put = (body: Uint8Array | string, type: string, auth = token) =>
    app.request('/v1/app/photo', { method: 'PUT', body, headers: { 'Content-Type': type, Authorization: `Bearer ${auth}`, 'x-forwarded-for': '10.0.0.1' } });

  const owner = await staff('owner');
  assert.equal((await send(`/v1/admin/app-users/${customerId}/photo`, 'GET', undefined, owner)).status, 404);

  assert.equal((await put(await jpeg(10), 'image/jpeg', 'not-a-token')).status, 401);
  assert.equal((await put('hello', 'text/plain')).status, 400);
  assert.equal((await put(new Uint8Array([1, 2, 3]), 'image/jpeg')).status, 400);
  const first = await put(await jpeg(10), 'image/jpeg');
  assert.equal(first.status, 200);

  const listed = ((await (await send('/v1/admin/app-users', 'GET', undefined, owner)).json()) as { id: number; photoAt: string | null }[]).find((user) => user.id === Number(customerId))!;
  assert.ok(listed.photoAt);
  const photo = await send(`/v1/admin/app-users/${customerId}/photo`, 'GET', undefined, owner);
  assert.equal(photo.headers.get('content-type'), 'image/webp');
  const big = await sharp(Buffer.from(await photo.arrayBuffer())).metadata();
  assert.deepEqual([big.format, Math.max(big.width!, big.height!)], ['webp', 800]);
  const small = await sharp(Buffer.from(await (await send(`/v1/admin/app-users/${customerId}/photo?size=small`, 'GET', undefined, owner)).arrayBuffer())).metadata();
  assert.equal(Math.max(small.width!, small.height!), 240);

  // A new photo replaces the old one.
  assert.equal((await put(await jpeg(250), 'image/jpeg')).status, 200);
  assert.equal(Number(((await sql`select count(*) from app_user_photos where device_id = ${Number(customerId)}`)[0] as { count: string }).count), 1);

  assert.equal((await send(`/v1/admin/app-users/${customerId}/photo`, 'GET', undefined, await staff('sales'))).status, 200);
  assert.equal((await send(`/v1/admin/app-users/${customerId}/photo`, 'GET', undefined, await staff('catalogue'))).status, 403);
  assert.equal((await send(`/v1/admin/app-users/${customerId}/photo`)).status, 401);
});
