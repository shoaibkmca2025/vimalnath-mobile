import assert from 'node:assert/strict';
import { test } from 'node:test';

import { creditNoteHsnLines, hsnSummary, salesHsnLines, summary3b } from '../src/data/gst.ts';
import { actionsFor, moneyOf, periodOf, priceReplacement, priceReturned, returnSummary } from '../src/data/returns.ts';
import type { CreditNote, ReturnSettings, SalesInvoice, SalesReturn, SupplierReturn } from '../src/data/types.ts';

const settings: ReturnSettings = {
  eligibilityDays: 30,
  requireApproval: true,
  allowReplacements: true,
  refundApproval: false,
  eligibleCategories: [],
  restockRule: 'inspect',
  damagedHandling: 'keep',
  allowNegativeStock: false,
  replacementTax: 'invoice',
  creditNoteOnReceipt: true,
  returnPrefix: 'RET',
  creditNotePrefix: 'CN',
  supplierReturnPrefix: 'SRN',
  refundMethods: ['cash', 'upi', 'bank', 'cheque', 'original', 'store_credit', 'adjustment'],
  terms: '',
  permissions: { create: ['sales'], approve: [], receive: ['inventory'], inspect: ['inventory'], refund: [] },
};

const item = (extra: Partial<SalesReturn['items'][number]> = {}): SalesReturn['items'][number] => ({
  position: 0,
  source: 'order',
  sourcePosition: 0,
  productId: 'p1',
  option: 'SSS',
  description: 'TGH-55',
  name: 'H Type Handle · SSS',
  hsn: '8302',
  unit: 'pcs',
  qty: 2,
  rate: 1500,
  gstRate: 18,
  taxable: 3000,
  cgst: 0,
  sgst: 0,
  igst: 0,
  amount: 3000,
  condition: 'good',
  ...extra,
});
const ret = (extra: Partial<SalesReturn> = {}): SalesReturn => ({
  id: '1',
  number: 'RET-0001',
  kind: 'refund',
  orderId: '1',
  orderNumber: 'VSC-0059',
  customerName: 'Sadguru Industries',
  returnDate: '2026-11-20',
  reason: 'damaged',
  status: 'pending',
  returnValue: 3000,
  replacementValue: 0,
  charges: 0,
  settleAmount: 3000,
  flags: [],
  attachments: [],
  version: 1,
  createdBy: 'Asha',
  createdAt: '',
  updatedAt: '',
  items: [item()],
  ...extra,
});

test('returns: each person is offered only the steps their role and the return’s status allow', () => {
  assert.deepEqual(actionsFor(ret(), settings, 'sales'), ['edit', 'cancel']);
  assert.deepEqual(actionsFor(ret(), settings, 'owner'), ['approve', 'reject', 'review', 'edit', 'cancel']);
  assert.deepEqual(actionsFor(ret({ status: 'approved' }), settings, 'inventory'), ['receive']);
  assert.deepEqual(actionsFor(ret({ status: 'received' }), settings, 'inventory'), ['inspect']);
  // Checked, nothing paid yet: an owner refunds; closing waits for the money.
  const checked = ret({ status: 'inspected', items: [item({ outcome: 'restock' })] });
  assert.deepEqual(actionsFor(checked, settings, 'owner'), ['refund', 'cancel']);
  const paid = { ...checked, status: 'refunded' as const, refunds: [{ id: 'r', direction: 'out' as const, amount: 3000, method: 'cash' as const, status: 'completed' as const, createdBy: 'Asha', createdAt: '' }] };
  assert.deepEqual(actionsFor(paid, settings, 'owner'), ['close']);
});

test('returns: money settled, partly paid, and what a dearer replacement still needs from the customer', () => {
  const partly = moneyOf({ settleAmount: 3000, refunds: [{ id: '1', direction: 'out', amount: 1000, method: 'cash', status: 'completed', createdBy: '', createdAt: '' }, { id: '2', direction: 'out', amount: 500, method: 'upi', status: 'pending', createdBy: '', createdAt: '' }] });
  assert.deepEqual([partly.paidOut, partly.leftOut, partly.pendingOut, partly.open, partly.settled], [1000, 1500, 2000, 1, false]);
  const dearer = moneyOf({ settleAmount: -800, refunds: [{ id: '1', direction: 'in', amount: 800, method: 'upi', status: 'completed', createdBy: '', createdAt: '' }] });
  assert.deepEqual([dearer.paidIn, dearer.leftIn, dearer.settled], [800, 0, true]);
  assert.equal(moneyOf({ settleAmount: 0 }).settled, true);
});

test('returns: a whole invoiced line gives back exactly its tax; part of one, its share; replacements priced like an invoice', () => {
  const line = { source: 'invoice' as const, qty: 10, rate: 1189.85, taxable: 11898.5, cgst: 1070.87, sgst: 1070.87, igst: 0 };
  assert.deepEqual(priceReturned(line, 10), { taxable: 11898.5, tax: 2141.74, amount: 14040.24 });
  assert.deepEqual(priceReturned(line, 4), { taxable: 4759.4, tax: 856.7, amount: 5616.1 });
  assert.deepEqual(priceReturned({ ...line, source: 'order', rate: 1500 }, 2, 1450), { taxable: 2900, tax: 0, amount: 2900 });
  assert.equal(priceReplacement([{ qty: 4, rate: 1700, discountPct: 0, gstRate: 18 }], true, false).total, 8024);
  assert.equal(priceReplacement([{ qty: 4, rate: 1700, discountPct: 10, gstRate: 18 }], false, false).total, 6120);
});

test('returns dashboard: counts by stage, units and refunds; rejected and cancelled count as requests, not returns', () => {
  const summary = returnSummary([
    ret(),
    ret({ id: '2', status: 'refunded', reason: 'defective', refunds: [{ id: 'r', direction: 'out', amount: 3000, method: 'cash', status: 'completed', createdBy: '', createdAt: '' }] }),
    ret({ id: '3', kind: 'replacement', status: 'approved', items: [item({ qty: 4, condition: 'unopened' })] }),
    ret({ id: '4', status: 'rejected' }),
  ]);
  assert.deepEqual([summary.total, summary.pending, summary.approved, summary.completed, summary.rejected, summary.items, summary.refunded, summary.replacements], [4, 1, 1, 1, 1, 8, 3000, 1]);
  assert.deepEqual(summary.reasons, [
    ['damaged', 2],
    ['defective', 1],
  ]);
  assert.deepEqual(summary.products[0], { name: 'H Type Handle · SSS', qty: 8, unit: 'pcs', value: 9000, returns: 3 });
  assert.deepEqual(periodOf('week', '2026-11-26'), { from: '2026-11-23', to: '2026-11-26' });
  assert.deepEqual(periodOf('fy', '2027-02-10'), { from: '2026-04-01', to: '2027-02-10' });
});

test('GST: credit notes come off the period’s outward supplies and the HSN summary; suppliers’ credit notes off the credit', () => {
  const invoice = {
    id: '1',
    orderId: '1',
    orderNumber: 'VSC-1',
    number: 'VSC-26-27-412',
    invoiceDate: '2026-11-05',
    status: 'posted',
    customerName: 'Sadguru',
    interstate: false,
    taxable: 24270.5,
    cgst: 2184.35,
    sgst: 2184.35,
    igst: 0,
    roundOff: -0.2,
    total: 28639,
    createdBy: 'Asha',
    createdAt: '',
    items: [{ productId: 'p1', option: '', description: 'TAP-45', detail: '', hsn: '76042100', qty: 10, unit: 'pcs', rate: 2245, discountPct: 47, amount: 11898.5, gstRate: 18, taxable: 24270.5, cgst: 2184.35, sgst: 2184.35, igst: 0 }],
  } as SalesInvoice;
  const note = {
    id: '1',
    number: 'CN-26-27-1',
    noteDate: '2026-11-20',
    status: 'posted',
    returnId: '1',
    returnNumber: 'RET-0001',
    invoiceId: '1',
    invoiceNumber: 'VSC-26-27-412',
    invoiceDate: '2026-11-05',
    orderId: '1',
    customerName: 'Sadguru',
    placeOfSupply: 'Maharashtra',
    posCode: '27',
    interstate: false,
    sellerGstin: '27ANRPB6999H2Z7',
    taxable: 4759.4,
    cgst: 428.35,
    sgst: 428.35,
    igst: 0,
    roundOff: -0.1,
    total: 5616,
    createdBy: 'Asha',
    createdAt: '',
    items: [{ productId: 'p1', option: '', description: 'TAP-45', hsn: '76042100', qty: 4, unit: 'pcs', rate: 1189.85, gstRate: 18, taxable: 4759.4, cgst: 428.35, sgst: 428.35, igst: 0 }],
  } as CreditNote;
  const credited = { status: 'credited', creditNoteDate: '2026-11-21', creditNoteTax: 540, interstate: false } as SupplierReturn;
  const range = { from: '2026-11-01', to: '2026-11-30', label: 'November 2026' };
  const summary = summary3b([invoice], [], [], range, { notes: [note], supplierReturns: [credited] });
  assert.deepEqual([summary.outward.taxable, summary.outward.heads.cgst, summary.creditNotes.notes, summary.supplierCredits.cgst, summary.supplierCredits.sgst], [19511.1, 1756, 1, 270, 270]);
  const [row] = hsnSummary([...salesHsnLines([invoice]), ...creditNoteHsnLines([note])]);
  assert.deepEqual([row!.qty, row!.taxable, row!.heads.cgst], [6, 19511.1, 1756]);
});
