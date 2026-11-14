import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Order } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { appRoutes } from '../src/app-users.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { adminRoutes, issuePasswordLink, sha256 } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

type AppOrders = { customerId: string; orders: { number: string; status: string; mobileOrderId: string; mobileEventId: string; history: { status: string }[] }[] };
type Line = { productId: string; code: string; name: string; option?: string; qty: number; mrp?: number };

testDatabase('orders', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  // A product priced from its catalogue page: no options.
  await sql`insert into products (id, code, name, section, category_id, catalogue_source, catalogue_page, sort_order) values ('p3', 'TGH-99', 'Lock', 'Locks', 'glass', 'master', 12, 3)`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/orders', orderAdminRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

async function staff(role: string) {
  const email = `staff${++next}@example.com`;
  const name = `Staff ${next}`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${name}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { name, headers: { Cookie: res.headers.get('set-cookie')!.split(';')[0]! } };
}

/** A connected phone, placing orders the way the app's sync sends them. */
async function phone(label = 'Ravi Glass Works') {
  const token = `token-${++next}`;
  await sql`insert into app_devices (label, token_hash) values (${label}, ${sha256(token)})`;
  const auth = { Authorization: `Bearer ${token}` };
  let made = 0;
  return {
    place: (lines: Line[], extra: Record<string, unknown> = {}, eventId = `order:${token}:${made + 1}`) => {
      made += 1;
      const order = { id: `local-${made}`, number: 'VSC-0001', createdAt: new Date().toISOString(), customer: 'Site A', status: 'Placed', lines, total: 1, ...extra };
      return send('/v1/app/orders', 'POST', { eventId, order }, auth);
    },
    orders: async () => (await (await send('/v1/app/orders', 'GET', undefined, auth)).json()) as AppOrders,
  };
}

const adminOrders = async (headers: Record<string, string>) => (await (await send('/v1/admin/orders', 'GET', undefined, headers)).json()) as Order[];
const ofDevice = async (label: string) => (await adminOrders((await staff('sales')).headers)).filter((order) => order.appUser?.label === label);
const lock = (qty = 1): Line[] => [{ productId: 'p3', code: 'TGH-99', name: 'Lock', qty }];

test('place: the server numbers the order and uses its own prices, not the phone’s', { skip }, async () => {
  const ravi = await phone();
  const res = await ravi.place([
    { productId: 'p1', code: 'TGH-55', name: 'H Type Handle', option: 'SSS', qty: 2, mrp: 1 },
    { productId: 'p2', code: 'TGH-55', name: 'Partition Hardware', option: 'SSS', qty: 1, mrp: 1500 },
  ]);
  assert.equal(res.status, 200);
  const { orders } = await ravi.orders();
  assert.deepEqual(
    orders.map((order) => [order.number, order.status, order.mobileOrderId, order.history.map((step) => step.status)]),
    [['VSC-0001', 'Placed', 'local-1', ['Placed']]],
  );

  const [order] = await ofDevice('Ravi Glass Works');
  assert.equal(order!.total, 4500);
  assert.deepEqual(order!.lines.map((line) => [line.mrp, line.optionCode, line.problem]), [
    [1500, 'TGH-55-S', 'The app showed ₹1'],
    [1500, undefined, undefined],
  ]);
});

test('place: lines that no longer match the catalogue are kept and flagged, never refused', { skip }, async () => {
  await sql`update products set visible = false where id = 'p2'`;
  const anil = await phone('Anil Traders');
  const res = await anil.place([
    { productId: 'gone', code: 'OLD-1', name: 'Old Handle', qty: 1, mrp: 900 },
    { productId: 'p1', code: 'TGH-55', name: 'H Type Handle', option: 'Gold', qty: 1, mrp: 900 },
    { productId: 'p1', code: 'TGH-55', name: 'H Type Handle', qty: 1 },
    { productId: 'p2', code: 'TGH-55', name: 'Partition Hardware', option: 'SSS', qty: 3, mrp: 1500 },
    ...lock(4),
  ]);
  await sql`update products set visible = true where id = 'p2'`;
  assert.equal(res.status, 200);

  const [order] = await ofDevice('Anil Traders');
  assert.deepEqual(order!.lines.map((line) => [line.code, line.mrp, line.problem]), [
    ['OLD-1', undefined, 'No longer in the catalogue'],
    ['TGH-55', undefined, '“Gold” is no longer offered'],
    ['TGH-55', undefined, 'No option was chosen'],
    ['TGH-55', 1500, 'Hidden from the Shop'],
    ['TGH-99', undefined, undefined],
  ]);
  assert.equal(order!.total, 4500);
});

test('resend: an order sent again, even five times at once, is saved once', { skip }, async () => {
  const ravi = await phone('Resend Co');
  const statuses = await Promise.all(Array.from({ length: 5 }, () => ravi.place(lock(), {}, 'order:same')));
  assert.deepEqual(statuses.map((res) => res.status), [200, 200, 200, 200, 200]);
  assert.equal((await ravi.place(lock(), {}, 'order:same')).status, 200);
  assert.equal((await ravi.orders()).orders.length, 1);
});

test('numbers: never shared when orders arrive together, and they keep growing past VSC-9999', { skip }, async () => {
  const phones = await Promise.all(Array.from({ length: 10 }, (_, index) => phone(`Shop ${index}`)));
  await Promise.all(phones.map((each) => each.place(lock())));
  const numbers = await sql`select number from orders`;
  assert.equal(new Set(numbers.map((row) => row.number)).size, numbers.length);

  await sql`select setval('order_numbers', 9999)`;
  const big = await phone('Big Order Co');
  await big.place(lock());
  assert.equal((await big.orders()).orders[0]!.number, 'VSC-10000');
});

test('placed time: when the customer placed it offline; a time in the future is not trusted', { skip }, async () => {
  const late = await phone('Late Sync Co');
  await late.place(lock(), { createdAt: '2026-10-01T09:30:00.000Z' });
  await late.place(lock(), { createdAt: '2099-01-01T00:00:00.000Z' });
  const [future, offline] = await ofDevice('Late Sync Co');
  assert.equal(new Date(offline!.createdAt).toISOString(), '2026-10-01T09:30:00.000Z');
  assert.ok(Math.abs(new Date(future!.createdAt).getTime() - Date.now()) < 60_000);
});

test('status: each change records who made it, the phone sees it, and undo is a recorded change back', { skip }, async () => {
  const ravi = await phone('Status Co');
  await ravi.place(lock());
  await ravi.place(lock(2));
  const desk = await staff('sales');
  const ids = (await ofDevice('Status Co')).map((order) => order.id);

  const confirmed = (await (await send('/v1/admin/orders/status', 'POST', { ids, status: 'confirmed' }, desk.headers)).json()) as { orders: Order[] };
  assert.deepEqual(confirmed.orders.map((order) => order.status), ['confirmed', 'confirmed']);
  assert.deepEqual(confirmed.orders[0]!.history.map((step) => [step.status, step.by]), [['placed', 'App'], ['confirmed', desk.name]]);

  await send('/v1/admin/orders/status', 'POST', { ids: [ids[1]], status: 'cancelled' }, desk.headers);
  const undone = (await (await send('/v1/admin/orders/status', 'POST', { ids: [ids[1]], status: 'confirmed' }, desk.headers)).json()) as { orders: Order[] };
  assert.deepEqual(undone.orders[0]!.history.map((step) => step.status), ['placed', 'confirmed', 'cancelled', 'confirmed']);
  // Setting the status it already has records nothing.
  const same = (await (await send('/v1/admin/orders/status', 'POST', { ids: [ids[1]], status: 'confirmed' }, desk.headers)).json()) as { orders: Order[] };
  assert.equal(same.orders[0]!.history.length, 4);

  const seen = (await ravi.orders()).orders.find((order) => order.mobileOrderId === 'local-1')!;
  assert.equal(seen.status, 'Confirmed');
  assert.deepEqual(seen.history.map((step) => step.status), ['Placed', 'Confirmed', 'Cancelled', 'Confirmed']);
});

test('internal note: saved for staff, removed when emptied, never sent to the phone', { skip }, async () => {
  const ravi = await phone('Note Co');
  await ravi.place(lock());
  const desk = await staff('sales');
  const [order] = await ofDevice('Note Co');
  const note = 'Quoted ₹2,400 for the lock';
  const saved = (await (await send(`/v1/admin/orders/${order!.id}/internal-note`, 'PUT', { text: note }, desk.headers)).json()) as { orders: Order[] };
  assert.deepEqual([saved.orders[0]!.internalNote?.text, saved.orders[0]!.internalNote?.by], [note, desk.name]);
  assert.doesNotMatch(JSON.stringify(await ravi.orders()), /Quoted/);
  const cleared = (await (await send(`/v1/admin/orders/${order!.id}/internal-note`, 'PUT', { text: '  ' }, desk.headers)).json()) as { orders: Order[] };
  assert.equal(cleared.orders[0]!.internalNote, undefined);
  assert.equal((await send('/v1/admin/orders/999999/internal-note', 'PUT', { text: 'x' }, desk.headers)).status, 404);
});

test('access: Owners and Sales work on orders; Catalogue editors and signed-out people cannot', { skip }, async () => {
  assert.equal((await send('/v1/admin/orders')).status, 401);
  assert.equal((await send('/v1/admin/orders', 'GET', undefined, (await staff('catalogue')).headers)).status, 403);
  assert.equal((await send('/v1/admin/orders', 'GET', undefined, (await staff('owner')).headers)).status, 200);
  assert.equal((await send('/v1/admin/orders/status', 'POST', { ids: [1], status: 'shipped' }, (await staff('sales')).headers)).status, 400);
});
