import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeInvoice, financialYear, gstr1, hsnSummary, invoiceHsnTable, purchaseHeads, rangeOf, summary3b, utilise } from '../src/data/gst.ts';
import type { CreditNote, Purchase, SalesInvoice } from '../src/data/types.ts';
import { rupeesInWords } from '../src/lib/words.ts';

test('set-off: IGST credit first, then CGST and SGST credit, never CGST against SGST', () => {
  // IGST credit covers IGST, then goes where CGST and SGST credit fall short.
  const first = utilise({ igst: 1000, cgst: 3000, sgst: 3000 }, { igst: 2500, cgst: 2000, sgst: 3000 });
  assert.deepEqual(first.cash, { igst: 0, cgst: 0, sgst: 0 });
  assert.deepEqual(first.steps, [
    { from: 'igst', to: 'igst', amount: 1000 },
    // 1,000 where CGST credit falls short, then the 500 left (IGST credit is used up before the others) on CGST.
    { from: 'igst', to: 'cgst', amount: 1500 },
    { from: 'cgst', to: 'cgst', amount: 1500 },
    { from: 'sgst', to: 'sgst', amount: 3000 },
  ]);
  assert.deepEqual(first.carried, { igst: 0, cgst: 500, sgst: 0 });

  // Spare CGST credit pays IGST, but can't pay SGST: that's cash.
  const second = utilise({ igst: 800, cgst: 500, sgst: 1500 }, { igst: 0, cgst: 2000, sgst: 0 });
  assert.deepEqual(second.cash, { igst: 0, cgst: 0, sgst: 1500 });
  assert.deepEqual(second.carried, { igst: 0, cgst: 700, sgst: 0 });
});

const invoice = (extra: Partial<SalesInvoice>): SalesInvoice => ({
  id: '1',
  orderId: '1',
  orderNumber: 'VSC-0001',
  invoiceDate: '2026-11-10',
  status: 'posted',
  customerName: 'Laude',
  interstate: false,
  taxable: 2542.37,
  cgst: 228.82,
  sgst: 228.81,
  igst: 0,
  roundOff: 0,
  total: 3000,
  items: [{ productId: 'p1', option: 'SSS', description: 'Handle', detail: '', hsn: '8302', qty: 2, unit: 'pcs', rate: 1271.19, discountPct: 0, amount: 2542.37, gstRate: 18, taxable: 2542.37, cgst: 228.82, sgst: 228.81, igst: 0 }],
  createdBy: 'Asha',
  createdAt: '',
  ...extra,
});

const bill = (extra: Partial<Purchase>): Purchase => ({
  id: 'b1',
  number: 'PUR-0001',
  supplier: { id: 1, name: 'Ganesh' },
  billDate: '2026-11-05',
  status: 'received',
  items: [{ productId: 'p1', option: 'SSS', name: 'Handle', code: 'H', qty: 10, unit: 'pcs', rate: 100, discountPct: 0, gstRate: 18 }],
  freight: 0,
  otherCharges: 0,
  discount: 0,
  roundOff: 0,
  subtotal: 1000,
  tax: 180,
  total: 1180,
  createdBy: 'Asha',
  createdAt: '',
  interstate: false,
  itcStatus: 'claimed',
  itcPeriod: '2026-11',
  ...extra,
});

test('GSTR-3B: posted invoices in the month; credit claimed in it; drafts, cancelled and pending left out', () => {
  const november = rangeOf('month', '2026-11-21');
  const summary = summary3b(
    [invoice({}), invoice({ id: '2', status: 'cancelled' }), invoice({ id: '3', status: 'draft' }), invoice({ id: '4', invoiceDate: '2026-10-31' })],
    [bill({}), bill({ id: 'b2', itcStatus: 'pending' }), bill({ id: 'b3', itcStatus: 'ineligible', tax: 50 }), bill({ id: 'b4', interstate: true, itcStatus: 'claimed', tax: 90 })],
    [{ id: 'g', period: '2026-11', paidOn: '2026-12-18', challan: '', cpin: '', cin: '', cgst: 100, sgst: 100, igst: 0, cess: 0, interest: 0, penalty: 0, note: '', attachment: null, by: 'Asha', at: '' }],
    november,
  );
  assert.deepEqual(summary.outward, { taxable: 2542.37, heads: { igst: 0, cgst: 228.82, sgst: 228.81 }, invoices: 1 });
  assert.deepEqual(summary.itc, { igst: 90, cgst: 90, sgst: 90 });
  assert.deepEqual(summary.ineligible, { igst: 0, cgst: 25, sgst: 25 });
  assert.equal(summary.pendingBills, 1);
  // IGST credit 90 pays CGST first (CGST credit 90 can't cover 228.82), then CGST credit, SGST credit.
  assert.deepEqual(summary.utilisation.cash, { igst: 0, cgst: 48.82, sgst: 138.81 });
  assert.deepEqual([summary.paid.cgst, summary.paid.sgst], [100, 100]);
});

test('periods: financial years start in April; ranges for this and last month and year', () => {
  assert.deepEqual(financialYear('2027-02-01'), { label: '26-27', from: '2026-04-01', to: '2027-03-31', start: 2026 });
  assert.deepEqual(rangeOf('previous', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31', label: 'December 2025' });
  assert.equal(rangeOf('month', '2028-02-10').to, '2028-02-29');
  assert.deepEqual([rangeOf('previousFy', '2026-11-21').from, rangeOf('previousFy', '2026-11-21').to], ['2025-04-01', '2026-03-31']);
  // 2026-11-25 is a Wednesday; 2026-03-01 a Sunday, so its week began in February.
  assert.deepEqual(rangeOf('today', '2026-11-25'), { from: '2026-11-25', to: '2026-11-25', label: 'Today' });
  assert.deepEqual(rangeOf('yesterday', '2026-03-01'), { from: '2026-02-28', to: '2026-02-28', label: 'Yesterday' });
  assert.deepEqual(rangeOf('week', '2026-11-25'), { from: '2026-11-23', to: '2026-11-29', label: 'This week' });
  assert.deepEqual([rangeOf('week', '2026-03-01').from, rangeOf('week', '2026-03-01').to], ['2026-02-23', '2026-03-01']);
  assert.deepEqual(rangeOf('quarter', '2026-11-25'), { from: '2026-10-01', to: '2026-12-31', label: 'Oct–Dec 2026' });
  assert.deepEqual(rangeOf('previousQuarter', '2026-02-10'), { from: '2025-10-01', to: '2025-12-31', label: 'Oct–Dec 2025' });
  assert.deepEqual(rangeOf('quarter', '2027-05-05'), { from: '2027-04-01', to: '2027-06-30', label: 'Apr–Jun 2027' });
});

test('HSN summary: grouped by HSN and rate, with each group’s documents counted once', () => {
  const rows = hsnSummary([
    { hsn: '8302', description: 'Handle', unit: 'pcs', qty: 2, taxable: 100, rate: 18, heads: { igst: 0, cgst: 9, sgst: 9 }, document: 'a' },
    { hsn: '8302', description: 'Hinge', unit: 'pcs', qty: 3, taxable: 200, rate: 18, heads: { igst: 0, cgst: 18, sgst: 18 }, document: 'a' },
    { hsn: '7007', description: 'Glass', unit: 'sqft', qty: 40, taxable: 1000, rate: 18, heads: { igst: 180, cgst: 0, sgst: 0 }, document: 'b' },
  ]);
  assert.deepEqual(rows.map((row) => [row.hsn, row.qty, row.documents, row.taxable, row.value]), [
    ['7007', 40, 1, 1000, 1180],
    ['8302', 5, 1, 300, 354],
  ]);
  assert.deepEqual(purchaseHeads(bill({ tax: 180.01 })), { igst: 0, cgst: 90.01, sgst: 90 });
});

test('amount in words: as the shop’s invoices print it, the Indian way', () => {
  assert.equal(rupeesInWords(28639), 'INR Twenty Eight Thousand Six Hundred Thirty Nine Only');
  assert.equal(rupeesInWords(4368.7), 'INR Four Thousand Three Hundred Sixty Eight and Seventy paise Only');
  assert.equal(rupeesInWords(125430), 'INR One Lakh Twenty Five Thousand Four Hundred Thirty Only');
  assert.equal(rupeesInWords(23500000.5), 'INR Two Crore Thirty Five Lakh and Fifty paise Only');
  assert.equal(rupeesInWords(0.29), 'INR Zero and Twenty Nine paise Only');
  assert.equal(rupeesInWords(0), 'INR Zero Only');
});

test('invoice: VSC-26-27-412 to the paisa, with its HSN table', () => {
  const lines = [
    { hsn: '76042100', qty: 10, rate: 2245, discountPct: 47, gstRate: 18 },
    { hsn: '76042100', qty: 10, rate: 840, discountPct: 47, gstRate: 18 },
    { hsn: '76042990', qty: 11, rate: 720, discountPct: 0, gstRate: 18 },
  ];
  const figures = computeInvoice(lines, false);
  assert.deepEqual(
    figures.lines.map((line) => line.amount),
    [11898.5, 4452, 7920],
  );
  assert.deepEqual([figures.taxable, figures.cgst, figures.sgst, figures.igst, figures.roundOff, figures.total], [24270.5, 2184.35, 2184.35, 0, -0.2, 28639]);
  assert.deepEqual(
    invoiceHsnTable(figures.lines).map((row) => [row.hsn, row.taxable, row.heads.cgst, row.heads.sgst, row.tax]),
    [
      ['76042100', 16350.5, 1471.55, 1471.55, 2943.1],
      ['76042990', 7920, 712.8, 712.8, 1425.6],
    ],
  );
  assert.deepEqual([computeInvoice([{ qty: 1, rate: 1000, discountPct: 0, gstRate: 18 }], true).igst, computeInvoice([{ qty: 1, rate: 1000, discountPct: 0, gstRate: 18 }], true).total], [180, 1180]);
});

test('GSTR-1: B2B per invoice and rate, B2C Large over ₹1 lakh inter-state, B2C Small net of its credit notes, CDNR, CDNUR and documents', () => {
  const line = (gstRate: number, taxable: number, interstate: boolean) => {
    const tax = Math.round(taxable * gstRate) / 100;
    return { gstRate, taxable, igst: interstate ? tax : 0, cgst: interstate ? 0 : tax / 2, sgst: interstate ? 0 : tax / 2 };
  };
  const invoice = (id: string, number: string, extra: Partial<SalesInvoice>, items: ReturnType<typeof line>[]) =>
    ({ id, number, invoiceDate: '2026-11-10', status: 'posted', customerName: `Buyer ${id}`, interstate: false, posCode: '27', placeOfSupply: 'Maharashtra', total: items.reduce((sum, item) => sum + item.taxable + item.igst + item.cgst + item.sgst, 0), items, ...extra }) as unknown as SalesInvoice;
  const invoices = [
    invoice('a', 'VSC-26-27-9', { customerGstin: '27AAPFU0939F1ZV' }, [line(18, 1000, false), line(5, 200, false)]),
    invoice('b', 'VSC-26-27-10', { interstate: true, posCode: '29', placeOfSupply: 'Karnataka' }, [line(18, 150000, true)]),
    invoice('c', 'VSC-26-27-11', {}, [line(18, 1000, false)]),
    invoice('d', 'VSC-26-27-12', { interstate: true, posCode: '29', placeOfSupply: 'Karnataka' }, [line(18, 4000, true)]),
    invoice('e', 'VSC-26-27-13', { status: 'cancelled' }, [line(18, 500, false)]),
    invoice('f', 'VSC-26-27-14', { invoiceDate: '2026-12-01' }, [line(18, 999, false)]),
  ];
  const note = (number: string, invoiceId: string, extra: Partial<CreditNote>, items: ReturnType<typeof line>[]) =>
    ({ number, invoiceId, invoiceNumber: invoices.find((one) => one.id === invoiceId)!.number, noteDate: '2026-11-20', status: 'posted', customerName: 'x', posCode: '27', placeOfSupply: 'Maharashtra', interstate: false, total: 1, items, ...extra }) as unknown as CreditNote;
  const notes = [
    note('CN-26-27-1', 'c', {}, [line(18, 200, false)]),
    note('CN-26-27-2', 'a', { customerGstin: '27AAPFU0939F1ZV' }, [line(5, 200, false)]),
    note('CN-26-27-3', 'b', { interstate: true, posCode: '29', placeOfSupply: 'Karnataka' }, [line(18, 10000, true)]),
  ];
  const report = gstr1(invoices, notes, rangeOf('month', '2026-11-25'));

  assert.deepEqual(report.b2b.map((row) => [row.number, row.rate, row.taxable, row.cgst]), [['VSC-26-27-9', 5, 200, 5], ['VSC-26-27-9', 18, 1000, 90]], 'one row per rate');
  assert.deepEqual(report.b2cl.map((row) => [row.number, row.pos, row.taxable, row.igst]), [['VSC-26-27-10', '29-Karnataka', 150000, 27000]]);
  assert.deepEqual(
    report.b2cs.map((row) => [row.pos, row.type, row.rate, row.taxable]),
    [['27-Maharashtra', 'INTRA', 18, 800], ['29-Karnataka', 'INTER', 18, 4000]],
    'small inter-state stays B2C Small; its credit note comes off',
  );
  assert.deepEqual(report.cdnr.map((row) => [row.number, row.invoice, row.taxable]), [['CN-26-27-2', 'VSC-26-27-9', 200]]);
  assert.deepEqual(report.cdnur.map((row) => [row.number, row.invoice]), [['CN-26-27-3', 'VSC-26-27-10']]);
  assert.deepEqual(report.docs, [
    { nature: 'Invoices for outward supply', from: 'VSC-26-27-9', to: 'VSC-26-27-13', total: 5, cancelled: 1 },
    { nature: 'Credit Note', from: 'CN-26-27-1', to: 'CN-26-27-3', total: 3, cancelled: 0 },
  ]);
  assert.deepEqual(report.problems, []);
});
