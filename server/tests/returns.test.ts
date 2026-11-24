import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { CreditNote, Order, SalesReturn, SupplierReturn } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { financialYear, gstRoutes } from '../src/gst.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { purchaseRoutes, supplierRoutes } from '../src/purchases.ts';
import { can, returnRoutes } from '../src/returns.ts';
import { adminRoutes, issuePasswordLink, sha256 } from '../src/staff.ts';
import { supplierReturnRoutes } from '../src/supplier-returns.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;
const today = new Date().toISOString().slice(0, 10);

testDatabase('returns', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  // Three counted items, 10 of each: H Type Handle SSS (₹1,500), BM (₹1,700), and the partition handle (₹1,500).
  await sql`
    insert into stock_items (product_id, option_label, hsn, gst_rate, unit, quantity, selling_price)
    values ('p1', 'SSS', '8302', 18, 'pcs', 10, 1500), ('p1', 'BM', '8302', 18, 'pcs', 10, 1700), ('p2', 'SSS', '8302', 18, 'pcs', 10, 1500)`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/orders', orderAdminRoutes(sql));
  admin.route('/purchases', purchaseRoutes(sql));
  admin.route('/suppliers', supplierRoutes(sql));
  admin.route('/gst', gstRoutes(sql));
  admin.route('/returns', returnRoutes(sql));
  admin.route('/supplier-returns', supplierReturnRoutes(sql));
  app.route('/v1/admin', admin);
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });
type Answer = { returns: SalesReturn[]; orders: Order[]; supplierReturns: SupplierReturn[]; error: { message: string; field?: string } };
const answer = async (res: Response) => (await res.json()) as Answer;

async function staff(role: 'owner' | 'sales' | 'inventory' | 'accountant') {
  const email = `${role}${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`${role} ${next}`}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

/** A customer with an app device, as orders come from. */
async function customer(name: string, gst: { gstin?: string; state?: string } = {}) {
  const [row] = await sql`insert into customers (name, gstin, state, billing_address) values (${name}, ${gst.gstin ?? ''}, ${gst.state ?? ''}, 'Nashik') returning id`;
  const [device] = await sql`insert into app_devices (label, name, phone, token_hash, customer_id) values (${name}, ${name}, '98220 00000', ${sha256(`d${++next}`)}, ${row!.id}) returning id`;
  return { id: row!.id as number, device: device!.id as number };
}

/** A delivered order (two days ago) for these lines at MRP. */
async function order(device: number, lines: { productId: string; option: string; qty: number; mrp: number }[], status = 'delivered') {
  const n = ++next;
  const total = lines.reduce((sum, line) => sum + line.qty * line.mrp, 0);
  const [row] = await sql`
    insert into orders (number, device_id, client_event_id, client_order_id, customer, total, placed_at, status)
    values (${`VSC-${n}`}, ${device}, ${`e${n}`}, ${`o${n}`}, 'Buyer', ${total}, now() - interval '3 days', ${status}) returning id`;
  await sql`insert into order_lines ${sql(lines.map((line, position) => ({ order_id: row!.id, position, product_id: line.productId, code: 'TGH-55', name: 'H Type Handle', option: line.option, qty: line.qty, mrp: line.mrp })))}`;
  if (status === 'delivered') await sql`insert into order_events (order_id, status, at, by) values (${row!.id}, 'delivered', now() - interval '2 days', 'Asha')`;
  return row!.id as number;
}

const SSS = { productId: 'p1', option: 'SSS' };
const BM = { productId: 'p1', option: 'BM' };
const P2 = { productId: 'p2', option: 'SSS' };
const stock = async (item: { productId: string; option: string }) => {
  const [row] = await sql`select quantity::float8 as available, held::float8 as held, damaged::float8 as damaged, defective::float8 as defective from stock_items where product_id = ${item.productId} and option_label = ${item.option}`;
  return row as unknown as { available: number; held: number; damaged: number; defective: number };
};
const setStock = (item: { productId: string; option: string }, quantity: number) => sql`update stock_items set quantity = ${quantity}, held = 0, damaged = 0, defective = 0 where product_id = ${item.productId} and option_label = ${item.option}`;

/** Runs a step and gives back the return as it is after it, failing the test on an error. */
async function step(headers: Record<string, string>, path: string, body: Record<string, unknown> = {}, method = 'POST') {
  const res = await send(`/v1/admin/returns${path}`, method, body, headers);
  const json = await answer(res);
  assert.ok(res.ok, `${path}: ${res.status} ${json.error?.message}`);
  return json;
}
const refund = (orderId: number, items: { sourcePosition: number; qty: number; condition?: string }[], extra: Record<string, unknown> = {}) => ({
  kind: 'refund',
  orderId,
  returnDate: today,
  reason: 'damaged',
  items: items.map((item) => ({ source: 'order', condition: 'good', ...item })),
  ...extra,
});

test('return: one item of several; sales record it, an owner approves, the inventory team receives and checks it, back on sale', { skip }, async () => {
  const [owner, sales, inventory] = [await staff('owner'), await staff('sales'), await staff('inventory')];
  const buyer = await customer('Laude');
  const id = await order(buyer.device, [
    { ...SSS, qty: 2, mrp: 1500 },
    { ...P2, qty: 1, mrp: 1500 },
  ]);
  await setStock(SSS, 8);

  const source = await (await send(`/v1/admin/returns/orders/${id}`, 'GET', undefined, sales)).json();
  assert.deepEqual(
    source.lines.map((line: { returnable: number; rate: number }) => [line.returnable, line.rate]),
    [
      [2, 1500],
      [1, 1500],
    ],
  );
  let ret = (await step(sales, '', refund(id, [{ sourcePosition: 0, qty: 1, condition: 'unopened' }]))).returns[0]!;
  assert.deepEqual([ret.number, ret.status, ret.returnValue, ret.settleAmount, ret.flags], ['RET-0001', 'pending', 1500, 1500, []]);

  // Sales can't approve; an owner can. A second approval from the same screen is refused and moves nothing.
  const denied = await send(`/v1/admin/returns/${ret.id}/status`, 'POST', { to: 'approved', version: ret.version }, sales);
  assert.equal(denied.status, 403);
  ret = (await step(owner, `/${ret.id}/status`, { to: 'approved', version: ret.version })).returns[0]!;
  const twice = await send(`/v1/admin/returns/${ret.id}/status`, 'POST', { to: 'approved', version: ret.version - 1 }, owner);
  assert.equal(twice.status, 409);
  assert.equal((await send(`/v1/admin/returns/${ret.id}/status`, 'POST', { to: 'approved', version: ret.version }, owner)).status, 409);

  // Received into held stock, then checked back on sale. A second receive changes nothing.
  ret = (await step(inventory, `/${ret.id}/receive`, { version: ret.version })).returns[0]!;
  assert.equal(ret.status, 'received');
  assert.deepEqual(await stock(SSS), { available: 8, held: 1, damaged: 0, defective: 0 });
  assert.equal((await send(`/v1/admin/returns/${ret.id}/receive`, 'POST', { version: ret.version }, inventory)).status, 409);
  ret = (await step(inventory, `/${ret.id}/inspect`, { version: ret.version, items: [{ position: 0, outcome: 'restock' }] })).returns[0]!;
  assert.equal(ret.status, 'inspected');
  assert.deepEqual(await stock(SSS), { available: 9, held: 0, damaged: 0, defective: 0 });
  const moves = await sql`select kind, bucket, change::float8 as change, balance::float8 as balance from stock_moves where return_id = ${Number(ret.id)} order by id`;
  assert.deepEqual(
    moves.map((move) => [move.kind, move.bucket, move.change, move.balance]),
    [
      ['return_received', 'held', 1, 1],
      ['return_inspected', 'held', -1, 0],
      ['return_inspected', 'available', 1, 9],
    ],
  );

  // Refunded in cash, then it is Refunded by itself and closes. Its order stays delivered.
  assert.equal((await send(`/v1/admin/returns/${ret.id}/refunds`, 'POST', { version: ret.version, amount: 1500, method: 'cash', complete: true }, inventory)).status, 403);
  ret = (await step(owner, `/${ret.id}/refunds`, { version: ret.version, amount: 1500, method: 'cash', complete: true })).returns[0]!;
  assert.deepEqual([ret.status, ret.refunds![0]!.status], ['refunded', 'completed']);
  ret = (await step(owner, `/${ret.id}/status`, { to: 'closed', version: ret.version })).returns[0]!;
  assert.equal(ret.status, 'closed');
  const undo = await answer(await send('/v1/admin/orders/status', 'POST', { ids: [id], status: 'dispatched' }, owner));
  assert.match(undo.error.message, /has return RET-0001, so it stays delivered/);

  // What's left to return of that line is one.
  const after = await (await send(`/v1/admin/returns/orders/${id}`, 'GET', undefined, sales)).json();
  assert.equal(after.lines[0].returnable, 1);
});

test('return: a whole invoiced order comes back; the credit note gives back the invoice’s tax exactly, and fixes the invoice', { skip }, async () => {
  const owner = await staff('owner');
  await send('/v1/admin/gst/settings', 'PUT', { legalName: 'Vimalnath Sales Corporation', gstin: '27AAPFU0939F1ZV', address: 'Nashik', registrationType: 'regular', invoicePrefix: 'VSC', terms: '' }, owner);
  const buyer = await customer('Sadguru Industries', { gstin: '27BANPK3582R1ZR', state: 'Maharashtra' });
  const id = await order(buyer.device, [
    { ...SSS, qty: 2, mrp: 1500 },
    { ...P2, qty: 1, mrp: 1500 },
  ]);
  const draft = (await (await send('/v1/admin/gst/invoices', 'POST', { orderId: id }, owner)).json()).invoices[0];
  const invoice = (await (await send(`/v1/admin/gst/invoices/${draft.id}/post`, 'POST', undefined, owner)).json()).invoices[0];
  assert.deepEqual([invoice.taxable, invoice.cgst, invoice.sgst, invoice.total], [4500, 405, 405, 5310]);

  let ret = (
    await step(
      owner,
      '',
      refund(
        id,
        [
          { sourcePosition: 0, qty: 2 },
          { sourcePosition: 1, qty: 1 },
        ],
        { reason: 'changed_mind', items: [0, 1].map((position) => ({ source: 'invoice', sourcePosition: position, qty: position ? 1 : 2, condition: 'good' })) },
      ),
    )
  ).returns[0]!;
  assert.deepEqual([ret.invoiceNumber, ret.returnValue, ret.items.map((item) => [item.taxable, item.cgst, item.sgst])], [
    invoice.number,
    5310,
    [
      [3000, 270, 270],
      [1500, 135, 135],
    ],
  ]);
  // Nothing more of the order can come back.
  const again = await answer(await send('/v1/admin/returns', 'POST', { ...refund(id, []), items: [{ source: 'invoice', sourcePosition: 1, qty: 1, condition: 'good' }] }, owner));
  assert.match(again.error.message, /already been returned in full/);

  ret = (await step(owner, `/${ret.id}/status`, { to: 'approved', version: ret.version })).returns[0]!;
  ret = (await step(owner, `/${ret.id}/receive`, { version: ret.version })).returns[0]!;
  const year = financialYear(today);
  assert.deepEqual([ret.creditNote!.number, ret.creditNote!.taxable, ret.creditNote!.cgst, ret.creditNote!.sgst, ret.creditNote!.total], [`CN-${year}-1`, 4500, 405, 405, 5310]);
  const notes = (await (await send('/v1/admin/returns/credit-notes', 'GET', undefined, owner)).json()) as CreditNote[];
  assert.deepEqual([notes.length, notes[0]!.invoiceNumber, notes[0]!.items.length], [1, invoice.number, 2]);
  // The invoice can't be cancelled while a credit note stands against it.
  const cancel = await answer(await send(`/v1/admin/gst/invoices/${invoice.id}/cancel`, 'POST', { reason: 'test' }, owner));
  assert.match(cancel.error.message, /Credit note CN-.* is issued against this invoice/);
});

test('replacement: dearer goods, the customer pays the difference; never below stock unless allowed', { skip }, async () => {
  const owner = await staff('owner');
  const buyer = await customer('Shoaib');
  const id = await order(buyer.device, [{ ...SSS, qty: 10, mrp: 1500 }]);
  await setStock(SSS, 0);
  await setStock(BM, 2);
  let ret = (
    await step(owner, '', {
      ...refund(id, [{ sourcePosition: 0, qty: 4 }]),
      kind: 'replacement',
      reason: 'wrong_size',
      replacementItems: [{ ...BM, qty: 4, rate: 1700, gstRate: 18 }],
    })
  ).returns[0]!;
  assert.deepEqual([ret.returnValue, ret.replacementValue, ret.settleAmount], [6000, 6800, -800]);
  ret = (await step(owner, `/${ret.id}/status`, { to: 'approved', version: ret.version })).returns[0]!;
  ret = (await step(owner, `/${ret.id}/receive`, { version: ret.version })).returns[0]!;

  // Only 2 BM in stock: refused, until negative stock is allowed (or it's restocked).
  const short = await answer(await send(`/v1/admin/returns/${ret.id}/replace`, 'POST', { version: ret.version }, owner));
  assert.match(short.error.message, /Only 2 pcs of .* in stock/);
  await setStock(BM, 10);
  ret = (await step(owner, `/${ret.id}/replace`, { version: ret.version })).returns[0]!;
  assert.equal(ret.status, 'replaced');
  assert.equal((await stock(BM)).available, 6);

  // The difference comes in; refunds out are refused, and so is more than is owed.
  assert.match((await answer(await send(`/v1/admin/returns/${ret.id}/refunds`, 'POST', { version: ret.version, amount: 100, method: 'cash' }, owner))).error.message, /Nothing is owed to the customer/);
  assert.match((await answer(await send(`/v1/admin/returns/${ret.id}/refunds`, 'POST', { version: ret.version, direction: 'in', amount: 900, method: 'upi' }, owner))).error.message, /more than is left to collect \(₹800\)/);
  ret = (await step(owner, `/${ret.id}/refunds`, { version: ret.version, direction: 'in', amount: 800, method: 'upi', reference: 'UPI 4471', complete: true })).returns[0]!;
  // Closing waits for the goods back to be checked.
  assert.match((await answer(await send(`/v1/admin/returns/${ret.id}/status`, 'POST', { to: 'closed', version: ret.version }, owner))).error.message, /Check every returned item/);
  ret = (await step(owner, `/${ret.id}/inspect`, { version: ret.version, items: [{ position: 0, outcome: 'restock' }] })).returns[0]!;
  ret = (await step(owner, `/${ret.id}/status`, { to: 'closed', version: ret.version })).returns[0]!;
  assert.equal(ret.status, 'closed');
  assert.equal((await stock(SSS)).available, 4);
});

test('replacement: cheaper goods give store credit, spent later on an order; equal value settles itself', { skip }, async () => {
  const owner = await staff('owner');
  const buyer = await customer('Aabhi Glass');
  const id = await order(buyer.device, [
    { ...BM, qty: 2, mrp: 1700 },
    { ...SSS, qty: 1, mrp: 1500 },
  ]);
  await setStock(SSS, 10);
  let cheaper = (await step(owner, '', { ...refund(id, [{ sourcePosition: 0, qty: 2 }]), kind: 'replacement', replacementItems: [{ ...SSS, qty: 2, rate: 1500, gstRate: 18 }] })).returns[0]!;
  assert.equal(cheaper.settleAmount, 400);
  cheaper = (await step(owner, `/${cheaper.id}/status`, { to: 'approved', version: cheaper.version })).returns[0]!;
  cheaper = (await step(owner, `/${cheaper.id}/receive`, { version: cheaper.version })).returns[0]!;
  cheaper = (await step(owner, `/${cheaper.id}/replace`, { version: cheaper.version })).returns[0]!;
  cheaper = (await step(owner, `/${cheaper.id}/refunds`, { version: cheaper.version, amount: 400, method: 'store_credit', complete: true })).returns[0]!;
  assert.deepEqual(await (await send(`/v1/admin/returns/store-credit/${buyer.id}`, 'GET', undefined, owner)).json(), { available: 400 });

  // Spent on another order: up to what they hold.
  const another = await order(buyer.device, [{ ...SSS, qty: 1, mrp: 1500 }], 'confirmed');
  const spent = await send('/v1/admin/orders/payments', 'POST', { payments: [{ orderId: another, amount: 300, method: 'store_credit', paidOn: today }] }, owner);
  assert.equal(spent.status, 201);
  const over = await answer(await send('/v1/admin/orders/payments', 'POST', { payments: [{ orderId: another, amount: 200, method: 'store_credit', paidOn: today }] }, owner));
  assert.match(over.error.message, /₹100 of store credit, less than ₹200/);

  // Same price: once the goods are swapped and checked, it closes with no money either way.
  let same = (await step(owner, '', { ...refund(id, [{ sourcePosition: 1, qty: 1 }]), kind: 'replacement', replacementItems: [{ ...P2, qty: 1, rate: 1500, gstRate: 18 }] })).returns[0]!;
  assert.equal(same.settleAmount, 0);
  same = (await step(owner, `/${same.id}/status`, { to: 'approved', version: same.version })).returns[0]!;
  same = (await step(owner, `/${same.id}/receive`, { version: same.version })).returns[0]!;
  same = (await step(owner, `/${same.id}/replace`, { version: same.version })).returns[0]!;
  same = (await step(owner, `/${same.id}/inspect`, { version: same.version, items: [{ position: 0, outcome: 'restock' }] })).returns[0]!;
  same = (await step(owner, `/${same.id}/status`, { to: 'closed', version: same.version })).returns[0]!;
  assert.equal(same.status, 'closed');
});

test('refunds: partial, never more than owed, and set against another order’s balance as a payment that stays', { skip }, async () => {
  const owner = await staff('owner');
  const buyer = await customer('Partial');
  const id = await order(buyer.device, [{ ...SSS, qty: 2, mrp: 1500 }]);
  const other = await order(buyer.device, [{ ...P2, qty: 2, mrp: 1500 }]);
  let ret = (await step(owner, '', refund(id, [{ sourcePosition: 0, qty: 2 }]))).returns[0]!;
  ret = (await step(owner, `/${ret.id}/status`, { to: 'approved', version: ret.version })).returns[0]!;
  // Money waits for the goods.
  assert.equal((await send(`/v1/admin/returns/${ret.id}/refunds`, 'POST', { version: ret.version, amount: 1000, method: 'cash' }, owner)).status, 409);
  ret = (await step(owner, `/${ret.id}/receive`, { version: ret.version })).returns[0]!;
  ret = (await step(owner, `/${ret.id}/inspect`, { version: ret.version, items: [{ position: 0, outcome: 'restock' }] })).returns[0]!;

  ret = (await step(owner, `/${ret.id}/refunds`, { version: ret.version, amount: 1000, method: 'cash', complete: true })).returns[0]!;
  assert.equal(ret.status, 'inspected');
  assert.match((await answer(await send(`/v1/admin/returns/${ret.id}/refunds`, 'POST', { version: ret.version, amount: 2500, method: 'upi' }, owner))).error.message, /more than is left to refund \(₹2,000\)/);
  // A pending refund, then completed from its own step: against the customer's other order.
  ret = (await step(owner, `/${ret.id}/refunds`, { version: ret.version, amount: 2000, method: 'adjustment', orderId: other })).returns[0]!;
  assert.equal(ret.status, 'inspected');
  const pending = ret.refunds!.find((one) => one.status === 'pending')!;
  const done = await step(owner, `/refunds/${pending.id}/status`, { to: 'completed' });
  assert.equal(done.returns[0]!.status, 'refunded');
  const paid = done.orders[0]!.payments!;
  assert.deepEqual([paid[0]!.amount, paid[0]!.method, paid[0]!.note], [2000, 'return', `Return ${ret.number}`]);
  const remove = await answer(await send(`/v1/admin/orders/payments/${paid[0]!.id}`, 'DELETE', undefined, owner));
  assert.match(remove.error.message, /is return RET-.*’s refund/);
});

test('return: damaged goods never reach saleable stock; a rejected return frees its quantity', { skip }, async () => {
  const owner = await staff('owner');
  const buyer = await customer('Damaged');
  const id = await order(buyer.device, [{ ...SSS, qty: 3, mrp: 1500 }]);
  await setStock(SSS, 5);
  let ret = (await step(owner, '', refund(id, [{ sourcePosition: 0, qty: 2, condition: 'damaged' }]))).returns[0]!;
  ret = (await step(owner, `/${ret.id}/status`, { to: 'approved', version: ret.version })).returns[0]!;
  ret = (await step(owner, `/${ret.id}/receive`, { version: ret.version })).returns[0]!;
  // Back on sale only with a reason, as it came back damaged.
  const unexplained = await answer(await send(`/v1/admin/returns/${ret.id}/inspect`, 'POST', { version: ret.version, items: [{ position: 0, outcome: 'restock' }] }, owner));
  assert.match(unexplained.error.message, /came back damaged. Say why/);
  ret = (await step(owner, `/${ret.id}/inspect`, { version: ret.version, items: [{ position: 0, outcome: 'damaged' }] })).returns[0]!;
  assert.deepEqual(await stock(SSS), { available: 5, held: 0, damaged: 2, defective: 0 });

  // Rejected, with a reason; the last one can then come back on another return.
  let rejected = (await step(owner, '', refund(id, [{ sourcePosition: 0, qty: 1 }]))).returns[0]!;
  assert.match((await answer(await send(`/v1/admin/returns/${rejected.id}/status`, 'POST', { to: 'rejected', version: rejected.version }, owner))).error.message, /Say why/);
  rejected = (await step(owner, `/${rejected.id}/status`, { to: 'rejected', version: rejected.version, note: 'Used and scratched' })).returns[0]!;
  assert.equal(rejected.status, 'rejected');
  assert.equal((await send(`/v1/admin/returns/${rejected.id}/receive`, 'POST', { version: rejected.version }, owner)).status, 409);
  const source = await (await send(`/v1/admin/returns/orders/${id}`, 'GET', undefined, owner)).json();
  assert.equal(source.lines[0].returnable, 1);
});

test('return: two people at once, one wins; approved goods are fixed; a cancelled return puts its stock back', { skip }, async () => {
  const [first, second] = [await staff('owner'), await staff('owner')];
  const buyer = await customer('Twice');
  const id = await order(buyer.device, [{ ...SSS, qty: 2, mrp: 1500 }]);
  await setStock(SSS, 5);
  let ret = (await step(first, '', refund(id, [{ sourcePosition: 0, qty: 2 }]))).returns[0]!;
  ret = (await step(first, `/${ret.id}/status`, { to: 'approved', version: ret.version })).returns[0]!;
  const edit = await answer(await send(`/v1/admin/returns/${ret.id}`, 'PUT', { ...refund(id, [{ sourcePosition: 0, qty: 1 }]), version: ret.version }, first));
  assert.match(edit.error.message, /is approved, so its goods can’t change/);

  // Both receive from the same screen at the same moment: one does, the other is told it just changed.
  const results = await Promise.all([first, second].map((headers) => send(`/v1/admin/returns/${ret.id}/receive`, 'POST', { version: ret.version }, headers)));
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409]);
  const [moves] = await sql`select count(*)::int as count from stock_moves where return_id = ${Number(ret.id)}`;
  assert.equal(moves!.count, 1);
  assert.deepEqual(await stock(SSS), { available: 5, held: 2, damaged: 0, defective: 0 });

  // Cancelled after it came in: a reversal takes the held stock back out.
  const detail = (await (await send(`/v1/admin/returns/${ret.id}`, 'GET', undefined, first)).json()) as { return: SalesReturn };
  const cancelled = (await step(first, `/${detail.return.id}/status`, { to: 'cancelled', version: detail.return.version, note: 'Customer kept them' })).returns[0]!;
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(await stock(SSS), { available: 5, held: 0, damaged: 0, defective: 0 });
});

test('supplier return: against a received bill, out of stock on dispatch, the credit note lowers what the shop owes', { skip }, async () => {
  const owner = await staff('owner');
  await setStock(P2, 0);
  const supplier = await (await send('/v1/admin/suppliers', 'POST', { name: 'Ganesh Hardware', state: 'Maharashtra' }, owner)).json();
  const bill = (
    await (await send('/v1/admin/purchases', 'POST', { supplierId: supplier.id, billDate: today, items: [{ ...P2, qty: 10, unit: 'pcs', rate: 1000, gstRate: 18 }], receive: true }, owner)).json()
  ).purchases[0];
  assert.equal((await stock(P2)).available, 10);

  let ret = (await answer(await send('/v1/admin/supplier-returns', 'POST', { purchaseId: Number(bill.id), returnDate: today, reason: 'defective', items: [{ purchasePosition: 0, qty: 3 }] }, owner))).supplierReturns[0]!;
  assert.deepEqual([ret.number, ret.status, ret.taxable, ret.tax, ret.total], ['SRN-0001', 'draft', 3000, 540, 3540]);
  const tooMany = await answer(await send('/v1/admin/supplier-returns', 'POST', { purchaseId: Number(bill.id), returnDate: today, reason: 'defective', items: [{ purchasePosition: 0, qty: 8 }] }, owner));
  assert.match(tooMany.error.message, /Only 7 pcs/);

  const move = async (to: string, extra: Record<string, unknown> = {}) => (ret = (await answer(await send(`/v1/admin/supplier-returns/${ret.id}/status`, 'POST', { to, version: ret.version, ...extra }, owner))).supplierReturns[0]!);
  await move('approved');
  await move('dispatched', { challan: 'DC-17' });
  assert.deepEqual([ret.status, ret.challan, (await stock(P2)).available], ['dispatched', 'DC-17', 7]);
  ret = (await answer(await send(`/v1/admin/supplier-returns/${ret.id}/credit-note`, 'POST', { version: ret.version, number: 'GH/CN/22', date: today, amount: 3540, tax: 540 }, owner))).supplierReturns[0]!;
  const suppliers = await (await send('/v1/admin/suppliers', 'GET', undefined, owner)).json();
  const owed = suppliers.find((one: { id: number }) => one.id === supplier.id);
  assert.deepEqual([owed.billed, owed.credited, owed.outstanding], [11800, 3540, 8260]);
  ret = (await answer(await send(`/v1/admin/supplier-returns/${ret.id}/settle`, 'POST', { version: ret.version, settlement: 'adjust' }, owner))).supplierReturns[0]!;
  await move('closed');
  assert.equal(ret.status, 'closed');
});

test('replacement on an invoiced order: a credit note for the goods back, and a tax invoice drafted for the goods given', { skip }, async () => {
  const owner = await staff('owner');
  await send('/v1/admin/gst/settings', 'PUT', { legalName: 'Vimalnath Sales Corporation', gstin: '27AAPFU0939F1ZV', address: 'Nashik', registrationType: 'regular', invoicePrefix: 'VSC', terms: '' }, owner);
  const buyer = await customer('Swap Buyer', { gstin: '27BANPK3582R1ZR', state: 'Maharashtra' });
  const id = await order(buyer.device, [{ ...SSS, qty: 4, mrp: 1500 }]);
  await setStock(BM, 10);
  const draft = (await (await send('/v1/admin/gst/invoices', 'POST', { orderId: id }, owner)).json()).invoices[0];
  const invoice = (await (await send(`/v1/admin/gst/invoices/${draft.id}/post`, 'POST', undefined, owner)).json()).invoices[0];
  assert.equal(invoice.total, 7080);

  let ret = (
    await step(owner, '', {
      kind: 'replacement',
      orderId: id,
      returnDate: today,
      reason: 'wrong_product',
      items: [{ source: 'invoice', sourcePosition: 0, qty: 2, condition: 'unopened' }],
      replacementItems: [{ ...BM, qty: 2, rate: 1700, gstRate: 18 }],
    })
  ).returns[0]!;
  // 2 × ₹1,500 + 18% back; 2 × ₹1,700 + 18% given: the customer pays ₹472.
  assert.deepEqual([ret.returnValue, ret.replacementValue, ret.settleAmount], [3540, 4012, -472]);
  ret = (await step(owner, `/${ret.id}/status`, { to: 'approved', version: ret.version })).returns[0]!;
  ret = (await step(owner, `/${ret.id}/receive`, { version: ret.version })).returns[0]!;
  assert.equal(ret.creditNote?.total, 3540);
  ret = (await step(owner, `/${ret.id}/replace`, { version: ret.version })).returns[0]!;
  assert.deepEqual([ret.replacementInvoice?.status, ret.replacementInvoice?.total], ['draft', 4012]);

  // Posted, it takes the next number, and the order's bill stays the original invoice's.
  const posted = (await (await send(`/v1/admin/gst/invoices/${ret.replacementInvoice!.id}/post`, 'POST', undefined, owner)).json()).invoices[0];
  assert.equal(posted.returnNumber, ret.number);
  assert.match(posted.number, /^VSC-\d{2}-\d{2}-\d+$/);
  const [bill] = await sql`select bill_amount from orders where id = ${id}`;
  assert.equal(bill!.bill_amount, 7080);
});

test('the Accountant: GST, purchases, suppliers, supplier returns, refunds and credit notes; not GST settings; Sales none of the books', { skip }, async () => {
  const accountant = await staff('accountant');
  for (const path of ['/v1/admin/gst/settings', '/v1/admin/gst/invoices', '/v1/admin/gst/payments', '/v1/admin/purchases', '/v1/admin/suppliers', '/v1/admin/supplier-returns', '/v1/admin/returns', '/v1/admin/returns/credit-notes']) {
    assert.equal((await send(path, 'GET', undefined, accountant)).status, 200, path);
  }
  // The shop's GST registration stays the Owner's.
  assert.equal((await send('/v1/admin/gst/settings', 'PUT', { legalName: 'X' }, accountant)).status, 403);
  assert.equal((await send('/v1/admin/returns/settings', 'PUT', {}, accountant)).status, 403);
  // Refunds are theirs whatever Return Settings say; approving returns isn't.
  const settings = { permissions: { create: ['sales'], approve: [], receive: ['inventory'], inspect: ['inventory'], refund: [] } } as unknown as Parameters<typeof can>[0];
  assert.deepEqual([can(settings, 'accountant', 'refund'), can(settings, 'accountant', 'approve'), can(settings, 'sales', 'refund')], [true, false, false]);

  const sales = await staff('sales');
  for (const path of ['/v1/admin/gst/settings', '/v1/admin/gst/invoices', '/v1/admin/purchases', '/v1/admin/suppliers', '/v1/admin/supplier-returns', '/v1/admin/returns/credit-notes']) {
    assert.equal((await send(path, 'GET', undefined, sales)).status, 403, path);
  }
});
