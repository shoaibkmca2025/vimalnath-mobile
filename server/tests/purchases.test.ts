import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Purchase, StockItem, Supplier } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { purchaseRoutes, purchaseTotals, supplierRoutes } from '../src/purchases.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { stockRoutes } from '../src/stock.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('purchases', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  await sql`insert into products (id, code, name, section, category_id, catalogue_source, catalogue_page, sort_order) values ('p3', 'TGH-99', 'Lock', 'Locks', 'glass', 'master', 12, 3)`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/stock', stockRoutes(sql));
  admin.route('/purchases', purchaseRoutes(sql));
  admin.route('/suppliers', supplierRoutes(sql));
  app.route('/v1/admin', admin);
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

type Answer = { purchases: Purchase[]; stock: StockItem[]; supplier: Supplier; error: { message: string; field?: string } };
const answer = async (res: Response) => (await res.json()) as Answer;
const today = new Date().toISOString().slice(0, 10);
const stockOf = async (headers: Record<string, string>, productId: string, option: string) =>
  ((await (await send('/v1/admin/stock', 'GET', undefined, headers)).json()) as StockItem[]).find((item) => item.productId === productId && item.option === option);
const supplier = async (headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
  (await (await send('/v1/admin/suppliers', 'POST', { name: `Supplier ${++next}`, ...extra }, headers)).json()) as Supplier;
const bill = (supplierId: number, extra: Record<string, unknown> = {}) => ({
  supplierId,
  supplierInvoice: `INV-${++next}`,
  billDate: today,
  items: [
    { productId: 'p1', option: 'SSS', qty: 10, unit: 'pcs', rate: 800, discountPct: 10, gstRate: 18 },
    { productId: 'p3', option: '', qty: 2.5, unit: 'set', rate: 120.5, gstRate: 5 },
  ],
  freight: 250,
  ...extra,
});

test('totals: each line after its discount, GST on that, then freight and other charges, less the bill discount, plus round off', () => {
  const totals = purchaseTotals({
    items: [
      { productId: 'a', option: '', qty: 10, unit: 'pcs', rate: 800, discountPct: 10, gstRate: 18 },
      { productId: 'b', option: '', qty: 2.5, unit: 'set', rate: 120.5, discountPct: 0, gstRate: 5 },
    ],
    freight: 250,
    otherCharges: 40,
    discount: 100,
    roundOff: -0.48,
  });
  // 7,200 + 301.25 = 7,501.25; GST 1,296 + 15.06 = 1,311.06; + 250 + 40 − 100 − 0.48.
  assert.deepEqual(totals, { subtotal: 7501.25, tax: 1311.06, total: 9001.83 });
});

test('suppliers: a GSTIN must look like one and belong to one supplier; only an unused supplier can be deleted', { skip }, async () => {
  const owner = await staff('owner');
  const bad = await send('/v1/admin/suppliers', 'POST', { name: 'Bad Co', gstin: '27ABC' }, owner.headers);
  assert.deepEqual((await answer(bad)).error, { message: 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.', field: 'gstin' });
  const made = await supplier(owner.headers, { gstin: '27aapfu0939f1zv', openingBalance: 5000, paymentDays: 30, state: 'Maharashtra' });
  assert.deepEqual([made.gstin, made.openingBalance, made.outstanding, made.paymentDays], ['27AAPFU0939F1ZV', 5000, 5000, 30]);
  assert.equal((await send('/v1/admin/suppliers', 'POST', { name: 'Copy Co', gstin: '27AAPFU0939F1ZV' }, owner.headers)).status, 409);

  const unused = await supplier(owner.headers);
  assert.equal((await send(`/v1/admin/suppliers/${unused.id}`, 'DELETE', undefined, owner.headers)).status, 204);
  await send('/v1/admin/purchases', 'POST', bill(made.id), owner.headers);
  assert.equal((await send(`/v1/admin/suppliers/${made.id}`, 'DELETE', undefined, owner.headers)).status, 409);
});

test('receive: a draft moves no stock; receiving adds it exactly once and sets the purchase price; cancelling takes it back out', { skip }, async () => {
  const owner = await staff('owner');
  await send('/v1/admin/stock', 'PUT', { items: [{ productId: 'p1', option: 'SSS', sku: '', barcode: '', unit: 'pcs', brand: '', manufacturer: '', hsn: '', gstRate: null, purchasePrice: 700, sellingPrice: null, wholesalePrice: null, minStock: null, maxStock: null, rack: '', location: '', quantity: 5 }] }, owner.headers);
  const { id: supplierId } = await supplier(owner.headers);

  const draft = (await answer(await send('/v1/admin/purchases', 'POST', bill(supplierId), owner.headers))).purchases[0]!;
  assert.deepEqual([draft.number.startsWith('PUR-'), draft.status, draft.subtotal, draft.tax, draft.total], [true, 'draft', 7501.25, 1311.06, 9062.31]);
  assert.equal((await stockOf(owner.headers, 'p1', 'SSS'))!.quantity, 5);

  // A draft can still change.
  const edited = await answer(await send(`/v1/admin/purchases/${draft.id}`, 'PUT', bill(supplierId, { supplierInvoice: draft.supplierInvoice, freight: 0 }), owner.headers));
  assert.equal(edited.purchases[0]!.total, 8812.31);

  const received = await answer(await send(`/v1/admin/purchases/${draft.id}/receive`, 'POST', undefined, owner.headers));
  assert.equal(received.purchases[0]!.status, 'received');
  const sss = received.stock.find((item) => item.productId === 'p1')!;
  const lock = received.stock.find((item) => item.productId === 'p3')!;
  // Bought at 800 less 10%: the new purchase price is 720. The lock wasn't counted, so it starts here, in sets.
  assert.deepEqual([sss.quantity, sss.purchasePrice], [15, 720]);
  assert.deepEqual([lock.quantity, lock.unit, lock.purchasePrice, lock.gstRate], [2.5, 'set', 120.5, 5]);

  assert.equal((await send(`/v1/admin/purchases/${draft.id}/receive`, 'POST', undefined, owner.headers)).status, 409);
  assert.equal((await send(`/v1/admin/purchases/${draft.id}`, 'PUT', bill(supplierId), owner.headers)).status, 409);
  assert.equal((await send(`/v1/admin/purchases/${draft.id}`, 'DELETE', undefined, owner.headers)).status, 409);
  assert.equal((await stockOf(owner.headers, 'p1', 'SSS'))!.quantity, 15);

  const cancelled = await answer(await send(`/v1/admin/purchases/${draft.id}/cancel`, 'POST', undefined, owner.headers));
  assert.equal(cancelled.purchases[0]!.status, 'cancelled');
  assert.deepEqual([(await stockOf(owner.headers, 'p1', 'SSS'))!.quantity, (await stockOf(owner.headers, 'p3', ''))!.quantity], [5, 0]);
  const moves = (await (await send('/v1/admin/stock/moves?productId=p1&option=SSS', 'GET', undefined, owner.headers)).json()) as { kind: string; change: number; purchaseNumber?: string }[];
  assert.deepEqual(moves.slice(0, 2).map((move) => [move.kind, move.change, move.purchaseNumber]), [
    ['purchase_cancelled', -10, draft.number],
    ['purchase', 10, draft.number],
  ]);
});

test('bills: the same supplier bill can’t be entered twice; items must be in the catalogue and in the unit they’re counted in', { skip }, async () => {
  const owner = await staff('owner');
  const { id: supplierId } = await supplier(owner.headers);
  const first = (await answer(await send('/v1/admin/purchases', 'POST', bill(supplierId, { supplierInvoice: 'GB/221' }), owner.headers))).purchases[0]!;
  const twice = await send('/v1/admin/purchases', 'POST', bill(supplierId, { supplierInvoice: 'gb/221' }), owner.headers);
  assert.deepEqual([twice.status, (await answer(twice)).error], [409, { message: `Bill gb/221 from this supplier is already entered as ${first.number}.`, field: 'supplierInvoice' }]);
  // Once that bill is cancelled, the number is free again.
  await send(`/v1/admin/purchases/${first.id}/cancel`, 'POST', undefined, owner.headers);
  assert.equal((await send('/v1/admin/purchases', 'POST', bill(supplierId, { supplierInvoice: 'GB/221' }), owner.headers)).status, 201);

  const gone = await send('/v1/admin/purchases', 'POST', bill(supplierId, { items: [{ productId: 'p1', option: 'Gold', qty: 1, unit: 'pcs', rate: 1, gstRate: 18 }] }), owner.headers);
  assert.equal((await answer(gone)).error.field, 'items.0.productId');
  // p1 SSS is counted in PCS (the test before), so a bill in boxes is refused.
  const boxes = await send('/v1/admin/purchases', 'POST', bill(supplierId, { items: [{ productId: 'p1', option: 'SSS', qty: 1, unit: 'box', rate: 1, gstRate: 18 }] }), owner.headers);
  assert.deepEqual((await answer(boxes)).error, { message: 'H Type Handle · SSS is counted in PCS. Enter its quantity in PCS.', field: 'items.0.unit' });
  const negative = await send('/v1/admin/purchases', 'POST', bill(supplierId, { discount: 100000 }), owner.headers);
  assert.deepEqual((await answer(negative)).error, { message: 'The discount is more than the bill.', field: 'discount' });
});

test('payments: against a bill up to what it owes, or on account; outstanding is opening + received bills − payments', { skip }, async () => {
  const owner = await staff('owner');
  const made = await supplier(owner.headers, { openingBalance: 1000 });
  const pay = (body: Record<string, unknown>) => send(`/v1/admin/suppliers/${made.id}/payments`, 'POST', { method: 'bank', paidOn: today, ...body }, owner.headers);
  const draft = (await answer(await send('/v1/admin/purchases', 'POST', bill(made.id, { receive: true }), owner.headers))).purchases[0]!;
  assert.equal(draft.status, 'received');

  const first = await answer(await pay({ purchaseId: Number(draft.id), amount: 5000, note: 'UTR 9912' }));
  assert.deepEqual([first.supplier.billed, first.supplier.paid, first.supplier.outstanding], [9062.31, 5000, 5062.31]);
  assert.deepEqual(first.purchases[0]!.payments!.map((payment) => [payment.amount, payment.method, payment.note]), [[5000, 'bank', 'UTR 9912']]);
  const over = await answer(await pay({ purchaseId: Number(draft.id), amount: 4062.32 }));
  assert.deepEqual(over.error, { message: `That is more than ${draft.number} still owes (₹4,062.31).`, field: 'amount' });
  // The old balance, on account.
  assert.equal((await answer(await pay({ amount: 1000 }))).supplier.outstanding, 4062.31);

  assert.equal((await send(`/v1/admin/purchases/${draft.id}`, 'DELETE', undefined, owner.headers)).status, 409);
  const payments = (await (await send(`/v1/admin/suppliers/${made.id}/payments`, 'GET', undefined, owner.headers)).json()) as { id: string; purchaseNumber: string | null }[];
  assert.deepEqual(payments.map((payment) => payment.purchaseNumber), [null, draft.number]);
  const removed = await answer(await send(`/v1/admin/suppliers/${made.id}/payments/${payments[1]!.id}`, 'DELETE', undefined, owner.headers));
  assert.equal(removed.supplier.outstanding, 9062.31);
});

test('access: purchases and suppliers are for Owners only', { skip }, async () => {
  for (const role of ['sales', 'inventory', 'catalogue']) {
    const { headers } = await staff(role);
    assert.equal((await send('/v1/admin/purchases', 'GET', undefined, headers)).status, 403);
    assert.equal((await send('/v1/admin/suppliers', 'GET', undefined, headers)).status, 403);
  }
});
