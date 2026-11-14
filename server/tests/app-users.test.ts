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

type AppUser = { id: number; name: string; business: string; email: string; blocked: boolean; lastSeenAt: string | null; profileUpdatedAt: string | null; orders: number; views: number };
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

/** A customer the shop has connected, and their phone calling the API with its token. */
async function customer(label = 'Ravi Glass Works') {
  const res = await send('/v1/admin/app-users', 'POST', { label }, await staff('sales'));
  assert.equal(res.status, 201);
  const { appUser, token } = (await res.json()) as { appUser: AppUser; token: string };
  const phone = (path: string, body?: unknown, auth = token) => send(`/v1/app${path}`, body === undefined ? 'GET' : 'POST', body, { Authorization: `Bearer ${auth}` });
  return { id: appUser.id, phone };
}

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

test('block and new token: a blocked phone is refused; a new token replaces the old one for the same customer', { skip }, async () => {
  const owner = await staff('owner');
  const { id, phone } = await customer();
  const blocked = await send(`/v1/admin/app-users/${id}`, 'PATCH', { blocked: true }, owner);
  assert.equal(((await blocked.json()) as AppUser).blocked, true);
  assert.equal((await phone('/orders')).status, 403);
  await send(`/v1/admin/app-users/${id}`, 'PATCH', { blocked: false }, owner);

  const { token } = (await (await send(`/v1/admin/app-users/${id}/token`, 'POST', undefined, owner)).json()) as { token: string };
  assert.equal((await phone('/orders')).status, 401);
  const res = await phone('/orders', undefined, token);
  assert.equal(res.status, 200);
  // The phone checks this ID on every sync, so it must not change with the token.
  assert.equal(((await res.json()) as Orders).customerId, String(id));
});

test('access: only Owners and Sales manage app users', { skip }, async () => {
  assert.equal((await send('/v1/admin/app-users')).status, 401);
  assert.equal((await send('/v1/admin/app-users', 'GET', undefined, await staff('catalogue'))).status, 403);
  assert.equal((await send('/v1/admin/app-users', 'GET', undefined, await staff('sales'))).status, 200);
  assert.equal((await send('/v1/admin/app-users', 'POST', { label: '  ' }, await staff('sales'))).status, 400);
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
