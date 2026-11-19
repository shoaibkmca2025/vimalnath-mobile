import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Order, StockItem, StockMove } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { appRoutes } from '../src/app-users.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { adminRoutes, issuePasswordLink, sha256 } from '../src/staff.ts';
import { stockRoutes } from '../src/stock.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('stock', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  // A product without options, counted as one item.
  await sql`insert into products (id, code, name, section, category_id, catalogue_source, catalogue_page, sort_order) values ('p3', 'TGH-99', 'Lock', 'Locks', 'glass', 'master', 12, 3)`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/orders', orderAdminRoutes(sql));
  admin.route('/stock', stockRoutes(sql));
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

const blank = { sku: '', barcode: '', unit: 'pcs', brand: '', manufacturer: '', hsn: '', gstRate: null, sellingPrice: null, wholesalePrice: null, minStock: null, maxStock: null, rack: '', location: '' };
const item = (productId: string, option: string, extra: Record<string, unknown> = {}) => ({ productId, option, ...blank, ...extra });
const answer = async (res: Response) => (await res.json()) as { stock: StockItem[]; error: { message: string; field?: string } };
const list = async (headers: Record<string, string>) => (await (await send('/v1/admin/stock', 'GET', undefined, headers)).json()) as StockItem[];
const find = async (headers: Record<string, string>, productId: string, option: string) => (await list(headers)).find((row) => row.productId === productId && row.option === option);
const moves = async (headers: Record<string, string>, productId: string, option: string) =>
  (await (await send(`/v1/admin/stock/moves?productId=${productId}&option=${encodeURIComponent(option)}`, 'GET', undefined, headers)).json()) as StockMove[];

/** An order from a new customer's app, then marked delivered (or another status) by staff. */
async function order(headers: Record<string, string>, lines: { productId: string; option?: string; qty: number }[]) {
  const token = `token-${++next}`;
  const label = `Shop ${next}`;
  await sql`with customer as (insert into customers (name) values (${label}) returning id) insert into app_devices (label, token_hash, customer_id) select ${label}, ${sha256(token)}, id from customer`;
  const sent = lines.map((line) => ({ code: 'X', name: 'X', ...line }));
  await send('/v1/app/orders', 'POST', { eventId: `order:${token}`, order: { id: 'local-1', createdAt: new Date().toISOString(), customer: label, lines: sent } }, { Authorization: `Bearer ${token}` });
  const orders = (await (await send('/v1/admin/orders', 'GET', undefined, headers)).json()) as Order[];
  const id = Number(orders.find((one) => one.appUser?.label === label)!.id);
  return { id, status: (status: string) => send('/v1/admin/orders/status', 'POST', { ids: [id], status }, headers) };
}

test('set up: an item starts with its opening stock and details; options not in the catalogue are refused', { skip }, async () => {
  const owner = await staff('owner');
  const res = await send('/v1/admin/stock', 'PUT', { items: [item('p1', 'SSS', { sku: 'H55-S', unit: 'pcs', hsn: '8302', gstRate: 18, purchasePrice: 812.5, sellingPrice: 1350, minStock: 5, maxStock: 50, rack: 'A-3', quantity: 12 })] }, owner.headers);
  assert.equal(res.status, 200);
  const [saved] = (await answer(res)).stock;
  assert.deepEqual(
    { sku: saved!.sku, hsn: saved!.hsn, gstRate: saved!.gstRate, purchasePrice: saved!.purchasePrice, sellingPrice: saved!.sellingPrice, quantity: saved!.quantity, minStock: saved!.minStock, rack: saved!.rack, orphan: saved!.orphan },
    { sku: 'H55-S', hsn: '8302', gstRate: 18, purchasePrice: 812.5, sellingPrice: 1350, quantity: 12, minStock: 5, rack: 'A-3', orphan: false },
  );
  assert.deepEqual((await moves(owner.headers, 'p1', 'SSS')).map((row) => [row.kind, row.change, row.balance, row.by]), [['opening', 12, 12, owner.name]]);

  // A product without options is one item, under ''.
  assert.equal((await send('/v1/admin/stock', 'PUT', { items: [item('p3', '', { unit: 'set', quantity: 2.5 })] }, owner.headers)).status, 200);
  const missing = await send('/v1/admin/stock', 'PUT', { items: [item('p1', 'Gold')] }, owner.headers);
  assert.deepEqual((await answer(missing)).error, { message: '“Gold” isn’t in the catalogue any more.', field: 'items.0.option' });
  assert.equal((await answer(await send('/v1/admin/stock', 'PUT', { items: [item('p1', 'BM', { gstRate: 15 })] }, owner.headers))).error.field, 'items.0.gstRate');
  assert.equal((await answer(await send('/v1/admin/stock', 'PUT', { items: [item('p1', 'BM', { minStock: 10, maxStock: 5 })] }, owner.headers))).error.field, 'items.0.maxStock');
  assert.equal((await answer(await send('/v1/admin/stock', 'PUT', { items: [item('p1', 'BM', { hsn: '83021' })] }, owner.headers))).error.field, 'items.0.hsn');
});

test('counts and adjustments: each one recorded with who, why, and the stock after it', { skip }, async () => {
  const owner = await staff('owner');
  await send('/v1/admin/stock', 'PUT', { items: [item('p2', 'SSS', { quantity: 10 })] }, owner.headers);
  const adjust = (body: Record<string, unknown>) => send('/v1/admin/stock/adjust', 'POST', { productId: 'p2', option: 'SSS', ...body }, owner.headers);

  assert.equal((await answer(await adjust({ count: 7, note: 'Monthly count' }))).stock[0]!.quantity, 7);
  assert.equal((await answer(await adjust({ change: -2, reason: 'damaged', note: '2 bent' }))).stock[0]!.quantity, 5);
  assert.equal((await answer(await adjust({ change: 3 }))).error.message, 'Choose a reason.');
  assert.equal((await answer(await adjust({ change: 0, reason: 'found' }))).error.message, 'Enter a quantity other than 0.');
  // Saving details with a new quantity is a count too; without one, the quantity stays.
  await send('/v1/admin/stock', 'PUT', { items: [item('p2', 'SSS', { rack: 'B-1' })] }, owner.headers);
  assert.equal((await find(owner.headers, 'p2', 'SSS'))!.quantity, 5);

  assert.deepEqual(
    (await moves(owner.headers, 'p2', 'SSS')).map((row) => [row.kind, row.change, row.balance, row.reason, row.note]),
    [
      ['adjust', -2, 5, 'damaged', '2 bent'],
      ['count', -3, 7, '', 'Monthly count'],
      ['opening', 10, 10, '', ''],
    ],
  );
  assert.equal((await send('/v1/admin/stock/adjust', 'POST', { productId: 'p1', option: 'BM', count: 1 }, owner.headers)).status, 404);
});

test('orders: delivering takes tracked items from stock, and moving it back from delivered returns exactly that', { skip }, async () => {
  const owner = await staff('owner');
  await sql`delete from stock_items where product_id in ('p1', 'p3')`;
  await send('/v1/admin/stock', 'PUT', { items: [item('p1', 'SSS', { quantity: 20 }), item('p3', '', { quantity: 1 })] }, owner.headers);
  const placed = await order(owner.headers, [
    { productId: 'p1', option: 'SSS', qty: 3 },
    { productId: 'p1', option: 'SSS', qty: 2 },
    { productId: 'p3', qty: 4 },
    // Not tracked: delivering it changes nothing.
    { productId: 'p1', option: 'BM', qty: 9 },
  ]);
  const stockOf = async () => [(await find(owner.headers, 'p1', 'SSS'))!.quantity, (await find(owner.headers, 'p3', ''))!.quantity, (await find(owner.headers, 'p1', 'BM'))?.quantity];

  await placed.status('dispatched');
  assert.deepEqual(await stockOf(), [20, 1, undefined]);
  await placed.status('delivered');
  // More delivered than counted: below zero, which tells staff to count it.
  assert.deepEqual(await stockOf(), [15, -3, undefined]);
  const [last] = await moves(owner.headers, 'p1', 'SSS');
  assert.deepEqual([last!.kind, last!.change, last!.orderNumber !== undefined], ['delivered', -5, true]);

  await placed.status('dispatched');
  assert.deepEqual(await stockOf(), [20, 1, undefined]);
  await placed.status('delivered');
  await placed.status('cancelled');
  assert.deepEqual(await stockOf(), [20, 1, undefined]);

  // Delivered before BM was tracked: taking the order back doesn't add BM stock that was never taken.
  await placed.status('delivered');
  await send('/v1/admin/stock', 'PUT', { items: [item('p1', 'BM', { quantity: 4 })] }, owner.headers);
  await placed.status('dispatched');
  assert.deepEqual(await stockOf(), [20, 1, 4]);
});

test('access: Sales see stock without purchase prices and change nothing; the inventory team keeps the Owner’s prices', { skip }, async () => {
  const owner = await staff('owner');
  await send('/v1/admin/stock', 'PUT', { items: [item('p2', 'SSS', { purchasePrice: 900, quantity: 3 })] }, owner.headers);

  const sales = await staff('sales');
  const seen = await find(sales.headers, 'p2', 'SSS');
  assert.equal(seen!.purchasePrice, null);
  assert.equal((await send('/v1/admin/stock', 'PUT', { items: [item('p2', 'SSS')] }, sales.headers)).status, 403);
  assert.equal((await send('/v1/admin/stock/adjust', 'POST', { productId: 'p2', option: 'SSS', count: 1 }, sales.headers)).status, 403);

  const inventory = await staff('inventory');
  const saved = await answer(await send('/v1/admin/stock', 'PUT', { items: [item('p2', 'SSS', { rack: 'C-9', purchasePrice: 1 })] }, inventory.headers));
  assert.deepEqual([saved.stock[0]!.rack, saved.stock[0]!.purchasePrice], ['C-9', null]);
  assert.equal((await find(owner.headers, 'p2', 'SSS'))!.purchasePrice, 900);
  // An Owner's save without the price (a CSV without that column) keeps it too.
  await send('/v1/admin/stock', 'PUT', { items: [item('p2', 'SSS')] }, owner.headers);
  assert.equal((await find(owner.headers, 'p2', 'SSS'))!.purchasePrice, 900);

  assert.equal((await send('/v1/admin/stock', 'GET', undefined, (await staff('catalogue')).headers)).status, 403);
});

test('renamed options: the stock left behind is marked, and an Owner can stop tracking it', { skip }, async () => {
  const owner = await staff('owner');
  await sql`insert into products (id, code, name, section, category_id, catalogue_source, catalogue_page, sort_order) values ('p4', 'TGH-70', 'Knob', 'Knobs', 'glass', 'master', 14, 4)`;
  await sql`insert into product_options (product_id, label, mrp, sort_order) values ('p4', 'Gold', 500, 0)`;
  await send('/v1/admin/stock', 'PUT', { items: [item('p4', 'Gold', { quantity: 6 })] }, owner.headers);
  await sql`update product_options set label = 'Rose Gold' where product_id = 'p4'`;
  assert.equal((await find(owner.headers, 'p4', 'Gold'))!.orphan, true);

  assert.equal((await send('/v1/admin/stock/item?productId=p4&option=Gold', 'DELETE', undefined, (await staff('inventory')).headers)).status, 403);
  assert.equal((await send('/v1/admin/stock/item?productId=p4&option=Gold', 'DELETE', undefined, owner.headers)).status, 200);
  assert.equal(await find(owner.headers, 'p4', 'Gold'), undefined);
});
