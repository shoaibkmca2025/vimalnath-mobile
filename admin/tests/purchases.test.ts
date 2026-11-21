import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stateOfGstin } from '../src/data/india.ts';
import { balanceOf, dueOf, formatMoney, ledger, parseMoney, payState, purchaseTotals } from '../src/data/purchases.ts';
import type { Purchase, Supplier } from '../src/data/types.ts';
import { purchaseTotals as serverTotals } from '../../server/src/purchases.ts';

const supplier = (extra: Partial<Supplier> = {}): Supplier => ({
  id: 1,
  name: 'Ganesh Glass',
  company: '',
  contactPerson: '',
  phone: '',
  email: '',
  gstin: '',
  address: '',
  state: '',
  openingBalance: 0,
  paymentDays: 30,
  bankDetails: '',
  notes: '',
  archived: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  bills: 0,
  billed: 0,
  paid: 0,
  outstanding: 0,
  lastPurchase: null,
  drafts: 0,
  ...extra,
});

const bill = (id: string, extra: Partial<Purchase> = {}): Purchase => ({
  id,
  number: `PUR-000${id}`,
  supplier: { id: 1, name: 'Ganesh Glass' },
  billDate: '2026-10-10',
  status: 'received',
  items: [],
  freight: 0,
  otherCharges: 0,
  discount: 0,
  roundOff: 0,
  subtotal: 1000,
  tax: 180,
  total: 1180,
  createdBy: 'Asha',
  createdAt: '2026-10-10T10:00:00.000Z',
  ...extra,
});

test('totals: the admin’s preview is the server’s own sum, to the paisa', () => {
  const input = {
    items: [
      { qty: 10, rate: 800, discountPct: 10, gstRate: 18 },
      { qty: 2.5, rate: 120.5, discountPct: 0, gstRate: 5 },
      { qty: 3.333, rate: 19.99, discountPct: 7.5, gstRate: 28 },
    ],
    freight: 250,
    otherCharges: 40,
    discount: 100,
    roundOff: -0.48,
  };
  const server = serverTotals({ ...input, items: input.items.map((item) => ({ ...item, productId: 'x', option: '', unit: 'pcs' as const })) });
  assert.deepEqual(purchaseTotals(input), server);
});

test('payment state: paid, part paid, and overdue once past the supplier’s terms', () => {
  const terms = supplier();
  assert.equal(dueOf(bill('1'), terms), '2026-11-09');
  assert.equal(dueOf(bill('1'), supplier({ paymentDays: null })), null);
  assert.deepEqual(payState(bill('1'), terms, '2026-11-09'), { label: 'Unpaid', tone: 'warning' });
  assert.deepEqual(payState(bill('1'), terms, '2026-11-10'), { label: 'Overdue', tone: 'danger' });
  const part = bill('2', { payments: [{ id: '1', amount: 500, method: 'cash', paidOn: '2026-10-12', by: 'Asha', at: '' }] });
  assert.equal(balanceOf(part), 680);
  assert.equal(payState(part, terms, '2026-10-20').label, 'Part paid');
  assert.equal(payState(bill('3', { payments: [{ id: '2', amount: 1180, method: 'bank', paidOn: '2026-10-12', by: 'Asha', at: '' }] }), terms, '2027-01-01').label, 'Paid');
  assert.equal(balanceOf(bill('4', { status: 'cancelled' })), 0);
});

test('ledger: opening balance, received bills and payments by date, with a running balance', () => {
  const rows = ledger(
    supplier({ openingBalance: 2000 }),
    [bill('1'), bill('2', { status: 'draft', billDate: '2026-10-05' }), bill('3', { status: 'cancelled' }), bill('4', { billDate: '2026-10-20', total: 500 })],
    [
      { id: 'a', amount: 1500, method: 'upi', paidOn: '2026-10-15', by: 'Asha', at: '', purchaseNumber: 'PUR-0001' },
      { id: 'b', amount: 300, method: 'cash', paidOn: '2026-10-02', by: 'Asha', at: '', purchaseNumber: null },
    ],
  );
  assert.deepEqual(
    rows.map((row) => [row.day, row.label, row.billed, row.paid, row.balance]),
    [
      ['2026-10-01', 'Opening balance', 2000, 0, 2000],
      ['2026-10-02', 'Paid on account', 0, 300, 1700],
      ['2026-10-10', 'Bill PUR-0001', 1180, 0, 2880],
      ['2026-10-15', 'Paid for PUR-0001', 0, 1500, 1380],
      ['2026-10-20', 'Bill PUR-0004', 500, 0, 1880],
    ],
  );
});

test('money: typed amounts read as rupees and paise; shown with paise only when there are some', () => {
  assert.equal(parseMoney('1,250.5'), 1250.5);
  assert.equal(parseMoney('₹ 99'), 99);
  assert.equal(parseMoney(''), 0);
  assert.ok(Number.isNaN(parseMoney('12.345')));
  assert.ok(Number.isNaN(parseMoney('', null)));
  assert.equal(formatMoney(125000), '₹1,25,000');
  assert.equal(formatMoney(812.5), '₹812.50');
  assert.equal(formatMoney(-0.4), '−₹0.40');
});

test('GSTIN: its first two digits are the state', () => {
  assert.equal(stateOfGstin('27AAPFU0939F1ZV'), 'Maharashtra');
  assert.equal(stateOfGstin('24AAACC1206D1ZM'), 'Gujarat');
  assert.equal(stateOfGstin('99XXXXX'), undefined);
});
