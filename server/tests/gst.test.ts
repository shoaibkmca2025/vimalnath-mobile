import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Purchase, SalesInvoice } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { customerRoutes } from '../src/customers.ts';
import { financialYear, gstRoutes, stateCode, taxLines } from '../src/gst.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { purchaseRoutes, supplierRoutes } from '../src/purchases.ts';
import { adminRoutes, issuePasswordLink, sha256 } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('gst', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  await sql`insert into stock_items (product_id, option_label, hsn, gst_rate, unit) values ('p1', 'SSS', '8302', 18, 'pcs')`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/orders', orderAdminRoutes(sql));
  admin.route('/customers', customerRoutes(sql));
  admin.route('/purchases', purchaseRoutes(sql));
  admin.route('/suppliers', supplierRoutes(sql));
  admin.route('/gst', gstRoutes(sql));
  app.route('/v1/admin', admin);
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });
type Answer = { invoices: SalesInvoice[]; purchases: Purchase[]; error: { message: string; field?: string } };
const answer = async (res: Response) => (await res.json()) as Answer;

async function owner() {
  const email = `owner${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Owner ${next}`}, ${email}, 'owner') returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

/** A confirmed order of 2 × p1 SSS (MRP ₹1,500 each) for a customer with these GST details; its bill can be set. */
async function order(gst: { gstin?: string; state?: string }, bill?: number) {
  const label = `Buyer ${++next}`;
  const [customer] = await sql`insert into customers (name, gstin, state, billing_address) values (${label}, ${gst.gstin ?? ''}, ${gst.state ?? ''}, '12 MG Road, Pune') returning id`;
  const [device] = await sql`insert into app_devices (label, token_hash, customer_id) values (${label}, ${sha256(`t${next}`)}, ${customer!.id}) returning id`;
  const [row] = await sql`
    insert into orders (number, device_id, client_event_id, client_order_id, customer, total, bill_amount, placed_at, status)
    values (${`VSC-9${next}`}, ${device!.id}, ${`e${next}`}, ${`o${next}`}, ${label}, 3000, ${bill ?? null}, now(), 'confirmed') returning id`;
  await sql`insert into order_lines (order_id, position, product_id, code, name, option, qty, mrp) values (${row!.id}, 0, 'p1', 'TGH-55', 'H Type Handle', 'SSS', 2, 1500)`;
  return row!.id as number;
}

const settings = { legalName: 'Vimalnath Sales Corporation', tradeName: 'Vimalnath', gstin: '27AAPFU0939F1ZV', address: 'Shop 4, Pune', pincode: '411001', registrationType: 'regular', invoicePrefix: 'vsc', terms: '' };

test('tax: GST is worked out of the GST-inclusive amount, split CGST + SGST inside the state, IGST outside', () => {
  assert.deepEqual(taxLines([{ amount: 3000, gstRate: 18 }], false), [{ amount: 3000, gstRate: 18, taxable: 2542.37, cgst: 228.82, sgst: 228.81, igst: 0 }]);
  assert.deepEqual(taxLines([{ amount: 3000, gstRate: 18 }], true), [{ amount: 3000, gstRate: 18, taxable: 2542.37, cgst: 0, sgst: 0, igst: 457.63 }]);
  assert.equal(financialYear('2026-11-21'), '26-27');
  assert.equal(financialYear('2027-03-31'), '26-27');
  assert.equal(financialYear('2027-04-01'), '27-28');
  assert.equal(stateCode('29AABCU9603R1ZM'), '29');
  assert.equal(stateCode('', 'maharashtra'), '27');
  assert.equal(stateCode('', 'Atlantis'), '');
});

test('invoice: from an order, at the bill, with HSN and rate from Stock; posting numbers it per financial year', { skip }, async () => {
  const headers = await owner();
  const local = await order({ gstin: '27AAACR5055K1Z7' }, 2950);
  const draft = (await answer(await send('/v1/admin/gst/invoices', 'POST', { orderId: local }, headers))).invoices[0]!;
  assert.deepEqual([draft.status, draft.number, draft.placeOfSupply, draft.interstate, draft.total], ['draft', undefined, 'Maharashtra', false, 2950]);
  assert.deepEqual(draft.items.map((item) => [item.hsn, item.gstRate, item.amount, item.taxable, item.cgst, item.sgst, item.igst]), [['8302', 18, 2950, 2500, 225, 225, 0]]);

  // Without the shop's GSTIN it can't be posted.
  const unset = await send(`/v1/admin/gst/invoices/${draft.id}/post`, 'POST', undefined, headers);
  assert.deepEqual([unset.status, (await answer(unset)).error.message], [400, 'Fill in the shop’s GSTIN and legal name under GST Settings first.']);
  assert.equal((await send('/v1/admin/gst/settings', 'PUT', settings, headers)).status, 200);

  const posted = (await answer(await send(`/v1/admin/gst/invoices/${draft.id}/post`, 'POST', undefined, headers))).invoices[0]!;
  const year = financialYear(new Date().toISOString().slice(0, 10));
  assert.deepEqual([posted.status, posted.number, posted.sellerGstin], ['posted', `VSC/${year}/0001`, '27AAPFU0939F1ZV']);
  assert.equal((await send(`/v1/admin/gst/invoices/${draft.id}`, 'PUT', { invoiceDate: posted.invoiceDate, customerName: 'X', items: posted.items }, headers)).status, 409);
  assert.equal((await send('/v1/admin/gst/invoices', 'POST', { orderId: local }, headers)).status, 409);
  // The invoice fixes the order's bill.
  const billing = await send(`/v1/admin/orders/${local}/billing`, 'PUT', { terms: 'credit', bill: 2000 }, headers);
  assert.deepEqual([billing.status, (await answer(billing)).error.message], [409, `Tax invoice VSC/${year}/0001 fixes this bill. Cancel the invoice to change it.`]);

  // Another state's buyer: IGST, and the next number.
  const other = await order({ gstin: '29AABCU9603R1ZM' });
  const second = (await answer(await send('/v1/admin/gst/invoices', 'POST', { orderId: other }, headers))).invoices[0]!;
  assert.deepEqual([second.placeOfSupply, second.interstate, second.igst, second.cgst], ['Karnataka', true, 457.63, 0]);
  assert.equal((await answer(await send(`/v1/admin/gst/invoices/${second.id}/post`, 'POST', undefined, headers))).invoices[0]!.number, `VSC/${year}/0002`);

  // Cancelling keeps the number; the order can then be invoiced again, with the next number.
  const cancel = await answer(await send(`/v1/admin/gst/invoices/${draft.id}/cancel`, 'POST', { reason: 'Wrong buyer name' }, headers));
  assert.deepEqual([cancel.invoices[0]!.status, cancel.invoices[0]!.number, cancel.invoices[0]!.cancelReason], ['cancelled', `VSC/${year}/0001`, 'Wrong buyer name']);
  const again = (await answer(await send('/v1/admin/gst/invoices', 'POST', { orderId: local }, headers))).invoices[0]!;
  assert.equal((await answer(await send(`/v1/admin/gst/invoices/${again.id}/post`, 'POST', undefined, headers))).invoices[0]!.number, `VSC/${year}/0003`);
});

test('invoice: an unregistered buyer without a state can’t be posted; a composition dealer issues none', { skip }, async () => {
  const headers = await owner();
  await send('/v1/admin/gst/settings', 'PUT', settings, headers);
  const unknown = await order({});
  const draft = (await answer(await send('/v1/admin/gst/invoices', 'POST', { orderId: unknown }, headers))).invoices[0]!;
  assert.equal((await answer(await send(`/v1/admin/gst/invoices/${draft.id}/post`, 'POST', undefined, headers))).error.message, 'Choose the place of supply: the buyer’s state.');
  const edited = await answer(await send(`/v1/admin/gst/invoices/${draft.id}`, 'PUT', { invoiceDate: draft.invoiceDate, customerName: 'Walk-in buyer', placeOfSupply: 'Maharashtra', items: draft.items }, headers));
  assert.deepEqual([edited.invoices[0]!.posCode, edited.invoices[0]!.interstate], ['27', false]);

  await send('/v1/admin/gst/settings', 'PUT', { ...settings, registrationType: 'composition' }, headers);
  assert.match((await answer(await send(`/v1/admin/gst/invoices/${draft.id}/post`, 'POST', undefined, headers))).error.message, /bill of supply/);
  await send('/v1/admin/gst/settings', 'PUT', settings, headers);
  assert.equal((await send(`/v1/admin/gst/invoices/${draft.id}`, 'DELETE', undefined, headers)).status, 200);
});

test('purchases: IGST or CGST + SGST is fixed when the bill is saved; input tax credit is reviewed, never assumed', { skip }, async () => {
  const headers = await owner();
  await send('/v1/admin/gst/settings', 'PUT', settings, headers);
  const supplier = (await (await send('/v1/admin/suppliers', 'POST', { name: 'Bengaluru Glass', gstin: '29AABCU9603R1ZM' }, headers)).json()) as { id: number };
  const bill = { supplierId: supplier.id, billDate: new Date().toISOString().slice(0, 10), items: [{ productId: 'p1', option: 'SSS', qty: 1, unit: 'pcs', rate: 1000, gstRate: 18 }], receive: true };
  const received = (await answer(await send('/v1/admin/purchases', 'POST', bill, headers))).purchases[0]!;
  assert.deepEqual([received.interstate, received.itcStatus], [true, 'pending']);

  const itc = (body: unknown) => send(`/v1/admin/gst/purchases/${received.id}/itc`, 'PATCH', body, headers);
  assert.equal((await answer(await itc({ status: 'claimed' }))).error.message, 'Pick the return month it’s claimed or reversed in.');
  assert.equal((await itc({ status: 'claimed', period: '2026-11', note: 'In GSTR-2B' })).status, 204);
  const [saved] = (await (await send('/v1/admin/purchases', 'GET', undefined, headers)).json()) as Purchase[];
  assert.deepEqual([saved!.itcStatus, saved!.itcPeriod, saved!.itcNote], ['claimed', '2026-11', 'In GSTR-2B']);
});

test('payments: GST paid is entered from the challan, and needs an amount', { skip }, async () => {
  const headers = await owner();
  assert.equal((await send('/v1/admin/gst/payments', 'POST', { period: '2026-10', paidOn: '2026-11-20', challan: 'CH-1' }, headers)).status, 400);
  assert.equal((await send('/v1/admin/gst/payments', 'POST', { period: '2026-10', paidOn: '2026-11-20', challan: 'CH-1', cpin: '26112700012345', cgst: 1200, sgst: 1200 }, headers)).status, 201);
  const [payment] = (await (await send('/v1/admin/gst/payments', 'GET', undefined, headers)).json()) as { id: string; cgst: number; sgst: number; period: string; paidOn: string }[];
  assert.deepEqual([payment!.period, payment!.paidOn, payment!.cgst, payment!.sgst], ['2026-10', '2026-11-20', 1200, 1200]);
  assert.equal((await send(`/v1/admin/gst/payments/${payment!.id}`, 'DELETE', undefined, headers)).status, 204);
});
