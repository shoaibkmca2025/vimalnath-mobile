import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { DiscountApproval, DiscountReport, SalesInvoice } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { billingRoutes } from '../src/billing.ts';
import { discountRoutes } from '../src/discounts.ts';
import { gstRoutes } from '../src/gst.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

testDatabase('discounts', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  await sql`update gst_settings set legal_name = 'Vimalnath Sales Corporation', gstin = '27AAPFU0939F1ZV', address = 'Nashik'`;
  // A second category, with a product in it, beside the seed's Glass Hardware (p1, p2).
  await sql`insert into categories (id, label, image, image_fit, visible, sort_order) values ('locks', 'Locks & Handles', '/media/l.webp', 'cover', true, 2)`;
  await sql`update products set category_id = 'locks' where id = 'p2'`;
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/gst', gstRoutes(sql));
  admin.route('/billing', billingRoutes(sql));
  admin.route('/discounts', discountRoutes(sql));
  app.route('/v1/admin', admin);
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/v1/admin${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });
type Answer = { invoices: SalesInvoice[]; error: { message: string; field?: string } };

async function staff(role: 'owner' | 'sales', level?: { level: 'admin' | 'manager' | 'staff'; limitPct?: number }) {
  const email = `${role}${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`${role} ${next}`}, ${email}, ${role}) returning id`;
  if (level) await sql`update staff_users set discount_level = ${level.level}, discount_limit_pct = ${level.limitPct ?? null} where id = ${row!.id}`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}
const call = async (headers: Record<string, string>, path: string, body?: unknown, method = 'POST') => {
  const res = await send(path, method, body, headers);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Answer & Record<string, unknown> };
};
async function ok(headers: Record<string, string>, path: string, body?: unknown, method = 'POST') {
  const { status, body: answer } = await call(headers, path, body, method);
  assert.ok(status < 300, `${path}: ${status} ${answer.error?.message}`);
  return answer;
}
const line = (productId: string, option: string, extra: Record<string, unknown> = {}) => ({ productId, option, description: `${productId}-${option}`, qty: 2, unit: 'pcs', rate: 1000, gstRate: 18, ...extra });
const bill = (items: unknown[], extra: Record<string, unknown> = {}) => ({ invoiceDate: today, customerName: 'Walk-in', items, ...extra });
const rule = (body: Record<string, unknown>) => ({ enabled: true, type: 'percentage', ...body });

test('rules: each category its own range; the product’s own rule first; never below the minimum or above the maximum', { skip }, async () => {
  const owner = await staff('owner');
  // Glass Hardware 5–15%, Locks & Handles 0–20%; p1 BM has its own 10–12%.
  await ok(owner, '/discounts/rules', rule({ scope: 'category', categoryId: 'glass', minPct: 5, maxPct: 15, defaultPct: 10 }), 'PUT');
  await ok(owner, '/discounts/rules', rule({ scope: 'category', categoryId: 'locks', minPct: 0, maxPct: 20, defaultPct: 5 }), 'PUT');
  await ok(owner, '/discounts/rules', rule({ scope: 'product', productId: 'p1', option: 'BM', minPct: 10, maxPct: 12, defaultPct: 10 }), 'PUT');

  const low = await call(owner, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 2 })]));
  assert.deepEqual([low.status, low.body.error.message, low.body.error.field], [400, 'Glass Hardware: 5% to 15% discount (this is 2%).', 'items.0.discountPct']);
  const high = await call(owner, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 16 })]));
  assert.match(high.body.error.message, /5% to 15%/);
  const product = await call(owner, '/billing/invoices', bill([line('p1', 'BM', { discountPct: 14 })]));
  assert.match(product.body.error.message, /10% to 12% discount/);

  // Several products in one bill, each in its range; a decimal % kept exactly; GST on the value after the discount.
  const invoice = (await ok(owner, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 12.5 }), line('p1', 'BM', { discountPct: 11 }), line('p2', 'SSS', { discountPct: 20 })]))).invoices[0]!;
  // 2 × 1,000 = 2,000 each: less 12.5% = 1,750; less 11% = 1,780; less 20% = 1,600. Taxable 5,130, GST 923.40, total 6,053.
  assert.deepEqual(
    invoice.items.map((item) => item.taxable),
    [1750, 1780, 1600],
  );
  assert.deepEqual([invoice.taxable, invoice.cgst + invoice.sgst, invoice.total], [5130, 923.4, 6053]);

  // Product rules off: p1 BM follows Glass Hardware again, so 14% is fine.
  await ok(owner, '/discounts/settings', { productRules: false }, 'PUT');
  await ok(owner, '/billing/invoices', bill([line('p1', 'BM', { discountPct: 14 })]));
  await ok(owner, '/discounts/settings', { productRules: true }, 'PUT');
});

test('types: a ₹-only rule takes rupees off each unit; a bill discount counts toward each line’s limit, so it can’t get round it', { skip }, async () => {
  const owner = await staff('owner');
  await ok(owner, '/discounts/rules', rule({ scope: 'category', categoryId: 'locks', type: 'amount', minAmount: 0, maxAmount: 100, defaultAmount: 50 }), 'PUT');
  const percent = await call(owner, '/billing/invoices', bill([line('p2', 'SSS', { discountPct: 5 })]));
  assert.match(percent.body.error.message, /takes ₹ discounts \(off each unit\) only/);
  // ₹150 off 2 units is ₹75 each: within ₹0–100.
  const fixed = (await ok(owner, '/billing/invoices', bill([line('p2', 'SSS', { discountAmount: 150 })]))).invoices[0]!;
  assert.deepEqual([fixed.items[0]!.taxable, fixed.total], [1850, 2183]);
  const over = await call(owner, '/billing/invoices', bill([line('p2', 'SSS', { discountAmount: 300 })]));
  assert.match(over.body.error.message, /₹0 to ₹100 off each unit \(this is ₹150\)/);

  // Glass Hardware is 5–15%: a 10% line with a bill discount that takes it to 20% is refused, on the bill discount.
  const sneaky = await call(owner, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 10 })], { billDiscount: 200 }));
  assert.deepEqual([sneaky.status, sneaky.body.error.field], [400, 'billDiscount']);
  assert.match(sneaky.body.error.message, /this is 20%/);
  // Turned off: no discount at all on that category.
  await ok(owner, '/discounts/rules', rule({ scope: 'category', categoryId: 'locks', enabled: false }), 'PUT');
  assert.match((await call(owner, '/billing/invoices', bill([line('p2', 'SSS', { discountAmount: 10 })]))).body.error.message, /No discount is allowed on Locks & Handles/);
  await ok(owner, '/discounts/rules', rule({ scope: 'category', categoryId: 'locks', minPct: 0, maxPct: 20, defaultPct: 5 }), 'PUT');
});

test('authority: staff up to the staff limit, more waits for approval; a manager to their own limit; an admin approves', { skip }, async () => {
  const owner = await staff('owner');
  const [cashier, manager, admin] = [await staff('sales'), await staff('sales', { level: 'manager', limitPct: 14 }), await staff('sales', { level: 'admin' })];
  await ok(owner, '/discounts/rules', rule({ scope: 'category', categoryId: 'glass', minPct: 5, maxPct: 15, defaultPct: 10, staffMaxPct: 10 }), 'PUT');

  // The cashier gives 13%: saved, but waiting for approval, and the bill can't be finalized yet.
  let invoice = (await ok(cashier, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 13 }), line('p2', 'SSS', { discountPct: 2 })]))).invoices[0]!;
  const blocked = await call(cashier, `/billing/invoices/${invoice.id}/finalize`, { version: invoice.version });
  assert.deepEqual([blocked.status, blocked.body.error.message], [409, 'The discount on p1-SSS is waiting for approval.']);
  const approvals = (await (await send('/discounts/approvals', 'GET', undefined, owner)).json()) as DiscountApproval[];
  const asked = approvals.find((one) => one.invoiceId === invoice.id)!;
  assert.deepEqual([asked.status, asked.effectivePct, asked.authority, approvals.filter((one) => one.invoiceId === invoice.id).length], ['pending', 13, 10, 1]);
  assert.match(asked.requestedBy, /^sales \d+$/);

  // The cashier can't approve; the admin can, and refusing needs a reason.
  assert.equal((await call(cashier, `/discounts/approvals/${asked.id}/decide`, { approve: true })).status, 403);
  assert.match((await call(admin, `/discounts/approvals/${asked.id}/decide`, { approve: false })).body.error.message, /Say why/);
  await ok(admin, `/discounts/approvals/${asked.id}/decide`, { approve: true, reason: 'Regular customer' });
  invoice = ((await (await send(`/billing/invoices/${invoice.id}`, 'GET', undefined, cashier)).json()) as { invoice: SalesInvoice }).invoice;
  // Saving again unchanged keeps the approval; finalizing now goes through.
  invoice = (await ok(cashier, `/billing/invoices/${invoice.id}`, { ...bill([line('p1', 'SSS', { discountPct: 13 }), line('p2', 'SSS', { discountPct: 2 })]), version: invoice.version }, 'PUT')).invoices[0]!;
  invoice = (await ok(cashier, `/billing/invoices/${invoice.id}/finalize`, { version: invoice.version })).invoices[0]!;
  assert.equal(invoice.status, 'posted');

  // A changed discount needs approving again; the old request is withdrawn.
  let second = (await ok(cashier, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 12 })]))).invoices[0]!;
  second = (await ok(cashier, `/billing/invoices/${second.id}`, { ...bill([line('p1', 'SSS', { discountPct: 11 })]), version: second.version }, 'PUT')).invoices[0]!;
  const now = ((await (await send('/discounts/approvals', 'GET', undefined, owner)).json()) as DiscountApproval[]).filter((one) => one.invoiceId === second.id);
  assert.deepEqual(now.map((one) => [one.effectivePct, one.status]).sort(), [
    [11, 'pending'],
    [12, 'withdrawn'],
  ]);

  // The manager may give up to their own 14% without asking; 15% asks. The owner gives 15% straight away.
  assert.equal((await ok(manager, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 14 })]))).invoices[0]!.items.length, 1);
  const managed = (await ok(manager, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 15 })]))).invoices[0]!;
  assert.equal((await call(manager, `/billing/invoices/${managed.id}/finalize`, { version: managed.version })).status, 409);
  const mine = (await ok(owner, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 15 })]))).invoices[0]!;
  assert.equal((await ok(owner, `/billing/invoices/${mine.id}/finalize`, { version: mine.version })).invoices[0]!.status, 'posted');
});

test('history: a finalized bill keeps its rule and discount when the rule changes; the report groups what was given', { skip }, async () => {
  const owner = await staff('owner');
  await ok(owner, '/discounts/rules', rule({ scope: 'category', categoryId: 'glass', minPct: 5, maxPct: 15, defaultPct: 10 }), 'PUT');
  let invoice = (await ok(owner, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 12 })]))).invoices[0]!;
  invoice = (await ok(owner, `/billing/invoices/${invoice.id}/finalize`, { version: invoice.version })).invoices[0]!;
  await ok(owner, '/discounts/rules', rule({ scope: 'category', categoryId: 'glass', minPct: 0, maxPct: 8, defaultPct: 0 }), 'PUT');
  const [kept] = await sql`select rule_min::float8 as min, rule_max::float8 as max, discount_value::float8 as value, effective_pct::float8 as pct, discount_pct::float8 as given from sales_invoice_items where invoice_id = ${Number(invoice.id)}`;
  assert.deepEqual(kept, { min: 5, max: 15, value: 240, pct: 12, given: 12 });
  // A draft under the old rule can't be finalized under the new one.
  const old = (await ok(owner, '/billing/invoices', bill([line('p1', 'SSS', { discountPct: 6 })]))).invoices[0]!;
  await ok(owner, '/discounts/rules', rule({ scope: 'category', categoryId: 'glass', minPct: 0, maxPct: 5, defaultPct: 0 }), 'PUT');
  assert.match((await call(owner, `/billing/invoices/${old.id}/finalize`, { version: old.version })).body.error.message, /0% to 5% discount \(this is 6%\)/);

  const report = (await (await send(`/discounts/report?from=${today}&to=${today}`, 'GET', undefined, owner)).json()) as DiscountReport;
  const ours = report.lines.find((one) => one.invoiceId === invoice.id)!;
  assert.deepEqual([ours.categoryLabel, ours.discount, ours.effectivePct, ours.by, ours.source], ['Glass Hardware', 240, 12, 'owner 7', 'category']);
  assert.ok(report.changes.filter((one) => one.kind === 'rule_changed').length >= 2);
  assert.ok(report.changes.some((one) => one.before && (one.before as { maxPct?: number }).maxPct === 15 && (one.after as { maxPct?: number }).maxPct === 8));
});
