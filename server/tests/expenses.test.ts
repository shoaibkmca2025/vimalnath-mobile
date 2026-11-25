import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Order } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { appRoutes } from '../src/app-users.ts';
import { expenseRoutes } from '../src/expenses.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { purchaseRoutes, supplierRoutes } from '../src/purchases.ts';
import { reportRoutes } from '../src/reports.ts';
import { adminRoutes, issuePasswordLink, sha256 } from '../src/staff.ts';
import { stockRoutes } from '../src/stock.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('expenses', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/orders', orderAdminRoutes(sql));
  admin.route('/stock', stockRoutes(sql));
  admin.route('/purchases', purchaseRoutes(sql));
  admin.route('/suppliers', supplierRoutes(sql));
  admin.route('/expenses', expenseRoutes(sql));
  admin.route('/reports', reportRoutes(sql));
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

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const today = day(0);
// Yesterday to tomorrow, so the test passes whatever the hour in India.
const period = `from=${day(-1)}&to=${day(1)}`;
const json = async (res: Response) => (await res.json()) as Record<string, any>;
const rent = { spentOn: today, category: 'rent', description: 'Shop rent', paidTo: 'Landlord', amount: 500, method: 'cash' };

test('expenses: the Accountant’s wait for the Owner, the Owner’s count at once, approved ones are cancelled not deleted', { skip }, async () => {
  const owner = await staff('owner');
  const accountant = await staff('accountant');
  const sales = await staff('sales');

  assert.equal((await send('/v1/admin/expenses', 'GET', undefined, sales.headers)).status, 403);
  const tooMuchGst = await send('/v1/admin/expenses', 'POST', { ...rent, gst: 500 }, accountant.headers);
  assert.equal(tooMuchGst.status, 400);
  assert.equal((await json(tooMuchGst)).error.field, 'gst');

  const asked = await json(await send('/v1/admin/expenses', 'POST', { ...rent, gst: 76.27, gstin: '27aapfu0939f1zv' }, accountant.headers));
  assert.equal(asked.status, 'pending');
  assert.match(asked.number, /^EXP-\d{4}$/);
  assert.equal(asked.gstin, '27AAPFU0939F1ZV');
  assert.equal((await send(`/v1/admin/expenses/${asked.id}/approve`, 'POST', undefined, accountant.headers)).status, 403);

  const approved = await json(await send(`/v1/admin/expenses/${asked.id}/approve`, 'POST', undefined, owner.headers));
  assert.equal(approved.status, 'approved');
  assert.equal(approved.decidedBy, owner.name);
  assert.equal((await send(`/v1/admin/expenses/${asked.id}/approve`, 'POST', undefined, owner.headers)).status, 409, 'approving twice changes nothing');
  assert.equal((await send(`/v1/admin/expenses/${asked.id}`, 'DELETE', undefined, owner.headers)).status, 409, 'an approved expense stays in the books');
  assert.equal((await send(`/v1/admin/expenses/${asked.id}`, 'PUT', { ...rent, amount: 1 }, owner.headers)).status, 409);
  assert.equal((await send(`/v1/admin/expenses/${asked.id}/cancel`, 'POST', { reason: '' }, owner.headers)).status, 400, 'cancelling needs a reason');
  const cancelled = await json(await send(`/v1/admin/expenses/${asked.id}/cancel`, 'POST', { reason: 'Entered twice' }, owner.headers));
  assert.deepEqual([cancelled.status, cancelled.reason], ['cancelled', 'Entered twice']);

  const own = await json(await send('/v1/admin/expenses', 'POST', { ...rent, category: 'electricity', amount: 1200.5, method: 'upi' }, owner.headers));
  assert.equal(own.status, 'approved');

  const wrong = await json(await send('/v1/admin/expenses', 'POST', { ...rent, category: 'transport', amount: 300 }, accountant.headers));
  const rejected = await json(await send(`/v1/admin/expenses/${wrong.id}/reject`, 'POST', { reason: 'No bill' }, owner.headers));
  assert.deepEqual([rejected.status, rejected.reason], ['rejected', 'No bill']);
  const again = await json(await send(`/v1/admin/expenses/${wrong.id}`, 'PUT', { ...rent, category: 'transport', amount: 300, reference: 'Bill 77' }, accountant.headers));
  assert.deepEqual([again.status, again.reason, again.reference], ['pending', '', 'Bill 77'], 'fixed and sent back for approval');
  assert.equal((await send(`/v1/admin/expenses/${wrong.id}`, 'DELETE', undefined, accountant.headers)).status, 204);
  assert.equal((await send(`/v1/admin/expenses/${wrong.id}`, 'DELETE', undefined, accountant.headers)).status, 404);
});

test('reports: profit and loss from real records, and the cash and bank books from every payment', { skip }, async () => {
  await sql`delete from expenses`;
  const owner = await staff('owner');
  const accountant = await staff('accountant');
  const sales = await staff('sales');
  assert.equal((await send(`/v1/admin/reports/profit-loss?${period}`, 'GET', undefined, sales.headers)).status, 403);
  assert.equal((await send(`/v1/admin/reports/profit-loss?from=${day(1)}&to=${day(-1)}`, 'GET', undefined, owner.headers)).status, 400);

  // Partition Hardware (SSS) is stocked at ₹1,000 each: 5 bought at ₹1,000 + 18% GST, then 2 sold at ₹1,500.
  await sql`insert into stock_items (product_id, option_label, purchase_price) values ('p2', 'SSS', 1000) on conflict do nothing`;
  const supplier = await json(await send('/v1/admin/suppliers', 'POST', { name: 'Glass Co' }, owner.headers));
  const bill = await json(
    await send('/v1/admin/purchases', 'POST', { supplierId: Number(supplier.id), supplierInvoice: 'G-1', billDate: today, items: [{ productId: 'p2', option: 'SSS', qty: 5, unit: 'pcs', rate: 1000, gstRate: 18 }], receive: true }, owner.headers),
  );
  const purchaseId = bill.purchases[0].id;

  const token = `token-${++next}`;
  await sql`with customer as (insert into customers (name) values ('Report Co') returning id) insert into app_devices (label, token_hash, customer_id) select 'Report Co', ${sha256(token)}, id from customer`;
  const lines = [{ productId: 'p2', code: 'TGH-55', name: 'Partition Hardware', option: 'SSS', qty: 2, mrp: 1500 }];
  await send('/v1/app/orders', 'POST', { eventId: `order:${token}`, order: { id: 'local-1', createdAt: new Date().toISOString(), customer: 'Report Co', lines } }, { Authorization: `Bearer ${token}` });
  const order = ((await (await send('/v1/admin/orders', 'GET', undefined, owner.headers)).json()) as Order[]).find((one) => one.appUser?.label === 'Report Co')!;
  assert.equal((await send('/v1/admin/orders/status', 'POST', { ids: [order.id], status: 'delivered' }, owner.headers)).status, 200);

  await send('/v1/admin/expenses', 'POST', rent, owner.headers);
  await send('/v1/admin/expenses', 'POST', { ...rent, amount: 9999 }, accountant.headers); // Waiting for approval: not counted.

  const pl = await json(await send(`/v1/admin/reports/profit-loss?${period}`, 'GET', undefined, accountant.headers));
  assert.deepEqual(pl.sales, { orders: 1, bills: 3000, gst: 0, withoutInvoice: 1, uncostedLines: 0 });
  assert.equal(pl.netSales, 3000);
  assert.deepEqual(pl.openingStock, { value: 0, unpriced: 0 });
  assert.deepEqual(pl.purchases, { count: 1, value: 5000 }, 'before GST, which is claimed back');
  assert.deepEqual(pl.closingStock, { value: 3000, unpriced: 0 }, '3 left at ₹1,000');
  assert.equal(pl.costOfGoods, 2000, 'opening 0 + bought 5,000 − closing 3,000');
  assert.equal(pl.grossProfit, 1000);
  assert.deepEqual(pl.expenses, [{ category: 'rent', count: 1, amount: 500 }]);
  assert.equal(pl.netProfit, 500);

  // Money: ₹1,000 cash from the customer, ₹2,000 by bank to the supplier, ₹500 rent in cash, ₹10,000 cash to start.
  await send('/v1/admin/orders/payments', 'POST', { payments: [{ orderId: Number(order.id), amount: 1000, method: 'cash', paidOn: today }] }, owner.headers);
  await send(`/v1/admin/suppliers/${supplier.id}/payments`, 'POST', { purchaseId: Number(purchaseId), amount: 2000, method: 'bank', paidOn: today }, owner.headers);
  assert.equal((await send('/v1/admin/reports/book-openings', 'PUT', { book: 'cash', amount: 10000, asOf: day(-1) }, accountant.headers)).status, 403);
  assert.equal((await send('/v1/admin/reports/book-openings', 'PUT', { book: 'cash', amount: 10000, asOf: day(-1) }, owner.headers)).status, 204);

  const { books } = await json(await send(`/v1/admin/reports/cash-book?${period}`, 'GET', undefined, accountant.headers));
  const [cash, bank] = books;
  assert.deepEqual([cash.book, cash.opening, cash.in, cash.out, cash.closing], ['cash', 10000, 1000, 500, 10500]);
  assert.deepEqual(
    cash.entries.map((entry: Record<string, unknown>) => [entry.kind, entry.in, entry.out, entry.balance]),
    [
      ['Customer payment', 1000, 0, 11000],
      ['Expense', 0, 500, 10500],
    ],
  );
  assert.deepEqual([bank.book, bank.opening, bank.out, bank.closing], ['bank', 0, 2000, -2000]);

  // Stock movement: none at the start, 5 in, 2 out, 3 left.
  const moves = (await json(await send(`/v1/admin/reports/stock-movement?${period}`, 'GET', undefined, accountant.headers))) as unknown as Record<string, unknown>[];
  const item = moves.find((row) => row.productId === 'p2' && row.option === 'SSS')!;
  assert.deepEqual([item.opening, item.in, item.out, item.closing], [0, 5, 2, 3]);
});
