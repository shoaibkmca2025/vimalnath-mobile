import { lineAmount, r2 } from './purchases.ts';
import type { GstPayment, ItcStatus, Purchase, SalesInvoice } from './types';

/**
 * Phase 3, GST (docs/ERP-ROADMAP.md): registers, HSN summary and the GSTR-3B working summary, worked out from posted
 * invoices and received purchase bills. A working aid for the accountant, who checks it before filing.
 */

export const ITC_STATUS: Record<ItcStatus, { label: string; tone: 'warning' | 'success' | 'neutral' | 'info' | 'danger' }> = {
  pending: { label: 'Pending review', tone: 'warning' },
  eligible: { label: 'Eligible', tone: 'info' },
  claimed: { label: 'Claimed', tone: 'success' },
  ineligible: { label: 'Ineligible', tone: 'neutral' },
  reversed: { label: 'Reversed', tone: 'danger' },
};

export const INVOICE_STATUS: Record<SalesInvoice['status'], { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  draft: { label: 'Draft', tone: 'warning' },
  posted: { label: 'Posted', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export type Heads = { igst: number; cgst: number; sgst: number };
const zero = (): Heads => ({ igst: 0, cgst: 0, sgst: 0 });
const add = (a: Heads, b: Heads): Heads => ({ igst: r2(a.igst + b.igst), cgst: r2(a.cgst + b.cgst), sgst: r2(a.sgst + b.sgst) });
export const totalOf = (heads: Heads) => r2(heads.igst + heads.cgst + heads.sgst);

/** The Indian financial year a day falls in: 2026-11-21 → 26-27, starting 1 April 2026. */
export function financialYear(day: string) {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const start = month >= 4 ? year : year - 1;
  return { label: `${String(start).slice(2)}-${String(start + 1).slice(2)}`, from: `${start}-04-01`, to: `${start + 1}-03-31`, start };
}

export type RangeChoice = 'month' | 'previous' | 'fy' | 'previousFy' | 'custom';
export type Range = { from: string; to: string; label: string };

const monthName = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (value: number) => String(value).padStart(2, '0');
/** "November 2026" from 2026-11. */
export const periodLabel = (period: string) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  return monthName.format(new Date(year, month - 1, 1));
};

/** The days a filter covers, inclusive. */
export function rangeOf(choice: RangeChoice, today: string, custom?: { from: string; to: string }): Range {
  const [year, month] = today.split('-').map(Number) as [number, number];
  if (choice === 'month') return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${lastDay(year, month)}`, label: periodLabel(`${year}-${pad(month)}`) };
  if (choice === 'previous') {
    const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${lastDay(y, m)}`, label: periodLabel(`${y}-${pad(m)}`) };
  }
  const fy = financialYear(today);
  if (choice === 'fy') return { from: fy.from, to: fy.to, label: `FY 20${fy.label}` };
  if (choice === 'previousFy') {
    const previous = financialYear(`${fy.start - 1}-06-01`);
    return { from: previous.from, to: previous.to, label: `FY 20${previous.label}` };
  }
  return { from: custom?.from || fy.from, to: custom?.to || today, label: 'Custom range' };
}

export const inRange = (day: string, range: Range) => day >= range.from && day <= range.to;

/** Posted invoices dated in the range; drafts and cancelled ones aren't supplies. */
export const postedIn = (invoices: SalesInvoice[], range: Range) => invoices.filter((invoice) => invoice.status === 'posted' && inRange(invoice.invoiceDate, range));

const split = (tax: number, interstate: boolean): Heads => {
  if (interstate) return { igst: r2(tax), cgst: 0, sgst: 0 };
  const cgst = r2(tax / 2);
  return { igst: 0, cgst, sgst: r2(tax - cgst) };
};

/** A purchase bill's tax by head, from its saved figures and whether it was inter-state. */
export const purchaseHeads = (bill: Purchase): Heads => split(bill.tax, bill.interstate);

/** A purchase line's taxable value and tax by head. */
export function purchaseLine(bill: Purchase, index: number) {
  const item = bill.items[index]!;
  const taxable = lineAmount(item);
  return { taxable, ...split(r2((taxable * item.gstRate) / 100), bill.interstate) };
}

export const receivedIn = (bills: Purchase[], range: Range) => bills.filter((bill) => bill.status === 'received' && inRange(bill.billDate, range));

export type HsnRow = { hsn: string; description: string; unit: string; qty: number; documents: number; taxable: number; rate: number; heads: Heads; value: number };

/** Sales or purchases grouped by HSN and GST rate, as GSTR-1's HSN table asks. */
export function hsnSummary(lines: { hsn: string; description: string; unit: string; qty: number; taxable: number; rate: number; heads: Heads; document: string }[]) {
  const groups = new Map<string, HsnRow & { docs: Set<string> }>();
  for (const line of lines) {
    const key = `${line.hsn || '—'}|${line.rate}|${line.unit}`;
    const row = groups.get(key) ?? { hsn: line.hsn, description: line.description, unit: line.unit, qty: 0, documents: 0, taxable: 0, rate: line.rate, heads: zero(), value: 0, docs: new Set<string>() };
    row.qty = Math.round((row.qty + line.qty) * 1000) / 1000;
    row.taxable = r2(row.taxable + line.taxable);
    row.heads = add(row.heads, line.heads);
    row.value = r2(row.taxable + totalOf(row.heads));
    row.docs.add(line.document);
    row.documents = row.docs.size;
    groups.set(key, row);
  }
  return [...groups.values()].map(({ docs: _docs, ...row }) => row).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
}

export const salesHsnLines = (invoices: SalesInvoice[]) =>
  invoices.flatMap((invoice) => invoice.items.map((item) => ({ hsn: item.hsn, description: item.description, unit: item.unit, qty: item.qty, taxable: item.taxable, rate: item.gstRate, heads: { igst: item.igst, cgst: item.cgst, sgst: item.sgst }, document: invoice.id })));

export const purchaseHsnLines = (bills: Purchase[], hsnOf: (productId: string, option: string) => string) =>
  bills.flatMap((bill) =>
    bill.items.map((item, index) => {
      const line = purchaseLine(bill, index);
      return { hsn: hsnOf(item.productId, item.option), description: item.name, unit: item.unit, qty: item.qty, taxable: line.taxable, rate: item.gstRate, heads: { igst: line.igst, cgst: line.cgst, sgst: line.sgst }, document: bill.id };
    }),
  );

export type Utilisation = { from: keyof Heads; to: keyof Heads; amount: number };

/**
 * Pays each head's output tax with input tax credit in the order the law sets (section 49, rule 88A): IGST credit first,
 * against IGST and then CGST and SGST (shared where each one's own credit falls short); CGST credit against CGST, then
 * IGST; SGST credit against SGST, then IGST. CGST credit never pays SGST, nor SGST credit CGST. What's left is cash.
 */
export function utilise(liability: Heads, credit: Heads) {
  const left = { ...liability };
  const steps: Utilisation[] = [];
  const use = (from: keyof Heads, to: keyof Heads, amount: number) => {
    const value = r2(Math.max(0, amount));
    if (!value) return 0;
    left[to] = r2(left[to] - value);
    steps.push({ from, to, amount: value });
    return value;
  };
  let igst = credit.igst;
  igst = r2(igst - use('igst', 'igst', Math.min(igst, left.igst)));
  // Where CGST or SGST credit can't cover its own head, IGST credit goes there first, so less cash is paid.
  igst = r2(igst - use('igst', 'cgst', Math.min(igst, Math.max(0, left.cgst - credit.cgst))));
  igst = r2(igst - use('igst', 'sgst', Math.min(igst, Math.max(0, left.sgst - credit.sgst))));
  // IGST credit must be used up before CGST or SGST credit is.
  igst = r2(igst - use('igst', 'cgst', Math.min(igst, left.cgst)));
  igst = r2(igst - use('igst', 'sgst', Math.min(igst, left.sgst)));
  let cgst = credit.cgst;
  cgst = r2(cgst - use('cgst', 'cgst', Math.min(cgst, left.cgst)));
  cgst = r2(cgst - use('cgst', 'igst', Math.min(cgst, left.igst)));
  let sgst = credit.sgst;
  sgst = r2(sgst - use('sgst', 'sgst', Math.min(sgst, left.sgst)));
  sgst = r2(sgst - use('sgst', 'igst', Math.min(sgst, left.igst)));
  return { cash: left, steps, carried: { igst, cgst, sgst } };
}

export type Summary3b = {
  outward: { taxable: number; heads: Heads; invoices: number };
  nil: { taxable: number; invoices: number };
  interstateUnregistered: { taxable: number; igst: number };
  itc: Heads;
  reversed: Heads;
  ineligible: Heads;
  pendingBills: number;
  eligibleNotClaimed: number;
  liability: Heads;
  utilisation: ReturnType<typeof utilise>;
  paid: Heads & { interest: number; penalty: number };
};

/**
 * The GSTR-3B working for a range of months: 3.1 outward supplies from posted invoices; 4 ITC from received bills the
 * accountant marked claimed in the period (or eligible, dated in it); reversals in the period; then the set-off.
 */
export function summary3b(invoices: SalesInvoice[], bills: Purchase[], payments: GstPayment[], range: Range): Summary3b {
  const posted = postedIn(invoices, range);
  const taxed = posted.flatMap((invoice) => invoice.items.filter((item) => item.gstRate > 0));
  const nilItems = posted.flatMap((invoice) => invoice.items.filter((item) => item.gstRate === 0));
  const outward = {
    taxable: r2(taxed.reduce((total, item) => total + item.taxable, 0)),
    heads: taxed.reduce<Heads>((heads, item) => add(heads, { igst: item.igst, cgst: item.cgst, sgst: item.sgst }), zero()),
    invoices: posted.length,
  };
  const unregisteredOut = posted.filter((invoice) => invoice.interstate && !invoice.customerGstin);
  const month = (day: string) => day.slice(0, 7);
  const months = { from: month(range.from), to: month(range.to) };
  const inMonths = (period: string | undefined) => Boolean(period && period >= months.from && period <= months.to);
  const received = bills.filter((bill) => bill.status === 'received');
  const claimed = received.filter((bill) => (bill.itcStatus === 'claimed' && inMonths(bill.itcPeriod)) || (bill.itcStatus === 'eligible' && inRange(bill.billDate, range)));
  const itc = claimed.reduce<Heads>((heads, bill) => add(heads, purchaseHeads(bill)), zero());
  const reversed = received.filter((bill) => bill.itcStatus === 'reversed' && inMonths(bill.itcPeriod)).reduce<Heads>((heads, bill) => add(heads, purchaseHeads(bill)), zero());
  const ineligible = received.filter((bill) => bill.itcStatus === 'ineligible' && inRange(bill.billDate, range)).reduce<Heads>((heads, bill) => add(heads, purchaseHeads(bill)), zero());
  const net = { igst: r2(Math.max(0, itc.igst - reversed.igst)), cgst: r2(Math.max(0, itc.cgst - reversed.cgst)), sgst: r2(Math.max(0, itc.sgst - reversed.sgst)) };
  const paidIn = payments.filter((payment) => inMonths(payment.period));
  return {
    outward,
    nil: { taxable: r2(nilItems.reduce((total, item) => total + item.taxable, 0)), invoices: new Set(posted.filter((invoice) => invoice.items.some((item) => item.gstRate === 0)).map((invoice) => invoice.id)).size },
    interstateUnregistered: { taxable: r2(unregisteredOut.reduce((total, invoice) => total + invoice.taxable, 0)), igst: r2(unregisteredOut.reduce((total, invoice) => total + invoice.igst, 0)) },
    itc: net,
    reversed,
    ineligible,
    pendingBills: received.filter((bill) => bill.itcStatus === 'pending' && inRange(bill.billDate, range)).length,
    eligibleNotClaimed: received.filter((bill) => bill.itcStatus === 'eligible' && inRange(bill.billDate, range)).length,
    liability: outward.heads,
    utilisation: utilise(outward.heads, net),
    paid: paidIn.reduce(
      (total, payment) => ({ igst: r2(total.igst + payment.igst), cgst: r2(total.cgst + payment.cgst), sgst: r2(total.sgst + payment.sgst), interest: r2(total.interest + payment.interest), penalty: r2(total.penalty + payment.penalty) }),
      { igst: 0, cgst: 0, sgst: 0, interest: 0, penalty: 0 },
    ),
  };
}

/** The last 12 months' output tax and input tax credit, for the dashboard's chart. */
export function monthlyTax(invoices: SalesInvoice[], bills: Purchase[], today: string) {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, month - 12 + index, 1);
    const period = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    const range = { from: `${period}-01`, to: `${period}-31`, label: period };
    const output = postedIn(invoices, range).reduce((total, invoice) => total + invoice.cgst + invoice.sgst + invoice.igst, 0);
    const itc = bills
      .filter((bill) => bill.status === 'received' && ((bill.itcStatus === 'claimed' && bill.itcPeriod === period) || (bill.itcStatus === 'eligible' && bill.billDate.startsWith(period))))
      .reduce((total, bill) => total + bill.tax, 0);
    return { period, date, output: r2(output), itc: r2(itc) };
  });
}
