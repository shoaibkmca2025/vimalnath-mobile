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

testDatabase('payments', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
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

/** A new customer's order from their app: 2 × ₹1,500, so ₹3,000 at MRP. */
async function order(label: string, headers: Record<string, string>) {
  const token = `token-${++next}`;
  await sql`with customer as (insert into customers (name) values (${label}) returning id) insert into app_devices (label, token_hash, customer_id) select ${label}, ${sha256(token)}, id from customer`;
  const lines = [{ productId: 'p2', code: 'TGH-55', name: 'Partition Hardware', option: 'SSS', qty: 2, mrp: 1500 }];
  await send('/v1/app/orders', 'POST', { eventId: `order:${token}`, order: { id: 'local-1', createdAt: new Date().toISOString(), customer: label, lines } }, { Authorization: `Bearer ${token}` });
  const orders = (await (await send('/v1/admin/orders', 'GET', undefined, headers)).json()) as Order[];
  return orders.find((item) => item.appUser?.label === label)!;
}

const today = new Date().toISOString().slice(0, 10);
const pay = (headers: Record<string, string>, payments: Record<string, unknown>[]) =>
  send('/v1/admin/orders/payments', 'POST', { payments: payments.map((payment) => ({ method: 'cash', paidOn: today, ...payment })) }, headers);
const answer = async (res: Response) => (await res.json()) as { orders: Order[]; error: { message: string; field?: string } };

test('payments: recorded against an order with who took them, never past its bill, and removable', { skip }, async () => {
  const accountant = await staff('accountant');
  const placed = await order('Pay Co', accountant.headers);
  assert.equal(placed.total, 3000);
  assert.equal(placed.terms, 'credit');
  assert.equal(placed.bill, undefined);
  assert.equal(placed.payments, undefined);

  const first = await pay(accountant.headers, [{ orderId: Number(placed.id), amount: 1000, method: 'upi', note: ' UTR 4471 ' }]);
  assert.equal(first.status, 201);
  const [paid] = (await answer(first)).orders;
  assert.deepEqual(
    paid!.payments!.map(({ amount, method, paidOn, note, by }) => ({ amount, method, paidOn, note, by })),
    [{ amount: 1000, method: 'upi', paidOn: today, note: 'UTR 4471', by: accountant.name }],
  );

  const over = await pay(accountant.headers, [{ orderId: Number(placed.id), amount: 2500 }]);
  assert.equal(over.status, 400);
  assert.deepEqual((await answer(over)).error, { message: `That is more than ${placed.number} still owes (₹2,000).`, field: 'payments.0.amount' });

  // Two payments that together pass the bill: neither is saved.
  const together = await pay(accountant.headers, [{ orderId: Number(placed.id), amount: 1500 }, { orderId: Number(placed.id), amount: 600 }]);
  assert.equal((await answer(together)).error.field, 'payments.1.amount');
  const [saved] = await sql`select count(*)::int as count from order_payments where order_id = ${placed.id}`;
  assert.equal(saved!.count, 1);

  const removed = await send(`/v1/admin/orders/payments/${paid!.payments![0]!.id}`, 'DELETE', undefined, accountant.headers);
  assert.equal(removed.status, 200);
  assert.equal((await answer(removed)).orders[0]!.payments, undefined);
  assert.equal((await send(`/v1/admin/orders/payments/${paid!.payments![0]!.id}`, 'DELETE', undefined, accountant.headers)).status, 404);
});

test('payments: one cheque split across two bills is saved in one go', { skip }, async () => {
  const owner = await staff('owner');
  const a = await order('Split Co A', owner.headers);
  const b = await order('Split Co B', owner.headers);
  const res = await pay(owner.headers, [
    { orderId: Number(a.id), amount: 3000, method: 'cheque' },
    { orderId: Number(b.id), amount: 500, method: 'cheque' },
  ]);
  assert.equal(res.status, 201);
  const orders = (await answer(res)).orders;
  assert.deepEqual(orders.map((item) => [item.id, item.payments?.map((payment) => payment.amount)]).sort(), [[a.id, [3000]], [b.id, [500]]].sort());
});

test('billing: cash or credit, and a discounted bill that can’t go below what’s been paid', { skip }, async () => {
  const accountant = await staff('accountant');
  const placed = await order('Bill Co', accountant.headers);
  const billing = (body: unknown) => send(`/v1/admin/orders/${placed.id}/billing`, 'PUT', body, accountant.headers);

  const discounted = await billing({ terms: 'cash', bill: 2800 });
  assert.equal(discounted.status, 200);
  const [saved] = (await answer(discounted)).orders;
  assert.deepEqual([saved!.terms, saved!.bill, saved!.total], ['cash', 2800, 3000]);

  await pay(accountant.headers, [{ orderId: Number(placed.id), amount: 2000 }]);
  const below = await billing({ terms: 'cash', bill: 1500 });
  assert.equal(below.status, 400);
  assert.deepEqual((await answer(below)).error, { message: '₹2,000 has been paid already, so the bill can’t be less. Remove a payment first.', field: 'bill' });

  // The MRP total again means "the MRP total", so the order shows no edited bill.
  const back = (await answer(await billing({ terms: 'credit', bill: 3000 }))).orders[0]!;
  assert.deepEqual([back.terms, back.bill], ['credit', undefined]);
  assert.equal((await billing({ terms: 'later', bill: null })).status, 400);
});

test('payments: none on cancelled orders or unset bills, and no days in the future', { skip }, async () => {
  const accountant = await staff('accountant');
  const placed = await order('Refuse Co', accountant.headers);
  const orderId = Number(placed.id);

  const future = await pay(accountant.headers, [{ orderId, amount: 100, paidOn: '2099-01-01' }]);
  assert.deepEqual((await answer(future)).error, { message: 'The day can’t be in the future.', field: 'payments.0.paidOn' });
  assert.equal((await answer(await pay(accountant.headers, [{ orderId, amount: 100, paidOn: '2026-02-30' }]))).error.field, 'payments.0.paidOn');
  assert.equal((await answer(await pay(accountant.headers, [{ orderId, amount: 100.5 }]))).error.message, 'Enter whole rupees.');
  assert.equal((await answer(await pay(accountant.headers, [{ orderId, amount: 100, method: 'card' }]))).error.message, 'Choose how they paid.');

  await send(`/v1/admin/orders/${placed.id}/billing`, 'PUT', { terms: 'credit', bill: 0 }, accountant.headers);
  assert.equal((await answer(await pay(accountant.headers, [{ orderId, amount: 100 }]))).error.message, `Set the bill amount for ${placed.number} first.`);

  await send('/v1/admin/orders/status', 'POST', { ids: [orderId], status: 'cancelled' }, (await staff('owner')).headers);
  assert.equal((await answer(await pay(accountant.headers, [{ orderId, amount: 100 }]))).error.message, `${placed.number} is cancelled, so it takes no payments.`);
});

test('access: the inventory team never sees bills or payments and can’t record them; catalogue editors can’t either', { skip }, async () => {
  const owner = await staff('owner');
  const placed = await order('Private Co', owner.headers);
  await pay(owner.headers, [{ orderId: Number(placed.id), amount: 500 }]);
  await send(`/v1/admin/orders/${placed.id}/billing`, 'PUT', { terms: 'cash', bill: 2900 }, owner.headers);
  await send('/v1/admin/orders/status', 'POST', { ids: [Number(placed.id)], status: 'confirmed' }, owner.headers);

  const inventory = await staff('inventory');
  const seen = ((await (await send('/v1/admin/orders', 'GET', undefined, inventory.headers)).json()) as Order[]).find((item) => item.id === placed.id)!;
  assert.deepEqual([seen.terms, seen.bill, seen.payments], [undefined, undefined, undefined]);
  const packed = (await answer(await send('/v1/admin/orders/status', 'POST', { ids: [Number(placed.id)], status: 'packed' }, inventory.headers))).orders[0]!;
  assert.deepEqual([packed.status, packed.payments], ['packed', undefined]);

  assert.equal((await pay(inventory.headers, [{ orderId: Number(placed.id), amount: 100 }])).status, 403);
  assert.equal((await send(`/v1/admin/orders/${placed.id}/billing`, 'PUT', { terms: 'credit', bill: null }, inventory.headers)).status, 403);
  assert.equal((await pay((await staff('catalogue')).headers, [{ orderId: Number(placed.id), amount: 100 }])).status, 403);

  // Sales see the bill and payments but don't take money: recording, removing and billing are the Owner's and the Accountant's.
  const sales = await staff('sales');
  const desk = ((await (await send('/v1/admin/orders', 'GET', undefined, sales.headers)).json()) as Order[]).find((item) => item.id === placed.id)!;
  assert.deepEqual([desk.bill, desk.payments?.length], [2900, 1]);
  assert.equal((await pay(sales.headers, [{ orderId: Number(placed.id), amount: 100 }])).status, 403);
  assert.equal((await send(`/v1/admin/orders/payments/${desk.payments![0]!.id}`, 'DELETE', undefined, sales.headers)).status, 403);
  assert.equal((await send(`/v1/admin/orders/${placed.id}/billing`, 'PUT', { terms: 'credit', bill: null }, sales.headers)).status, 403);
});
