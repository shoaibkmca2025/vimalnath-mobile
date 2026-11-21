import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Purchase, SalesInvoice } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { customerRoutes } from '../src/customers.ts';
import { computeInvoice, financialYear, gstRoutes, stateCode } from '../src/gst.ts';
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

/** A confirmed order of 2 × p1 SSS (MRP ₹1,500 each) for a customer with these GST details (or an existing customer's phone). */
async function order(gst: { gstin?: string; state?: string; device?: number }, bill?: number) {
  const label = `Buyer ${++next}`;
  const device = gst.device
    ? { id: gst.device }
    : await (async () => {
        const [customer] = await sql`insert into customers (name, gstin, state, billing_address) values (${label}, ${gst.gstin ?? ''}, ${gst.state ?? ''}, '12 MG Road, Pune') returning id`;
        const [row] = await sql`insert into app_devices (label, name, phone, token_hash, customer_id) values (${label}, 'Sunil Kadam', '98220 12345', ${sha256(`t${next}`)}, ${customer!.id}) returning id`;
        return row!;
      })();
  const [row] = await sql`
    insert into orders (number, device_id, client_event_id, client_order_id, customer, total, bill_amount, placed_at, status)
    values (${`VSC-9${next}`}, ${device!.id}, ${`e${next}`}, ${`o${next}`}, ${label}, 3000, ${bill ?? null}, now(), 'confirmed') returning id`;
  await sql`insert into order_lines (order_id, position, product_id, code, name, option, qty, mrp) values (${row!.id}, 0, 'p1', 'TGH-55', 'H Type Handle', 'SSS', 2, 1500)`;
  return row!.id as number;
}

const settings = { legalName: 'Vimalnath Sales Corporation', tradeName: 'Vimalnath', gstin: '27AAPFU0939F1ZV', address: 'Shop 4, Pune', pincode: '411001', registrationType: 'regular', invoicePrefix: 'vsc', terms: '' };

test('tax: the shop’s own invoice VSC-26-27-412, worked out the same to the paisa', () => {
  // Rate before GST, less the line discount; CGST and SGST at 9% each on the total; rounded to the rupee.
  const invoice = computeInvoice(
    [
      { qty: 10, rate: 2245, discountPct: 47, gstRate: 18 },
      { qty: 10, rate: 840, discountPct: 47, gstRate: 18 },
      { qty: 11, rate: 720, discountPct: 0, gstRate: 18 },
    ],
    false,
  );
  assert.deepEqual(
    invoice.lines.map((line) => line.amount),
    [11898.5, 4452, 7920],
  );
  assert.deepEqual([invoice.taxable, invoice.cgst, invoice.sgst, invoice.igst, invoice.roundOff, invoice.total], [24270.5, 2184.35, 2184.35, 0, -0.2, 28639]);
  // The lines' shares add up to each head exactly.
  assert.equal(Math.round(invoice.lines.reduce((total, line) => total + line.cgst, 0) * 100) / 100, 2184.35);
  // Between states, IGST at the full rate.
  const igst = computeInvoice([{ qty: 1, rate: 1000, discountPct: 0, gstRate: 18 }], true);
  assert.deepEqual([igst.igst, igst.cgst, igst.total], [180, 0, 1180]);
  assert.equal(financialYear('2026-11-21'), '26-27');
  assert.equal(financialYear('2027-03-31'), '26-27');
  assert.equal(financialYear('2027-04-01'), '27-28');
  assert.equal(stateCode('29AABCU9603R1ZM'), '29');
  assert.equal(stateCode('', 'maharashtra'), '27');
  assert.equal(stateCode('', 'Atlantis'), '');
});

test('invoice: from an order at MRP with Stock’s HSN; posting carries on the series, VSC-26-27-413 after 412', { skip }, async () => {
  const headers = await owner();
  const local = await order({ gstin: '27AAACR5055K1Z7' });
  const draft = (await answer(await send('/v1/admin/gst/invoices', 'POST', { orderId: local }, headers))).invoices[0]!;
  assert.deepEqual([draft.status, draft.number, draft.placeOfSupply, draft.interstate, draft.total], ['draft', undefined, 'Maharashtra', false, 3540]);
  assert.deepEqual(draft.items.map((item) => [item.description, item.detail, item.hsn, item.gstRate, item.rate, item.discountPct, item.amount, item.cgst, item.sgst]), [
    ['TGH-55', 'H Type Handle · SSS', '8302', 18, 1500, 0, 3000, 270, 270],
  ]);
  assert.deepEqual([draft.details?.buyerContact, draft.details?.buyerPhone, draft.details?.paymentTerms, draft.details?.shipName], ['Sunil Kadam', '98220 12345', 'Credit', draft.customerName]);
  assert.match(draft.details?.reference ?? '', /^VSC-9\d+ dt\. \d{1,2}-[A-Z][a-z]{2}-\d{2}$/);

  // A 47% dealer discount, and the dispatch details.
  const edited = await answer(
    await send(`/v1/admin/gst/invoices/${draft.id}`, 'PUT', { invoiceDate: draft.invoiceDate, customerName: draft.customerName, customerGstin: draft.customerGstin, items: draft.items.map((item) => ({ ...item, discountPct: 47 })), details: { ...draft.details, dispatchedThrough: 'VRL Logistics', dispatchDocNo: '7' } }, headers),
  );
  assert.deepEqual([edited.invoices[0]!.taxable, edited.invoices[0]!.cgst, edited.invoices[0]!.total, edited.invoices[0]!.details?.dispatchedThrough], [1590, 143.1, 1876, 'VRL Logistics']);

  // Without the shop's GSTIN it can't be posted.
  const unset = await send(`/v1/admin/gst/invoices/${draft.id}/post`, 'POST', undefined, headers);
  assert.deepEqual([unset.status, (await answer(unset)).error.message], [400, 'Fill in the shop’s GSTIN and legal name under GST Settings first.']);
  // Carrying on from Tally's last number.
  const saved = (await (await send('/v1/admin/gst/settings', 'PUT', { ...settings, lastInvoiceNumber: 412 }, headers)).json()) as { lastInvoiceNumber: number };
  assert.equal(saved.lastInvoiceNumber, 412);

  const posted = (await answer(await send(`/v1/admin/gst/invoices/${draft.id}/post`, 'POST', undefined, headers))).invoices[0]!;
  const year = financialYear(new Date().toISOString().slice(0, 10));
  assert.deepEqual([posted.status, posted.number, posted.sellerGstin, posted.previousBalance], ['posted', `VSC-${year}-413`, '27AAPFU0939F1ZV', 0]);
  assert.equal((await send('/v1/admin/gst/settings', 'PUT', { ...settings, lastInvoiceNumber: 400 }, headers)).status, 400);
  assert.equal((await send(`/v1/admin/gst/invoices/${draft.id}`, 'PUT', { invoiceDate: posted.invoiceDate, customerName: 'X', items: posted.items }, headers)).status, 409);
  assert.equal((await send('/v1/admin/gst/invoices', 'POST', { orderId: local }, headers)).status, 409);
  // The invoice fixes the order's bill.
  const billing = await send(`/v1/admin/orders/${local}/billing`, 'PUT', { terms: 'credit', bill: 2000 }, headers);
  assert.deepEqual([billing.status, (await answer(billing)).error.message], [409, `Tax invoice VSC-${year}-413 fixes this bill. Cancel the invoice to change it.`]);

  // The same buyer's next invoice prints what they owe: the first invoice's ₹1,876.
  const [placed] = await sql<{ device_id: number }[]>`select device_id from orders where id = ${local}`;
  const device = placed!.device_id;
  const next = await order({ device });
  const second = (await answer(await send('/v1/admin/gst/invoices', 'POST', { orderId: next }, headers))).invoices[0]!;
  const secondPosted = (await answer(await send(`/v1/admin/gst/invoices/${second.id}/post`, 'POST', undefined, headers))).invoices[0]!;
  assert.deepEqual([secondPosted.number, secondPosted.previousBalance], [`VSC-${year}-414`, 1876]);

  // Another state's buyer: IGST.
  const other = await order({ gstin: '29AABCU9603R1ZM' });
  const third = (await answer(await send('/v1/admin/gst/invoices', 'POST', { orderId: other }, headers))).invoices[0]!;
  assert.deepEqual([third.placeOfSupply, third.interstate, third.igst, third.cgst], ['Karnataka', true, 540, 0]);

  // Cancelling keeps the number; the order can then be invoiced again, with the next number.
  const cancel = await answer(await send(`/v1/admin/gst/invoices/${draft.id}/cancel`, 'POST', { reason: 'Wrong buyer name' }, headers));
  assert.deepEqual([cancel.invoices[0]!.status, cancel.invoices[0]!.number, cancel.invoices[0]!.cancelReason], ['cancelled', `VSC-${year}-413`, 'Wrong buyer name']);
  const again = (await answer(await send('/v1/admin/gst/invoices', 'POST', { orderId: local }, headers))).invoices[0]!;
  assert.equal((await answer(await send(`/v1/admin/gst/invoices/${again.id}/post`, 'POST', undefined, headers))).invoices[0]!.number, `VSC-${year}-415`);
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
