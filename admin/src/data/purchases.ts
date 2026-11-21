import type { Purchase, PurchaseItem, PurchaseStatus, Supplier, SupplierPayment } from './types';

/**
 * Phase 2, purchases (docs/ERP-ROADMAP.md). The figures here preview what the server works out; the server's are the
 * ones saved, by the same rules (server/src/purchases.ts purchaseTotals).
 */

export const PURCHASE_STATUS: Record<PurchaseStatus, { label: string; tone: 'warning' | 'success' | 'neutral'; description: string }> = {
  draft: { label: 'Draft', tone: 'warning', description: 'Not received yet: no stock has moved, and it can still change' },
  received: { label: 'Received', tone: 'success', description: 'The goods are in stock' },
  cancelled: { label: 'Cancelled', tone: 'neutral', description: 'Kept for the record; any stock it brought in was taken back out' },
};

export const r2 = (value: number) => Math.round(value * 100) / 100;

/** A line's amount before GST, after its discount. */
export const lineAmount = (item: Pick<PurchaseItem, 'qty' | 'rate' | 'discountPct'>) => r2(item.qty * item.rate * (1 - item.discountPct / 100));

export function purchaseTotals(input: { items: Pick<PurchaseItem, 'qty' | 'rate' | 'discountPct' | 'gstRate'>[]; freight: number; otherCharges: number; discount: number; roundOff: number }) {
  let subtotal = 0;
  let tax = 0;
  for (const item of input.items) {
    const amount = lineAmount(item);
    subtotal += amount;
    tax += r2((amount * item.gstRate) / 100);
  }
  subtotal = r2(subtotal);
  tax = r2(tax);
  return { subtotal, tax, total: r2(subtotal + tax + input.freight + input.otherCharges - input.discount + input.roundOff) };
}

export const paidOf = (purchase: Pick<Purchase, 'payments'>) => r2((purchase.payments ?? []).reduce((sum, payment) => sum + payment.amount, 0));
/** What a bill still owes. A cancelled one owes nothing. */
export const balanceOf = (purchase: Purchase) => (purchase.status === 'cancelled' ? 0 : r2(Math.max(0, purchase.total - paidOf(purchase))));

/** The day a received bill falls due, from the supplier's payment terms; null without terms. */
export function dueOf(purchase: Purchase, supplier: Supplier | undefined) {
  if (supplier?.paymentDays === null || supplier?.paymentDays === undefined) return null;
  const [year, month, day] = purchase.billDate.split('-').map(Number) as [number, number, number];
  const due = new Date(Date.UTC(year, month - 1, day + supplier.paymentDays));
  return due.toISOString().slice(0, 10);
}

export type PayState = { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' };

export function payState(purchase: Purchase, supplier: Supplier | undefined, today: string): PayState {
  if (purchase.status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
  const balance = balanceOf(purchase);
  if (balance === 0) return { label: purchase.total === 0 ? 'Nothing to pay' : 'Paid', tone: 'success' };
  const due = purchase.status === 'received' ? dueOf(purchase, supplier) : null;
  if (due && today > due) return { label: 'Overdue', tone: 'danger' };
  return { label: paidOf(purchase) > 0 ? 'Part paid' : 'Unpaid', tone: 'warning' };
}

/** One line of a supplier's ledger: what the shop owes goes up with each received bill and down with each payment. */
export type LedgerRow = { key: string; day: string; label: string; to?: string; billed: number; paid: number; balance: number; payment?: SupplierPayment & { purchaseNumber?: string | null } };

export function ledger(supplier: Supplier, bills: Purchase[], payments: (SupplierPayment & { purchaseNumber?: string | null })[]): LedgerRow[] {
  const entries = [
    ...(supplier.openingBalance ? [{ key: 'opening', day: supplier.createdAt.slice(0, 10), label: 'Opening balance', billed: supplier.openingBalance, paid: 0, order: 0 }] : []),
    ...bills
      .filter((bill) => bill.status === 'received')
      .map((bill) => ({ key: `bill-${bill.id}`, day: bill.billDate, label: `Bill ${bill.number}${bill.supplierInvoice ? ` (${bill.supplierInvoice})` : ''}`, to: `/purchases/${bill.id}`, billed: bill.total, paid: 0, order: 1 })),
    ...payments.map((payment) => ({
      key: `payment-${payment.id}`,
      day: payment.paidOn,
      label: payment.purchaseNumber ? `Paid for ${payment.purchaseNumber}` : 'Paid on account',
      billed: 0,
      paid: payment.amount,
      order: 2,
      payment,
    })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order);
  let balance = 0;
  return entries.map(({ order: _order, ...entry }) => {
    balance = r2(balance + entry.billed - entry.paid);
    return { ...entry, balance };
  });
}

/** ₹1,350 or ₹812.50: paise only when there are some. */
export const formatMoney = (value: number) =>
  `${value < 0 ? '−' : ''}₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: Number.isInteger(r2(value)) ? 0 : 2, maximumFractionDigits: 2 }).format(Math.abs(value))}`;

/** Rupees and paise typed in a form: "1,250.5" is 1250.5; anything else is NaN. Empty is 0 when allowed. */
export const parseMoney = (text: string, emptyIs: number | null = 0) => {
  const clean = text.replace(/[₹,\s]/g, '');
  if (!clean) return emptyIs ?? Number.NaN;
  return /^-?\d{1,9}(\.\d{1,2})?$/.test(clean) ? Number(clean) : Number.NaN;
};
