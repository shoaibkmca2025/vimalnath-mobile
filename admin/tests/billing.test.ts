import assert from 'node:assert/strict';
import { test } from 'node:test';

import { balanceOf, billingSummary, discountGroups, discountsOf, judge, measure, pageRule, quotationState, rangeOf, ruleFor, rulesOn, suggested } from '../src/data/billing.ts';
import { computeInvoice } from '../src/data/gst.ts';
import type { DiscountRule, Quotation, SalesInvoice } from '../src/data/types.ts';

const rule = (extra: Partial<DiscountRule>): DiscountRule => ({
  id: 1,
  scope: 'default',
  categoryId: null,
  productId: null,
  option: '',
  label: 'Default',
  enabled: true,
  type: 'percentage',
  minPct: 0,
  maxPct: 100,
  defaultPct: 0,
  minAmount: 0,
  maxAmount: null,
  defaultAmount: 0,
  staffMaxPct: null,
  staffMaxAmount: null,
  requiresApproval: false,
  startsOn: null,
  endsOn: null,
  note: '',
  updatedBy: null,
  updatedAt: '2026-11-01T00:00:00Z',
  ...extra,
});

const invoice = (extra: Partial<SalesInvoice>): SalesInvoice => ({
  id: '1',
  invoiceDate: '2026-11-20',
  status: 'posted',
  source: 'counter',
  customerName: 'A',
  interstate: false,
  taxable: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  roundOff: 0,
  total: 1000,
  items: [],
  createdBy: 'x',
  createdAt: '2026-11-20T00:00:00Z',
  ...extra,
});

test('the editor works a bill out exactly as the server will (server/tests/billing.test.ts)', () => {
  const figures = computeInvoice(
    [
      { qty: 4, rate: 1500, discountPct: 10, discountAmount: 100, gstRate: 18 },
      { qty: 2, rate: 250, discountPct: 0, gstRate: 18 },
      { qty: 1, rate: 300, discountPct: 0, gstRate: 18, lineType: 'charge' as const },
    ],
    false,
    { billDiscount: 580 },
  );
  assert.deepEqual(
    figures.lines.map((line) => [line.amount, line.billDiscount, line.taxable]),
    [
      [5300, 530, 4770],
      [500, 50, 450],
      [300, 0, 300],
    ],
  );
  // Grand total = taxable + GST + round off: 5,520 + 993.60 + 0.40.
  assert.deepEqual([figures.taxable, figures.cgst, figures.sgst, figures.roundOff, figures.total], [5520, 496.8, 496.8, 0.4, 6514]);
  const inclusive = computeInvoice([{ qty: 1, rate: 1180, discountPct: 0, gstRate: 18 }], false, { inclusive: true });
  assert.deepEqual([inclusive.taxable, inclusive.cgst, inclusive.sgst, inclusive.total], [1000, 90, 90, 1180]);
  // A bill discount larger than the goods is held at their value.
  assert.equal(computeInvoice([{ qty: 1, rate: 100, discountPct: 0, gstRate: 18 }], false, { billDiscount: 500 }).taxable, 0);
});

test('discounts: the product’s rule first (when on), then its category’s, then the default; only within its dates', () => {
  const rules = [
    rule({ id: 1, scope: 'default', minPct: 0, maxPct: 5 }),
    rule({ id: 2, scope: 'category', categoryId: 'glass', label: 'Glass', minPct: 5, maxPct: 15, defaultPct: 10 }),
    rule({ id: 3, scope: 'product', productId: 'p1', option: 'BM', label: 'p1 BM', minPct: 10, maxPct: 12 }),
    rule({ id: 4, scope: 'category', categoryId: 'locks', label: 'Locks', startsOn: '2026-12-01' }),
  ];
  const on = rulesOn(rules, '2026-11-27');
  assert.equal(ruleFor(on, true, { productId: 'p1', option: 'BM', categoryId: 'glass' })?.id, 3);
  assert.equal(ruleFor(on, false, { productId: 'p1', option: 'BM', categoryId: 'glass' })?.id, 2);
  assert.equal(ruleFor(on, true, { productId: 'p1', option: 'SSS', categoryId: 'glass' })?.id, 2);
  // Locks' rule starts in December, so in November locks follow the default.
  assert.equal(ruleFor(on, true, { productId: 'p9', option: '', categoryId: 'locks' })?.id, 1);
  assert.equal(ruleFor(rulesOn(rules, '2026-12-02'), true, { productId: 'p9', option: '', categoryId: 'locks' })?.id, 4);
  // Typed by hand: no product, no category, the default.
  assert.equal(ruleFor(on, true, { productId: '', option: '', categoryId: null })?.id, 1);
  assert.deepEqual(suggested(rules[1]!), { pct: 10, amount: 0 });
  assert.equal(rangeOf(rules[1]!), '5% to 15%');
});

test('discounts: outside the range is a problem; above the giver’s limit needs approval; Owners and admins only the range', () => {
  const glass = rule({ scope: 'category', categoryId: 'glass', label: 'Glass Hardware', minPct: 5, maxPct: 15, defaultPct: 10, staffMaxPct: 10 });
  const at = (pct: number) => {
    const line = { qty: 2, rate: 1000, discountPct: pct, discountAmount: 0, gstRate: 18, lineType: 'goods' as const, taxable: 2000 * (1 - pct / 100) };
    return { line, measured: measure(line, false) };
  };
  const low = at(2);
  assert.equal(judge(glass, low.line, low.measured).problem, 'Glass Hardware: 5% to 15% discount (this is 2%).');
  const twelve = at(12);
  assert.deepEqual(judge(glass, twelve.line, twelve.measured, { level: 'staff', limitPct: null }), { problem: null, limit: 10 });
  assert.deepEqual(judge(glass, twelve.line, twelve.measured, { level: 'manager', limitPct: 14 }), { problem: null, limit: null });
  assert.deepEqual(judge(glass, twelve.line, twelve.measured, { level: 'manager', limitPct: 11 }), { problem: null, limit: 11 });
  assert.deepEqual(judge(glass, twelve.line, twelve.measured, { level: 'owner', limitPct: null }), { problem: null, limit: null });
  // Approval asked above the suggested 10% when the rule says so.
  const strict = { ...glass, staffMaxPct: null, requiresApproval: true };
  assert.equal(judge(strict, twelve.line, twelve.measured, { level: 'staff', limitPct: null }).limit, 10);
  // No discount allowed at all; a ₹ discount on a %-only rule; a charge is never judged.
  assert.match(judge({ ...glass, enabled: false }, twelve.line, twelve.measured).problem ?? '', /No discount is allowed/);
  assert.match(judge(glass, { ...twelve.line, discountAmount: 50 }, twelve.measured).problem ?? '', /% discounts only/);
  assert.deepEqual(judge(glass, { ...low.line, lineType: 'charge' }, low.measured), { problem: null, limit: null });
});

test('discounts: ₹ off each unit, a rate with GST in it, and a bill discount’s share all count before GST', () => {
  const perUnit = rule({ type: 'amount', label: 'Hinges', scope: 'category', categoryId: 'h', minAmount: 10, maxAmount: 50 });
  const line = { qty: 4, rate: 500, discountPct: 0, discountAmount: 240, gstRate: 18, lineType: 'goods' as const, taxable: 1760 };
  const measured = measure(line, false);
  assert.deepEqual(measured, { base: 2000, value: 240, effectivePct: 12, perUnit: 60 });
  assert.match(judge(perUnit, line, measured).problem ?? '', /₹10 to ₹50 off each unit \(this is ₹60\)/);
  // ₹1,180 with GST is ₹1,000 before it: 10% off is ₹100.
  assert.deepEqual(measure({ qty: 1, rate: 1180, discountPct: 10, gstRate: 18, taxable: 900 }, true), { base: 1000, value: 100, effectivePct: 10, perUnit: 118 });
  // The whole bill's discount: each goods line's, the charge's none.
  const figures = computeInvoice(
    [
      { qty: 4, rate: 1500, discountPct: 10, discountAmount: 100, gstRate: 18 },
      { qty: 2, rate: 250, discountPct: 0, gstRate: 18 },
      { qty: 1, rate: 300, discountPct: 0, gstRate: 18, lineType: 'charge' as const },
    ],
    false,
    { billDiscount: 580 },
  );
  const discounts = discountsOf({ items: figures.lines });
  // 6,000 → 4,770 is 1,230 off; 500 → 450 is 50 off.
  assert.deepEqual(
    discounts.lines.map((one) => one?.value ?? null),
    [1230, 50, null],
  );
  assert.equal(discounts.total, 1280);
});

test('billing dashboard: what’s owed and where each bill stands', () => {
  const today = '2026-11-27';
  const bills = [
    invoice({ id: 'a', total: 1000, paid: 1000, invoiceDate: today }),
    invoice({ id: 'b', total: 2000, paid: 500, invoiceDate: '2026-11-10' }),
    invoice({ id: 'c', total: 3000, paid: 0, invoiceDate: '2026-11-01', dueDate: '2026-11-15' }),
    invoice({ id: 'd', total: 4000, paid: 0, invoiceDate: '2026-10-30' }),
    invoice({ id: 'e', total: 900, status: 'cancelled', invoiceDate: today }),
    invoice({ id: 'f', total: 700, status: 'draft', invoiceDate: today }),
  ];
  assert.deepEqual(
    bills.map((bill) => balanceOf(bill, today)),
    [
      { paid: 1000, balance: 0, status: 'paid' },
      { paid: 500, balance: 1500, status: 'partial' },
      { paid: 0, balance: 3000, status: 'overdue' },
      { paid: 0, balance: 4000, status: 'unpaid' },
      { paid: 0, balance: 0, status: 'paid' },
      { paid: 0, balance: 700, status: 'unpaid' },
    ],
  );
  assert.deepEqual(billingSummary(bills, today), {
    total: 4,
    today: 1000,
    todayCount: 1,
    month: 6000,
    monthCount: 3,
    paid: 1,
    unpaid: 2,
    partial: 1,
    overdue: 1,
    outstanding: 8500,
    cancelled: 1,
    drafts: 1,
  });
});

test('discount report: grouped by category, staff or day, largest first, with each group’s average', () => {
  const line = (invoiceId: string, categoryLabel: string, by: string, base: number, discount: number) => ({ invoiceId, categoryLabel, by, base, discount });
  const groups = discountGroups([line('1', 'Glass', 'Asha', 2000, 200), line('1', 'Locks', 'Asha', 1000, 50), line('2', 'Glass', 'Ravi', 3000, 450)], (one) => one.categoryLabel);
  assert.deepEqual(groups, [
    { key: 'Glass', label: 'Glass', lines: 2, bills: 2, base: 5000, discount: 650, pct: 13 },
    { key: 'Locks', label: 'Locks', lines: 1, bills: 1, base: 1000, discount: 50, pct: 5 },
  ]);
  assert.deepEqual(
    discountGroups([line('1', 'Glass', 'Asha', 2000, 200), line('2', 'Glass', 'Ravi', 3000, 450)], (one) => one.by).map((group) => [group.label, group.discount]),
    [
      ['Ravi', 450],
      ['Asha', 200],
    ],
  );
});

test('quotations expire after their date unless decided; bills print on the paper chosen', () => {
  const quote = { status: 'sent', validUntil: '2026-11-20' } as Quotation;
  assert.equal(quotationState(quote, '2026-11-27'), 'expired');
  assert.equal(quotationState({ ...quote, status: 'accepted' }, '2026-11-27'), 'accepted');
  assert.equal(quotationState({ ...quote, validUntil: '2026-12-01' }, '2026-11-27'), 'sent');
  assert.equal(pageRule('thermal'), '@page { size: 80mm auto; margin: 3mm; }');
  assert.equal(pageRule('A5'), '@page { size: A5 portrait; margin: 7mm; }');
});
