import { localDay } from './payments.ts';
import { lineAmount, r2 } from './purchases.ts';
import type { CreditNote, GstPayment, InvoiceItem, ItcStatus, Purchase, SalesInvoice, StockUnit, SupplierReturn } from './types';

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

export type RangeChoice = 'today' | 'yesterday' | 'week' | 'month' | 'previous' | 'quarter' | 'previousQuarter' | 'fy' | 'previousFy' | 'custom';
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
  const shift = (day: string, days: number) => new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
  if (choice === 'today') return { from: today, to: today, label: 'Today' };
  if (choice === 'yesterday') return { from: shift(today, -1), to: shift(today, -1), label: 'Yesterday' };
  if (choice === 'week') {
    // Monday to Sunday.
    const monday = shift(today, -((new Date(Date.parse(today)).getUTCDay() + 6) % 7));
    return { from: monday, to: shift(monday, 6), label: 'This week' };
  }
  if (choice === 'quarter' || choice === 'previousQuarter') {
    // Quarters of the financial year: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
    const first = Math.floor((month - 1) / 3) * 3 + 1 - (choice === 'previousQuarter' ? 3 : 0);
    const [y, m] = first < 1 ? [year - 1, first + 12] : [year, first];
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m + 2)}-${lastDay(y, m + 2)}`, label: `${MONTHS[m - 1]}–${MONTHS[m + 1]} ${y}` };
  }
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

const sumOf = (values: number[]) => r2(values.reduce((total, value) => total + value, 0));

/**
 * A tax invoice's figures, as the shop bills (and as server/src/gst.ts computeInvoice posts them): each line is
 * qty × rate less its discount, before GST; GST is worked out on the total at each rate, CGST and SGST at half the
 * rate each, and shared over the lines; the invoice is rounded to the rupee. VSC-26-27-412: ₹24,270.50 at 18% →
 * CGST ₹2,184.35 + SGST ₹2,184.35, less ₹0.20 → ₹28,639.
 */
export function computeInvoice<T extends { qty: number; rate: number; discountPct: number; gstRate: number }>(items: T[], interstate: boolean) {
  const lines = items.map((item) => ({ ...item, amount: r2(item.qty * item.rate * (1 - item.discountPct / 100)), cgst: 0, sgst: 0, igst: 0 }));
  const heads: Heads = zero();
  for (const rate of [...new Set(lines.map((line) => line.gstRate))]) {
    const group = lines.filter((line) => line.gstRate === rate);
    const taxable = sumOf(group.map((line) => line.amount));
    const parts: [keyof Heads, number][] = interstate ? [['igst', r2((taxable * rate) / 100)]] : [['cgst', r2((taxable * rate) / 200)], ['sgst', r2((taxable * rate) / 200)]];
    for (const [head, total] of parts) {
      heads[head] = r2(heads[head] + total);
      let left = total;
      group.forEach((line, index) => {
        const share = index === group.length - 1 ? left : r2(taxable ? (total * line.amount) / taxable : 0);
        line[head] = share;
        left = r2(left - share);
      });
    }
  }
  const taxable = sumOf(lines.map((line) => line.amount));
  const exact = r2(taxable + totalOf(heads));
  const roundOff = r2(Math.round(exact) - exact);
  return { lines: lines.map((line) => ({ ...line, taxable: line.amount })), taxable, ...heads, roundOff, total: r2(exact + roundOff) };
}

/** Units as the shop's invoices print them: pieces are NOS. */
export const PRINT_UNIT: Record<StockUnit, string> = {
  pcs: 'NOS',
  box: 'BOX',
  packet: 'PAC',
  set: 'SET',
  feet: 'FT',
  rft: 'RFT',
  meter: 'MTR',
  sqft: 'SQF',
  sqm: 'SQM',
  kg: 'KGS',
  sheet: 'SHEET',
  length: 'LENGTH',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-11-05 → 5-Nov-26, as the invoice prints dates. */
export const invoiceDay = (day: string) => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return `${date}-${MONTHS[month - 1]}-${String(year).slice(2)}`;
};

/** 24270.5 → "24,270.50": the invoice's figures, without the rupee sign. */
export const invoiceAmount = (value: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));

/** The tax rows under an invoice's lines, one per head and rate: CGST @9%, SGST @9% (or IGST @18%). */
export function invoiceTaxRows(items: Pick<InvoiceItem, 'gstRate' | 'cgst' | 'sgst' | 'igst'>[], interstate: boolean) {
  const rates = [...new Set(items.map((item) => item.gstRate))].filter((rate) => rate > 0).sort((a, b) => a - b);
  return rates.flatMap((rate) => {
    const group = items.filter((item) => item.gstRate === rate);
    const total = (head: keyof Heads) => sumOf(group.map((item) => item[head]));
    return interstate
      ? [{ label: `IGST @${rate}%`, rate, amount: total('igst') }]
      : [
          { label: `CGST @${rate / 2}%`, rate: rate / 2, amount: total('cgst') },
          { label: `SGST @${rate / 2}%`, rate: rate / 2, amount: total('sgst') },
        ];
  });
}

export type InvoiceHsnRow = { hsn: string; rate: number; taxable: number; heads: Heads; tax: number };

/** The HSN/SAC table printed under a tax invoice's lines: taxable value and tax for each HSN and rate. */
export function invoiceHsnTable(items: Pick<InvoiceItem, 'hsn' | 'gstRate' | 'taxable' | 'cgst' | 'sgst' | 'igst'>[]) {
  const rows = new Map<string, InvoiceHsnRow>();
  for (const item of items) {
    const key = `${item.hsn}|${item.gstRate}`;
    const row = rows.get(key) ?? { hsn: item.hsn, rate: item.gstRate, taxable: 0, heads: zero(), tax: 0 };
    row.taxable = r2(row.taxable + item.taxable);
    row.heads = add(row.heads, { igst: item.igst, cgst: item.cgst, sgst: item.sgst });
    row.tax = totalOf(row.heads);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** The period picker's state (components/GstRange), and the days it covers. */
export type RangeState = { choice: RangeChoice; from: string; to: string };
export const initialRange = (choice: RangeChoice = 'month'): RangeState => ({ choice, from: '', to: '' });
export const resolveRange = (state: RangeState): Range => rangeOf(state.choice, localDay(), { from: state.from, to: state.to });

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

/** Credit notes for goods returned, posted and dated in a range: they take their tax off the period's outward supplies. */
export const creditNotesIn = (notes: CreditNote[], range: Range) => notes.filter((note) => note.status === 'posted' && inRange(note.noteDate, range));

/** Suppliers' credit notes for goods sent back, dated in a range: their GST comes off the input tax credit. */
export const supplierCreditsIn = (returns: SupplierReturn[], range: Range) =>
  returns.filter((one) => ['credited', 'settled', 'closed'].includes(one.status) && one.creditNoteDate && inRange(one.creditNoteDate, range));
export const supplierCreditHeads = (one: SupplierReturn): Heads => split(one.creditNoteTax ?? 0, one.interstate);

/** Credit note lines for the HSN summary: the goods back, taken off the HSN's sales. */
export const creditNoteHsnLines = (notes: CreditNote[]) =>
  notes.flatMap((note) =>
    note.items.map((item) => ({ hsn: item.hsn, description: item.description, unit: item.unit, qty: -item.qty, taxable: -item.taxable, rate: item.gstRate, heads: { igst: -item.igst, cgst: -item.cgst, sgst: -item.sgst }, document: `cn-${note.id}` })),
  );

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
  const apply = (from: keyof Heads, to: keyof Heads, amount: number) => {
    const value = r2(Math.max(0, amount));
    if (!value) return 0;
    left[to] = r2(left[to] - value);
    // Two uses of the same credit against the same head read as one.
    const last = steps.at(-1);
    if (last && last.from === from && last.to === to) last.amount = r2(last.amount + value);
    else steps.push({ from, to, amount: value });
    return value;
  };
  let igst = credit.igst;
  igst = r2(igst - apply('igst', 'igst', Math.min(igst, left.igst)));
  // Where CGST or SGST credit can't cover its own head, IGST credit goes there first, so less cash is paid.
  igst = r2(igst - apply('igst', 'cgst', Math.min(igst, Math.max(0, left.cgst - credit.cgst))));
  igst = r2(igst - apply('igst', 'sgst', Math.min(igst, Math.max(0, left.sgst - credit.sgst))));
  // IGST credit must be used up before CGST or SGST credit is.
  igst = r2(igst - apply('igst', 'cgst', Math.min(igst, left.cgst)));
  igst = r2(igst - apply('igst', 'sgst', Math.min(igst, left.sgst)));
  let cgst = credit.cgst;
  cgst = r2(cgst - apply('cgst', 'cgst', Math.min(cgst, left.cgst)));
  cgst = r2(cgst - apply('cgst', 'igst', Math.min(cgst, left.igst)));
  let sgst = credit.sgst;
  sgst = r2(sgst - apply('sgst', 'sgst', Math.min(sgst, left.sgst)));
  sgst = r2(sgst - apply('sgst', 'igst', Math.min(sgst, left.igst)));
  return { cash: left, steps, carried: { igst, cgst, sgst } };
}

export type Summary3b = {
  outward: { taxable: number; heads: Heads; invoices: number };
  /** Credit notes in the period, already taken off `outward`. */
  creditNotes: { taxable: number; heads: Heads; notes: number };
  /** Suppliers' credit notes in the period, already taken off `itc`. */
  supplierCredits: Heads;
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
export function summary3b(invoices: SalesInvoice[], bills: Purchase[], payments: GstPayment[], range: Range, credits: { notes?: CreditNote[]; supplierReturns?: SupplierReturn[] } = {}): Summary3b {
  const posted = postedIn(invoices, range);
  const taxed = posted.flatMap((invoice) => invoice.items.filter((item) => item.gstRate > 0));
  const nilItems = posted.flatMap((invoice) => invoice.items.filter((item) => item.gstRate === 0));
  // Goods returned against invoices: their credit notes come off this period's outward supplies, never below nothing.
  const notes = creditNotesIn(credits.notes ?? [], range);
  const credited = notes.flatMap((note) => note.items.filter((item) => item.gstRate > 0));
  const creditNotes = {
    taxable: r2(credited.reduce((total, item) => total + item.taxable, 0)),
    heads: credited.reduce<Heads>((heads, item) => add(heads, { igst: item.igst, cgst: item.cgst, sgst: item.sgst }), zero()),
    notes: notes.length,
  };
  const gross = taxed.reduce<Heads>((heads, item) => add(heads, { igst: item.igst, cgst: item.cgst, sgst: item.sgst }), zero());
  const outward = {
    taxable: r2(Math.max(0, taxed.reduce((total, item) => total + item.taxable, 0) - creditNotes.taxable)),
    heads: { igst: r2(Math.max(0, gross.igst - creditNotes.heads.igst)), cgst: r2(Math.max(0, gross.cgst - creditNotes.heads.cgst)), sgst: r2(Math.max(0, gross.sgst - creditNotes.heads.sgst)) },
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
  // Goods sent back to suppliers: their credit notes lower the credit.
  const supplierCredits = supplierCreditsIn(credits.supplierReturns ?? [], range).reduce<Heads>((heads, one) => add(heads, supplierCreditHeads(one)), zero());
  const net = {
    igst: r2(Math.max(0, itc.igst - reversed.igst - supplierCredits.igst)),
    cgst: r2(Math.max(0, itc.cgst - reversed.cgst - supplierCredits.cgst)),
    sgst: r2(Math.max(0, itc.sgst - reversed.sgst - supplierCredits.sgst)),
  };
  const paidIn = payments.filter((payment) => inMonths(payment.period));
  return {
    outward,
    creditNotes,
    supplierCredits,
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
export function monthlyTax(invoices: SalesInvoice[], bills: Purchase[], today: string, credits: { notes?: CreditNote[]; supplierReturns?: SupplierReturn[] } = {}) {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, month - 12 + index, 1);
    const period = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    const range = { from: `${period}-01`, to: `${period}-31`, label: period };
    const output =
      postedIn(invoices, range).reduce((total, invoice) => total + invoice.cgst + invoice.sgst + invoice.igst, 0) -
      creditNotesIn(credits.notes ?? [], range).reduce((total, note) => total + note.cgst + note.sgst + note.igst, 0);
    const itc = bills
      .filter((bill) => bill.status === 'received' && ((bill.itcStatus === 'claimed' && bill.itcPeriod === period) || (bill.itcStatus === 'eligible' && bill.billDate.startsWith(period))))
      .reduce((total, bill) => total + bill.tax, 0) - supplierCreditsIn(credits.supplierReturns ?? [], range).reduce((total, one) => total + (one.creditNoteTax ?? 0), 0);
    return { period, date, output: r2(Math.max(0, output)), itc: r2(Math.max(0, itc)) };
  });
}

// ---------- GSTR-1 working (prepared here, filed by the accountant on the GST portal) ----------

/** Above this, an inter-state invoice to an unregistered buyer is B2C (Large), invoice by invoice (₹1 lakh since Aug 2024). */
export const B2CL_LIMIT = 100_000;

type RateRow = { rate: number; taxable: number; igst: number; cgst: number; sgst: number };
/** A document's lines folded by GST rate: GSTR-1 reports each invoice or note once per rate. */
const byRate = (items: { gstRate: number; taxable: number; igst: number; cgst: number; sgst: number }[]): RateRow[] => {
  const rows = new Map<number, RateRow>();
  for (const item of items) {
    const row = rows.get(item.gstRate) ?? { rate: item.gstRate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    row.taxable = r2(row.taxable + item.taxable);
    row.igst = r2(row.igst + item.igst);
    row.cgst = r2(row.cgst + item.cgst);
    row.sgst = r2(row.sgst + item.sgst);
    rows.set(item.gstRate, row);
  }
  return [...rows.values()].sort((a, b) => a.rate - b.rate);
};
/** "27-Maharashtra", as the GST offline tool writes the place of supply. */
export const posLabel = (code: string | undefined, state: string | undefined) => (code ? `${code}-${state ?? ''}` : '');

export type Gstr1Doc = { gstin: string; name: string; number: string; date: string; value: number; pos: string } & RateRow;
export type Gstr1 = {
  b2b: Gstr1Doc[];
  b2cl: Gstr1Doc[];
  b2cs: ({ pos: string; type: 'INTRA' | 'INTER' } & RateRow)[];
  cdnr: (Gstr1Doc & { invoice: string })[];
  cdnur: (Gstr1Doc & { invoice: string })[];
  docs: { nature: string; from: string; to: string; total: number; cancelled: number }[];
  /** Posted invoices with no place of supply or rate: they can't be reported until fixed. */
  problems: string[];
};

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/**
 * The GSTR-1 sections for a period, from posted tax invoices and credit notes dated in it: B2B (buyer has a GSTIN),
 * B2C Large (unregistered, inter-state, over ₹1 lakh), B2C Small (the rest, by place of supply and rate, net of their
 * credit notes), credit notes to registered (CDNR) and B2C Large (CDNUR) buyers, and the documents issued.
 */
export function gstr1(invoices: SalesInvoice[], notes: CreditNote[], range: Range): Gstr1 {
  const inPeriod = invoices.filter((invoice) => invoice.status !== 'draft' && invoice.number && inRange(invoice.invoiceDate, range));
  const posted = inPeriod.filter((invoice) => invoice.status === 'posted');
  const isLarge = (invoice: Pick<SalesInvoice, 'customerGstin' | 'interstate' | 'total'>) => !invoice.customerGstin && invoice.interstate && invoice.total > B2CL_LIMIT;
  const result: Gstr1 = { b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], docs: [], problems: [] };
  const small = new Map<string, Gstr1['b2cs'][number]>();
  const addSmall = (pos: string, interstate: boolean, row: RateRow, sign: 1 | -1) => {
    const key = `${pos}|${row.rate}`;
    const into = small.get(key) ?? { pos, type: interstate ? 'INTER' : 'INTRA', rate: row.rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    into.taxable = r2(into.taxable + sign * row.taxable);
    into.igst = r2(into.igst + sign * row.igst);
    into.cgst = r2(into.cgst + sign * row.cgst);
    into.sgst = r2(into.sgst + sign * row.sgst);
    small.set(key, into);
  };

  for (const invoice of posted) {
    if (!invoice.posCode) {
      result.problems.push(`${invoice.number} has no place of supply.`);
      continue;
    }
    const pos = posLabel(invoice.posCode, invoice.placeOfSupply);
    for (const row of byRate(invoice.items)) {
      const doc = { gstin: invoice.customerGstin ?? '', name: invoice.customerName, number: invoice.number!, date: invoice.invoiceDate, value: invoice.total, pos, ...row };
      if (invoice.customerGstin) result.b2b.push(doc);
      else if (isLarge(invoice)) result.b2cl.push(doc);
      else addSmall(pos, invoice.interstate, row, 1);
    }
  }

  const originals = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  for (const note of notes.filter((one) => one.status === 'posted' && inRange(one.noteDate, range))) {
    const pos = posLabel(note.posCode, note.placeOfSupply);
    const original = originals.get(note.invoiceId);
    for (const row of byRate(note.items)) {
      const doc = { gstin: note.customerGstin ?? '', name: note.customerName, number: note.number, date: note.noteDate, value: note.total, pos, invoice: note.invoiceNumber, ...row };
      if (note.customerGstin) result.cdnr.push(doc);
      else if (original && isLarge(original)) result.cdnur.push(doc);
      else addSmall(pos, note.interstate, row, -1);
    }
  }
  result.b2cs = [...small.values()].filter((row) => row.taxable !== 0).sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);

  const series = (nature: string, numbers: string[], cancelled: number) => {
    if (!numbers.length) return;
    const sorted = [...numbers].sort(natural);
    result.docs.push({ nature, from: sorted[0]!, to: sorted.at(-1)!, total: numbers.length, cancelled });
  };
  series('Invoices for outward supply', inPeriod.map((invoice) => invoice.number!), inPeriod.filter((invoice) => invoice.status === 'cancelled').length);
  const notesIn = notes.filter((note) => inRange(note.noteDate, range));
  series('Credit Note', notesIn.map((note) => note.number), notesIn.filter((note) => note.status === 'cancelled').length);
  return result;
}
