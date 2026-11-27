import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { SalesInvoice } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { billingRoutes } from '../src/billing.ts';
import { computeInvoice, financialYear, gstRoutes } from '../src/gst.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { reportRoutes } from '../src/reports.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const year = financialYear(today);

testDatabase('billing', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  await sql`update gst_settings set legal_name = 'Vimalnath Sales Corporation', gstin = '27AAPFU0939F1ZV', address = 'Nashik', invoice_prefix = 'VSC'`;
  await sql`
    insert into stock_items (product_id, option_label, hsn, gst_rate, unit, quantity, selling_price)
    values ('p1', 'SSS', '8302', 18, 'pcs', 10, 1500), ('p1', 'BM', '8302', 18, 'pcs', 5, 1700)`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/gst', gstRoutes(sql));
  admin.route('/billing', billingRoutes(sql));
  admin.route('/reports', reportRoutes(sql));
  app.route('/v1/admin', admin);
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/v1/admin${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });
type Answer = { invoices: SalesInvoice[]; error: { message: string; field?: string } };
const json = async (res: Response) => (await res.json()) as Answer & Record<string, never>;

async function staff(role: 'owner' | 'sales' | 'catalogue' | 'accountant') {
  const email = `${role}${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`${role} ${next}`}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

/** Runs a step that must succeed and gives back the bill as it is after it. */
async function ok(headers: Record<string, string>, path: string, body?: unknown, method = 'POST') {
  const res = await send(path, method, body, headers);
  const answer = await json(res);
  assert.ok(res.ok, `${path}: ${res.status} ${answer.error?.message}`);
  return answer;
}
const SSS = { productId: 'p1', option: 'SSS', description: 'TGH-55-S', detail: 'H Type Handle · SSS', hsn: '8302', unit: 'pcs' };
const stock = async (option = 'SSS') => ((await sql`select quantity::float8 as q from stock_items where product_id = 'p1' and option_label = ${option}`)[0]!.q as number);
const bill = (items: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ invoiceDate: today, customerName: 'Walk-in customer', items, ...extra });

test('GST: line % and fixed discounts, a bill discount before GST, transport taxed, rounded to the rupee; GST-inclusive rates; IGST', { skip }, () => {
  const figures = computeInvoice(
    [
      { qty: 4, rate: 1500, discountPct: 10, discountAmount: 100, gstRate: 18 },
      { qty: 2, rate: 250, discountPct: 0, gstRate: 18 },
      { qty: 1, rate: 300, discountPct: 0, gstRate: 18, lineType: 'charge' as const },
    ],
    false,
    { billDiscount: 580 },
  );
  // 4 × 1,500 less 10% less ₹100 = 5,300; the ₹580 discount shared 530 + 50 over the goods; transport keeps its ₹300.
  assert.deepEqual(
    figures.lines.map((line) => [line.amount, line.billDiscount, line.taxable]),
    [
      [5300, 530, 4770],
      [500, 50, 450],
      [300, 0, 300],
    ],
  );
  assert.deepEqual([figures.taxable, figures.cgst, figures.sgst, figures.roundOff, figures.total], [5520, 496.8, 496.8, 0.4, 6514]);
  // A rate typed with GST in it: ₹1,180 is ₹1,000 and ₹180 GST.
  const inclusive = computeInvoice([{ qty: 1, rate: 1180, discountPct: 0, gstRate: 18 }], false, { inclusive: true });
  assert.deepEqual([inclusive.taxable, inclusive.cgst, inclusive.sgst, inclusive.total], [1000, 90, 90, 1180]);
  assert.deepEqual([computeInvoice([{ qty: 1, rate: 1000, discountPct: 0, gstRate: 28 }], true).igst], [280]);
});

test('bill: an advance on the draft, finalize in the shop’s one series taking stock (not the hand-typed line), part payments, never more than owed', { skip }, async () => {
  const [owner, sales] = [await staff('owner'), await staff('sales')];
  await sql`insert into invoice_counters (series, financial_year, last_number) values ('invoice', ${year}, 412) on conflict (series, financial_year) do update set last_number = 412`;
  const before = await stock();
  let invoice = (
    await ok(
      sales,
      '/billing/invoices',
      bill(
        [
          { ...SSS, qty: 2, rate: 1500, discountPct: 0, gstRate: 18 },
          { description: 'Glass cutting', detail: 'Labour', hsn: '9954', qty: 1, unit: 'pcs', rate: 500, gstRate: 18 },
          { description: 'Transport', hsn: '996511', qty: 1, unit: 'pcs', rate: 200, gstRate: 18, lineType: 'charge' },
        ],
        { customerPhone: '98220 11111', dueDate: today },
      ),
    )
  ).invoices[0]!;
  // 3,000 + 500 + 200 = 3,700 + 18% = 4,366.
  assert.deepEqual([invoice.status, invoice.source, invoice.total, invoice.placeOfSupply, invoice.paid], ['draft', 'counter', 4366, 'Maharashtra', 0]);

  // An advance on the draft, then finalize: VSC-<year>-413, after the order invoices' 412. Stock goes out for p1 only.
  invoice = (await ok(sales, `/billing/invoices/${invoice.id}/payments`, { amount: 1000, method: 'upi', paidOn: today, reference: 'UPI 551' })).invoices[0]!;
  invoice = (await ok(sales, `/billing/invoices/${invoice.id}/finalize`, { version: invoice.version })).invoices[0]!;
  assert.deepEqual([invoice.status, invoice.number, invoice.paid], ['posted', `VSC-${year}-413`, 1000]);
  assert.equal(await stock(), before - 2);
  const moves = await sql`select kind, change::float8 as change from stock_moves where invoice_id = ${Number(invoice.id)}`;
  assert.deepEqual(
    moves.map((move) => [move.kind, move.change]),
    [['billed', -2]],
  );

  // Part payments by card and cash; the rest owed; more than that is refused.
  invoice = (await ok(sales, `/billing/invoices/${invoice.id}/payments`, { amount: 2000, method: 'card', paidOn: today })).invoices[0]!;
  const over = await json(await send(`/billing/invoices/${invoice.id}/payments`, 'POST', { amount: 1500, method: 'cash', paidOn: today }, sales));
  assert.match(over.error.message, /more than the bill still owes \(₹1,366\)/);
  invoice = (await ok(sales, `/billing/invoices/${invoice.id}/payments`, { amount: 1366, method: 'cash', paidOn: today })).invoices[0]!;
  assert.equal(invoice.paid, 4366);

  // Sales can't void a payment or cancel; an Owner voids one with a reason, and it stays on record.
  const detail = (await (await send(`/billing/invoices/${invoice.id}`, 'GET', undefined, owner)).json()) as { payments: { id: string; method: string; voidedAt?: string }[]; events: { kind: string }[] };
  assert.equal((await send(`/billing/payments/${detail.payments[2]!.id}/void`, 'POST', { reason: 'Counted twice' }, sales)).status, 403);
  invoice = (await ok(owner, `/billing/payments/${detail.payments[2]!.id}/void`, { reason: 'Counted twice' })).invoices[0]!;
  assert.equal(invoice.paid, 3000);
  const after = (await (await send(`/billing/invoices/${invoice.id}`, 'GET', undefined, owner)).json()) as { payments: { voidedAt?: string }[]; events: { kind: string }[] };
  assert.equal(after.payments.length, 3);
  assert.ok(after.payments[2]!.voidedAt);
  assert.deepEqual(
    after.events.map((one) => one.kind),
    ['created', 'payment', 'finalized', 'payment', 'payment', 'payment_voided'],
  );

  // The cash book has the card in the bank book, the cash payment voided away.
  const book = (await (await send(`/reports/cash-book?from=${today}&to=${today}`, 'GET', undefined, owner)).json()) as { books: { book: string; in: number }[] };
  assert.deepEqual(
    book.books.map((one) => [one.book, one.in]),
    [
      ['cash', 0],
      ['bank', 3000],
    ],
  );
});

test('stock: never below zero unless allowed; a correction moves only what changed; cancelling gives it back', { skip }, async () => {
  const owner = await staff('owner');
  await sql`update stock_items set quantity = 5 where product_id = 'p1' and option_label = 'BM'`;
  const BM = { ...SSS, option: 'BM', description: 'TGH-55-BM' };
  let invoice = (await ok(owner, '/billing/invoices', bill([{ ...BM, qty: 7, rate: 1700, gstRate: 18 }]))).invoices[0]!;
  const short = await json(await send(`/billing/invoices/${invoice.id}/finalize`, 'POST', { version: invoice.version }, owner));
  assert.match(short.error.message, /Only 5 pcs of .* in stock/);
  invoice = (await ok(owner, `/billing/invoices/${invoice.id}`, { ...bill([{ ...BM, qty: 3, rate: 1700, gstRate: 18 }]), version: invoice.version }, 'PUT')).invoices[0]!;
  invoice = (await ok(owner, `/billing/invoices/${invoice.id}/finalize`, { version: invoice.version })).invoices[0]!;
  assert.equal(await stock('BM'), 2);
  const number = invoice.number;

  // Reopened to correct (an Owner, with a reason), 3 → 4, and finalized again: one more out, same number.
  assert.match((await json(await send(`/billing/invoices/${invoice.id}/reopen`, 'POST', { version: invoice.version }, owner))).error.message, /Say why/);
  invoice = (await ok(owner, `/billing/invoices/${invoice.id}/reopen`, { version: invoice.version, reason: 'Customer took one more' })).invoices[0]!;
  assert.equal(invoice.status, 'draft');
  assert.match((await json(await send(`/billing/invoices/${invoice.id}`, 'DELETE', undefined, owner))).error.message, /isn’t a new draft/);
  invoice = (await ok(owner, `/billing/invoices/${invoice.id}`, { ...bill([{ ...BM, qty: 4, rate: 1700, gstRate: 18 }]), version: invoice.version }, 'PUT')).invoices[0]!;
  invoice = (await ok(owner, `/billing/invoices/${invoice.id}/finalize`, { version: invoice.version })).invoices[0]!;
  assert.deepEqual([invoice.number, invoice.reopenReason, await stock('BM')], [number, 'Customer took one more', 1]);
  // Finalizing twice from the same screen is refused, and moves nothing.
  assert.equal((await send(`/billing/invoices/${invoice.id}/finalize`, 'POST', { version: invoice.version! - 1 }, owner)).status, 409);
  assert.equal(await stock('BM'), 1);

  // Cancelled: all four back.
  invoice = (await ok(owner, `/billing/invoices/${invoice.id}/cancel`, { version: invoice.version, reason: 'Wrong customer' })).invoices[0]!;
  assert.deepEqual([invoice.status, await stock('BM')], ['cancelled', 5]);

  // Below zero when the bill allows it.
  invoice = (await ok(owner, '/billing/invoices', bill([{ ...BM, qty: 6, rate: 1700, gstRate: 18 }], { allowNegativeStock: true }))).invoices[0]!;
  invoice = (await ok(owner, `/billing/invoices/${invoice.id}/finalize`, { version: invoice.version })).invoices[0]!;
  assert.equal(await stock('BM'), -1);
  // A bill with payments can't be cancelled until they're voided.
  invoice = (await ok(owner, `/billing/invoices/${invoice.id}/payments`, { amount: 100, method: 'cash', paidOn: today })).invoices[0]!;
  assert.match((await json(await send(`/billing/invoices/${invoice.id}/cancel`, 'POST', { version: invoice.version, reason: 'x' }, owner))).error.message, /has payments/);
});

test('units: the shop adds its own; a counted item is billed in its stock unit; customers aren’t duplicated', { skip }, async () => {
  const owner = await staff('owner');
  const units = (await ok(owner, '/billing/units', { label: 'Bundle', print: 'BDL' })) as unknown as { units: { code: string }[] };
  assert.ok(units.units.some((unit) => unit.code === 'bundle'));
  const invoice = (await ok(owner, '/billing/invoices', bill([{ description: 'PVC beading', qty: 3, unit: 'bundle', rate: 120, gstRate: 18 }]))).invoices[0]!;
  assert.equal(invoice.items[0]!.unit, 'bundle');
  const wrong = await json(await send('/billing/invoices', 'POST', bill([{ ...SSS, unit: 'box', qty: 1, rate: 1500, gstRate: 18 }]), owner));
  assert.match(wrong.error.message, /is counted in PCS: bill it in PCS/);
  const unknown = await json(await send('/billing/invoices', 'POST', bill([{ description: 'X', qty: 1, unit: 'crate', rate: 10, gstRate: 18 }]), owner));
  assert.match(unknown.error.message, /isn’t one of the shop’s units/);
  assert.equal((await send('/billing/units/bundle', 'DELETE', undefined, owner)).status, 409);

  const made = (await (await send('/billing/customers', 'POST', { name: 'Shree Glass', phone: '+91 98200 12345', gstin: '29AAPFU0939F1ZV' }, owner)).json()) as { customer: { id: number }; existing: boolean };
  assert.equal(made.existing, false);
  const again = (await (await send('/billing/customers', 'POST', { name: 'Shree Glass Works', phone: '098200-12345' }, owner)).json()) as { customer: { id: number }; existing: boolean };
  assert.deepEqual([again.existing, again.customer.id], [true, made.customer.id]);
  const found = (await (await send('/billing/customers?q=82001', 'GET', undefined, owner)).json()) as { id: number; state: string }[];
  assert.deepEqual([found[0]!.id, found[0]!.state], [made.customer.id, 'Karnataka']);
  // Their state is Karnataka: IGST.
  const igst = (await ok(owner, '/billing/invoices', bill([{ description: 'Hinges', qty: 1, unit: 'pcs', rate: 1000, gstRate: 18 }], { customerId: made.customer.id, customerName: 'Shree Glass', customerGstin: '29AAPFU0939F1ZV' }))).invoices[0]!;
  assert.deepEqual([igst.interstate, igst.igst, igst.cgst], [true, 180, 0]);
});

test('quotations: their own series, accepted, then an invoice draft with the same lines; duplicating a bill', { skip }, async () => {
  const sales = await staff('sales');
  const quote = ((await ok(sales, '/billing/quotations', { ...bill([{ ...SSS, qty: 2, rate: 1500, gstRate: 18 }]), validUntil: today })) as unknown as { quotations: { id: string; number: string; total: number; version: number; status: string }[] }).quotations[0]!;
  assert.deepEqual([quote.number, quote.total], [`QTN-${year}-1`, 3540]);
  const sent = ((await ok(sales, `/billing/quotations/${quote.id}/status`, { to: 'sent', version: quote.version })) as unknown as { quotations: { version: number; status: string }[] }).quotations[0]!;
  const converted = (await ok(sales, `/billing/quotations/${quote.id}/convert`, { version: sent.version })) as unknown as Answer & { quotations: { status: string; invoiceId: string }[] };
  const draft = converted.invoices[0]!;
  assert.deepEqual([draft.status, draft.total, draft.quotationNumber, converted.quotations[0]!.status, converted.quotations[0]!.invoiceId], ['draft', 3540, `QTN-${year}-1`, 'converted', draft.id]);
  assert.equal((await send(`/billing/quotations/${quote.id}/convert`, 'POST', { version: sent.version + 1 }, sales)).status, 409);

  const copy = (await ok(sales, `/billing/invoices/${draft.id}/duplicate`)).invoices[0]!;
  assert.deepEqual([copy.status, copy.total, copy.duplicateOf, copy.items.length], ['draft', 3540, draft.id, 1]);
});

test('roles and GST treatment: Sales bill but don’t reopen; Catalogue can’t bill; a composition dealer’s bills carry no GST', { skip }, async () => {
  const [owner, sales, catalogue] = [await staff('owner'), await staff('sales'), await staff('catalogue')];
  assert.equal((await send('/billing/invoices', 'GET', undefined, catalogue)).status, 403);
  let invoice = (await ok(sales, '/billing/invoices', bill([{ description: 'Lock', qty: 1, unit: 'pcs', rate: 1000, gstRate: 18 }]))).invoices[0]!;
  invoice = (await ok(sales, `/billing/invoices/${invoice.id}/finalize`, { version: invoice.version })).invoices[0]!;
  assert.equal((await send(`/billing/invoices/${invoice.id}/reopen`, 'POST', { version: invoice.version, reason: 'x' }, sales)).status, 403);
  assert.equal((await send(`/billing/invoices/${invoice.id}/cancel`, 'POST', { version: invoice.version, reason: 'x' }, sales)).status, 403);
  assert.equal((await send('/billing/settings', 'PUT', {}, sales)).status, 403);

  await sql`update gst_settings set registration_type = 'composition'`;
  const supply = (await ok(owner, '/billing/invoices', bill([{ description: 'Lock', qty: 1, unit: 'pcs', rate: 1000, gstRate: 18 }]))).invoices[0]!;
  assert.deepEqual([supply.items[0]!.gstRate, supply.cgst, supply.total], [0, 0, 1000]);
  assert.equal((await ok(owner, `/billing/invoices/${supply.id}/finalize`, { version: supply.version })).invoices[0]!.status, 'posted');
  await sql`update gst_settings set registration_type = 'regular'`;
});
