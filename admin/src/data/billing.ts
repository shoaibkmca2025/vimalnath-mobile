import { localDay } from './payments.ts';
import { r2 } from './purchases.ts';
import type { BillPaymentMethod, DiscountLevel, DiscountRule, Quotation, QuotationStatus, SalesInvoice } from './types';

/**
 * Custom billing and category-wise discounts on the admin's side: what a bill owes, where it stands, and each line's
 * discount against its rule, worked out as the server does (server/src/discounts.ts) so the editor shows the same verdict
 * before saving. The server checks again on every save and before finalizing.
 */

export const BILL_METHODS: Record<BillPaymentMethod, string> = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', cheque: 'Cheque', card: 'Card' };

export type PayStatus = 'paid' | 'partial' | 'unpaid' | 'overdue';
export const PAY_STATUS: Record<PayStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  paid: { label: 'Paid', tone: 'success' },
  partial: { label: 'Part paid', tone: 'warning' },
  unpaid: { label: 'Unpaid', tone: 'neutral' },
  overdue: { label: 'Overdue', tone: 'danger' },
};

export const QUOTATION_STATUS: Record<QuotationStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  draft: { label: 'Draft', tone: 'warning' },
  sent: { label: 'Sent', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  converted: { label: 'Invoiced', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** What's left to pay on an invoice (posted or a draft with an advance), and where it stands. */
export function balanceOf(invoice: Pick<SalesInvoice, 'total' | 'paid' | 'status' | 'dueDate'>, today = localDay()) {
  const paid = invoice.paid ?? 0;
  const balance = invoice.status === 'cancelled' ? 0 : Math.max(0, r2(invoice.total - paid));
  const status: PayStatus = balance <= 0 ? 'paid' : invoice.dueDate && invoice.dueDate < today && invoice.status === 'posted' ? 'overdue' : paid > 0 ? 'partial' : 'unpaid';
  return { paid, balance, status };
}

/** The billing dashboard's figures. */
export function billingSummary(invoices: SalesInvoice[], today = localDay()) {
  const posted = invoices.filter((invoice) => invoice.status === 'posted');
  const month = today.slice(0, 7);
  const sum = (rows: SalesInvoice[]) => r2(rows.reduce((total, invoice) => total + invoice.total, 0));
  const states = posted.map((invoice) => ({ invoice, ...balanceOf(invoice, today) }));
  return {
    total: posted.length,
    today: sum(posted.filter((invoice) => invoice.invoiceDate === today)),
    todayCount: posted.filter((invoice) => invoice.invoiceDate === today).length,
    month: sum(posted.filter((invoice) => invoice.invoiceDate.startsWith(month))),
    monthCount: posted.filter((invoice) => invoice.invoiceDate.startsWith(month)).length,
    paid: states.filter((state) => state.status === 'paid').length,
    unpaid: states.filter((state) => state.status === 'unpaid' || state.status === 'overdue').length,
    partial: states.filter((state) => state.status === 'partial').length,
    overdue: states.filter((state) => state.status === 'overdue').length,
    outstanding: r2(states.reduce((total, state) => total + state.balance, 0)),
    cancelled: invoices.filter((invoice) => invoice.status === 'cancelled').length,
    drafts: invoices.filter((invoice) => invoice.status === 'draft').length,
  };
}

/** A quotation past its validity is shown as expired even before anyone marks it. */
export const quotationState = (quote: Quotation, today = localDay()): QuotationStatus => (['draft', 'sent'].includes(quote.status) && quote.validUntil && quote.validUntil < today ? 'expired' : quote.status);

// ---------- Discounts (as server/src/discounts.ts) ----------

const EPS = 0.005;
const pct = (value: number) => `${Number(value.toFixed(2))}%`;
const inr = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const DISCOUNT_LEVEL: Record<DiscountLevel, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Full control: rules, approvals, any discount within a rule.' },
  admin: { label: 'Discount admin', description: 'Edits the rules, approves requests, gives up to a rule’s maximum.' },
  manager: { label: 'Manager', description: 'Gives up to their own limit (within each rule); more needs approval.' },
  staff: { label: 'Billing staff', description: 'Gives up to each rule’s staff limit; more needs approval.' },
};
export const DISCOUNT_TYPE: Record<DiscountRule['type'], string> = { percentage: 'Percentage', amount: 'Fixed ₹ per unit', both: '% or ₹' };

/** The rules that apply on a day. */
export const rulesOn = (rules: DiscountRule[], day: string) => rules.filter((rule) => (!rule.startsOn || rule.startsOn <= day) && (!rule.endsOn || rule.endsOn >= day));

/** A line's rule: its option's, its product's (when product rules are on), its category's, then the default. */
export function ruleFor(rules: DiscountRule[], productRules: boolean, line: { productId: string; option: string; categoryId: string | null }) {
  if (productRules && line.productId) {
    const own = rules.find((rule) => rule.scope === 'product' && rule.productId === line.productId && rule.option === line.option) ?? rules.find((rule) => rule.scope === 'product' && rule.productId === line.productId && rule.option === '');
    if (own) return own;
  }
  if (line.categoryId) {
    const category = rules.find((rule) => rule.scope === 'category' && rule.categoryId === line.categoryId);
    if (category) return category;
  }
  return rules.find((rule) => rule.scope === 'default') ?? null;
}

type Priced = { qty: number; rate: number; discountPct: number; discountAmount?: number; lineType?: 'goods' | 'charge'; gstRate: number; taxable: number };

/** A line's whole discount: rupees off before GST, as a % of its value, and per unit. */
export function measure(line: Priced, inclusive: boolean) {
  const factor = inclusive ? 1 + line.gstRate / 100 : 1;
  const base = r2((line.qty * line.rate) / factor);
  const value = Math.max(0, r2(base - line.taxable));
  return { base, value, effectivePct: base ? Math.round((value / base) * 10000) / 100 : 0, perUnit: line.qty ? r2((value * factor) / line.qty) : 0 };
}

/** The range a rule allows, in words: "5% to 15%", or "₹0 to ₹100 off each unit". */
export function rangeOf(rule: DiscountRule | null) {
  if (!rule) return '';
  if (!rule.enabled) return 'No discount';
  return rule.type === 'amount' ? `${inr(rule.minAmount)} to ${rule.maxAmount === null ? 'any' : inr(rule.maxAmount)} off each unit` : `${pct(rule.minPct)} to ${pct(rule.maxPct)}`;
}

/** Whether a line keeps to its rule (`problem`), and whether its giver needs approval (`limit`). */
export function judge(rule: DiscountRule | null, line: Priced & { discountAmount?: number }, measured: ReturnType<typeof measure>, me?: { level: DiscountLevel; limitPct: number | null }) {
  if (line.lineType === 'charge' || !rule) return { problem: null as string | null, limit: null as number | null };
  const name = rule.scope === 'default' ? 'These goods' : rule.label;
  const any = measured.value > EPS;
  if (!rule.enabled) return { problem: any ? `No discount is allowed on ${name}.` : null, limit: null };
  if (rule.type === 'percentage' && (line.discountAmount ?? 0) > 0) return { problem: `${name} takes % discounts only.`, limit: null };
  if (rule.type === 'amount' && line.discountPct > 0) return { problem: `${name} takes ₹ discounts (off each unit) only.`, limit: null };
  if (rule.type === 'amount') {
    if (measured.perUnit < rule.minAmount - EPS || (rule.maxAmount !== null && measured.perUnit > rule.maxAmount + EPS))
      return { problem: `${name}: ${inr(rule.minAmount)} to ${rule.maxAmount === null ? 'any amount' : inr(rule.maxAmount)} off each unit (this is ${inr(measured.perUnit)}).`, limit: null };
  } else if (measured.effectivePct < rule.minPct - EPS || measured.effectivePct > rule.maxPct + EPS) {
    return { problem: `${name}: ${pct(rule.minPct)} to ${pct(rule.maxPct)} discount (this is ${pct(measured.effectivePct)}).`, limit: null };
  }
  if (!me || me.level === 'owner' || me.level === 'admin' || !any) return { problem: null, limit: null };
  if (rule.type === 'amount' && me.level === 'staff') {
    const limit = rule.requiresApproval ? rule.defaultAmount : (rule.staffMaxAmount ?? rule.maxAmount);
    return { problem: null, limit: limit !== null && measured.perUnit > limit + EPS ? limit : null };
  }
  const limit = me.level === 'manager' ? Math.min(me.limitPct ?? rule.staffMaxPct ?? rule.maxPct, rule.maxPct) : rule.requiresApproval ? rule.defaultPct : (rule.staffMaxPct ?? rule.maxPct);
  return { problem: null, limit: measured.effectivePct > limit + EPS ? limit : null };
}

/**
 * A bill's discounts before GST, line by line (its % and ₹ off and its share of the bill discount) and in all. Worked
 * out from the lines, so a bill made before discount rules existed shows the same.
 */
export function discountsOf(invoice: { items: Priced[]; pricesIncludeGst?: boolean }) {
  const lines = invoice.items.map((item) => (item.lineType === 'charge' ? null : measure(item, Boolean(invoice.pricesIncludeGst))));
  return { lines, total: r2(lines.reduce((sum, line) => sum + (line?.value ?? 0), 0)) };
}

/** The discount a new line starts with: the rule's suggested one. */
export const suggested = (rule: DiscountRule | null) => (!rule || !rule.enabled ? { pct: 0, amount: 0 } : rule.type === 'amount' ? { pct: 0, amount: rule.defaultAmount } : { pct: rule.defaultPct, amount: 0 });
