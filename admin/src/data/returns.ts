import { computeInvoice } from './gst.ts';
import { localDay } from './payments.ts';
import { r2 } from './purchases.ts';
import type { Role } from './session';
import type {
  RefundMethod,
  RefundStatus,
  RefundTransaction,
  ReturnAction,
  ReturnCondition,
  ReturnKind,
  ReturnOutcome,
  ReturnReason,
  ReturnSettings,
  ReturnStatus,
  SalesReturn,
  SupplierReturnReason,
  SupplierReturnStatus,
} from './types';

/**
 * Phase 4, Returns & Replacements (docs/ERP-ROADMAP.md): labels, who may do what, which step comes next, and the
 * figures the dashboard and reports show. The server decides; these only shape the screens.
 */

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const RETURN_STATUS: Record<ReturnStatus, { label: string; tone: Tone; description: string }> = {
  pending: { label: 'Pending', tone: 'warning', description: 'Waiting for someone to approve it.' },
  under_review: { label: 'Under Review', tone: 'warning', description: 'Being looked into before a decision.' },
  approved: { label: 'Approved', tone: 'info', description: 'Approved: waiting for the goods to come back.' },
  rejected: { label: 'Rejected', tone: 'neutral', description: 'Not accepted. Nothing moved.' },
  received: { label: 'Product Received', tone: 'info', description: 'The goods are back, waiting for the quality check.' },
  inspected: { label: 'Quality Checked', tone: 'info', description: 'Checked and in the right stock; waiting to be settled.' },
  refunded: { label: 'Refund Processed', tone: 'success', description: 'Refunded in full.' },
  replaced: { label: 'Replacement Completed', tone: 'success', description: 'The replacement goods are given.' },
  closed: { label: 'Closed', tone: 'neutral', description: 'Finished.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', description: 'Cancelled; any stock it moved is back where it was.' },
};
/** The path a return takes, for its timeline. */
export const RETURN_STEPS: ReturnStatus[] = ['pending', 'approved', 'received', 'inspected', 'refunded', 'closed'];
export const REPLACEMENT_STEPS: ReturnStatus[] = ['pending', 'approved', 'received', 'replaced', 'closed'];

export const RETURN_KIND: Record<ReturnKind, string> = { refund: 'Refund', replacement: 'Replacement' };

export const RETURN_REASONS: Record<ReturnReason, string> = {
  wrong_product: 'Wrong product delivered',
  damaged: 'Damaged product',
  defective: 'Defective product',
  wrong_size: 'Incorrect size or measurement',
  changed_mind: 'Customer changed mind',
  duplicate_order: 'Duplicate order',
  quality: 'Quality issue',
  other: 'Other',
};

export const CONDITIONS: Record<ReturnCondition, string> = {
  unopened: 'Unopened',
  good: 'Good condition',
  opened: 'Opened but unused',
  damaged: 'Damaged',
  defective: 'Defective',
  used: 'Used',
  incomplete: 'Incomplete product',
};

export const OUTCOMES: Record<ReturnOutcome, { label: string; description: string }> = {
  restock: { label: 'Back on sale', description: 'Into stock that can be sold.' },
  damaged: { label: 'Damaged stock', description: 'Kept apart: send back to the supplier or sell as seconds.' },
  defective: { label: 'Defective stock', description: 'Kept apart for the supplier.' },
  write_off: { label: 'Write off', description: 'Leaves stock: scrapped.' },
};
/** What the quality check suggests for each condition. */
export const SUGGESTED_OUTCOME: Record<ReturnCondition, ReturnOutcome> = {
  unopened: 'restock',
  good: 'restock',
  opened: 'restock',
  damaged: 'damaged',
  defective: 'defective',
  used: 'damaged',
  incomplete: 'defective',
};

export const REFUND_METHODS: Record<RefundMethod, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank: 'Bank transfer',
  cheque: 'Cheque',
  original: 'Original payment method',
  store_credit: 'Store credit',
  adjustment: 'Against another order',
};
export const REFUND_STATUS: Record<RefundStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  processing: { label: 'Processing', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
/** A refund's next steps, as the server allows them. */
export const REFUND_NEXT: Partial<Record<RefundStatus, RefundStatus[]>> = {
  pending: ['approved', 'processing', 'completed', 'failed', 'cancelled'],
  approved: ['processing', 'completed', 'failed', 'cancelled'],
  processing: ['completed', 'failed'],
  failed: ['pending', 'cancelled'],
};

export const SUPPLIER_RETURN_STATUS: Record<SupplierReturnStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  dispatched: { label: 'Dispatched', tone: 'info' },
  supplier_received: { label: 'Supplier Received', tone: 'info' },
  credited: { label: 'Credit Note Received', tone: 'info' },
  settled: { label: 'Settled', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const SUPPLIER_RETURN_STEPS: SupplierReturnStatus[] = ['draft', 'approved', 'dispatched', 'supplier_received', 'credited', 'settled', 'closed'];
export const SUPPLIER_REASONS: Record<SupplierReturnReason, string> = {
  wrong_product: 'Wrong product supplied',
  damaged: 'Damaged',
  defective: 'Defective',
  wrong_size: 'Incorrect size or measurement',
  excess: 'Excess quantity',
  quality: 'Quality issue',
  other: 'Other',
};

export const FLAGS: Record<SalesReturn['flags'][number], string> = {
  late: 'After the return period',
  category: 'Category not marked returnable',
};

/** Owners may do anything; other roles what Return Settings gives them. */
export const canDo = (settings: Pick<ReturnSettings, 'permissions'> | null, role: Role | undefined, action: ReturnAction) =>
  role === 'owner' || Boolean(role && settings && (settings.permissions[action] as string[]).includes(role));

/** Money settled on a return: refunds out, collections in, and what is still to do either way. */
export function moneyOf(ret: Pick<SalesReturn, 'settleAmount' | 'refunds'>) {
  const refunds = ret.refunds ?? [];
  const sum = (filter: (refund: RefundTransaction) => boolean) => refunds.filter(filter).reduce((total, refund) => total + refund.amount, 0);
  const live = (refund: RefundTransaction) => refund.status !== 'failed' && refund.status !== 'cancelled';
  const paidOut = sum((refund) => refund.direction === 'out' && refund.status === 'completed');
  const paidIn = sum((refund) => refund.direction === 'in' && refund.status === 'completed');
  const bookedOut = sum((refund) => refund.direction === 'out' && live(refund));
  const bookedIn = sum((refund) => refund.direction === 'in' && live(refund));
  const open = refunds.filter((refund) => ['pending', 'approved', 'processing'].includes(refund.status)).length;
  const owedOut = Math.max(0, ret.settleAmount);
  const owedIn = Math.max(0, -ret.settleAmount);
  return {
    paidOut,
    paidIn,
    open,
    /** Still to refund, not yet entered. */
    leftOut: owedOut - bookedOut,
    /** Still to collect, not yet entered. */
    leftIn: owedIn - bookedIn,
    /** Not yet paid either way (entered or not). */
    pendingOut: owedOut - paidOut,
    pendingIn: owedIn - paidIn,
    settled: open === 0 && (ret.settleAmount >= 0 ? paidOut === owedOut && paidIn === 0 : paidIn === owedIn && paidOut === 0),
  };
}

const GOODS_BACK: ReturnStatus[] = ['received', 'inspected', 'refunded', 'replaced', 'closed'];
export const goodsBack = (status: ReturnStatus) => GOODS_BACK.includes(status);
/** Still active: counts against what can be returned, and may move stock or money. */
export const isActive = (status: ReturnStatus) => status !== 'rejected' && status !== 'cancelled';

export type ReturnActionKey = 'review' | 'approve' | 'reject' | 'edit' | 'receive' | 'inspect' | 'replace' | 'refund' | 'collect' | 'creditNote' | 'close' | 'cancel';

/** What this person may do to a return now, in the order a screen offers them. */
export function actionsFor(ret: SalesReturn, settings: ReturnSettings | null, role: Role | undefined) {
  const may = (action: ReturnAction) => canDo(settings, role, action);
  const money = moneyOf(ret);
  const uninspected = ret.items.some((item) => !item.outcome);
  const actions: ReturnActionKey[] = [];
  const { status } = ret;
  if ((status === 'pending' || status === 'under_review') && may('approve')) actions.push('approve', 'reject');
  if (status === 'pending' && may('approve')) actions.push('review');
  if ((status === 'pending' || status === 'under_review') && may('create')) actions.push('edit');
  if (status === 'approved' && may('receive')) actions.push('receive');
  if (['received', 'inspected', 'refunded', 'replaced'].includes(status) && uninspected && may('inspect')) actions.push('inspect');
  if (ret.kind === 'replacement' && (status === 'received' || status === 'inspected') && may('receive')) actions.push('replace');
  if (['received', 'inspected', 'refunded', 'replaced'].includes(status) && may('refund')) {
    if (money.leftOut > 0) actions.push('refund');
    if (money.leftIn > 0) actions.push('collect');
  }
  if (ret.invoiceId && goodsBack(status) && (!ret.creditNote || ret.creditNote.status === 'cancelled') && may('approve') && (ret.kind === 'refund' || settings?.replacementTax === 'invoice'))
    actions.push('creditNote');
  if (['inspected', 'refunded', 'replaced'].includes(status) && !uninspected && money.settled && (ret.kind === 'refund' || status === 'replaced') && may('approve')) actions.push('close');
  const cancellable = ['pending', 'under_review', 'approved', 'received', 'inspected'].includes(status) && !money.paidOut && !money.paidIn;
  if (cancellable && may(status === 'pending' || status === 'under_review' ? 'create' : 'approve')) actions.push('cancel');
  return actions;
}

/** The step a return is waiting for, in a few words, for lists. */
export function waitingFor(ret: SalesReturn) {
  const money = moneyOf(ret);
  if (ret.status === 'pending' || ret.status === 'under_review') return 'A decision';
  if (ret.status === 'approved') return 'The goods';
  if (goodsBack(ret.status) && ret.status !== 'closed' && ret.items.some((item) => !item.outcome)) return 'Quality check';
  if (ret.kind === 'replacement' && (ret.status === 'received' || ret.status === 'inspected')) return 'Replacement goods';
  if (money.pendingOut > 0) return `Refund of ${rupees(money.pendingOut)}`;
  if (money.pendingIn > 0) return `${rupees(money.pendingIn)} from the customer`;
  if (['inspected', 'refunded', 'replaced'].includes(ret.status)) return 'Closing';
  return null;
}

const rupees = (value: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)}`;

// ---------- Replacement pricing, as the server works it out ----------

export type PricedLine = { qty: number; rate: number; discountPct: number; gstRate: number };
/** Goods given in exchange: with GST on top for an invoiced order, at the billed price otherwise. */
export function priceReplacement(lines: PricedLine[], invoiced: boolean, interstate: boolean) {
  if (invoiced) {
    const figures = computeInvoice(lines, interstate);
    return { lines: figures.lines.map((line) => ({ taxable: line.taxable, tax: r2(line.cgst + line.sgst + line.igst), amount: r2(line.taxable + line.cgst + line.sgst + line.igst) })), total: Math.round(figures.total) };
  }
  const priced = lines.map((line) => {
    const amount = r2(line.qty * line.rate * (1 - line.discountPct / 100));
    return { taxable: amount, tax: 0, amount };
  });
  return { lines: priced, total: Math.round(priced.reduce((sum, line) => sum + line.amount, 0)) };
}

/** A returned line's value: a whole invoiced line gives back exactly its tax, part of one its share. */
export function priceReturned(line: { source: 'invoice' | 'order'; qty: number; rate: number; taxable: number; cgst: number; sgst: number; igst: number }, qty: number, rate = line.rate) {
  if (line.source === 'order') {
    const taxable = r2(rate * qty);
    return { taxable, tax: 0, amount: taxable };
  }
  const share = qty / line.qty;
  const whole = Math.abs(qty - line.qty) < 1e-9;
  const taxable = whole ? line.taxable : r2(line.taxable * share);
  const tax = whole ? r2(line.cgst + line.sgst + line.igst) : r2(r2(line.cgst * share) + r2(line.sgst * share) + r2(line.igst * share));
  return { taxable, tax, amount: r2(taxable + tax) };
}

// ---------- Periods and the dashboard ----------

export type PeriodChoice = 'today' | 'week' | 'month' | 'fy' | 'all' | 'custom';
export const PERIOD_LABEL: Record<PeriodChoice, string> = { today: 'Today', week: 'This Week', month: 'This Month', fy: 'This Year', all: 'All Time', custom: 'Custom' };

const pad = (value: number) => String(value).padStart(2, '0');
/** The days a period covers, inclusive, from today. Weeks start on Monday. */
export function periodOf(choice: PeriodChoice, today = localDay(), custom: { from: string; to: string } = { from: '', to: '' }) {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  if (choice === 'today') return { from: today, to: today };
  if (choice === 'week') {
    const date = new Date(year, month - 1, day);
    const monday = new Date(year, month - 1, day - ((date.getDay() + 6) % 7));
    return { from: localDay(monday), to: today };
  }
  if (choice === 'month') return { from: `${year}-${pad(month)}-01`, to: today };
  if (choice === 'fy') return { from: `${month >= 4 ? year : year - 1}-04-01`, to: today };
  if (choice === 'custom') return { from: custom.from || '2000-01-01', to: custom.to || today };
  return { from: '2000-01-01', to: today };
}

export type ReturnFilter = { from: string; to: string; productId?: string; customer?: string; status?: ReturnStatus | 'open' };
export const inFilter = (ret: SalesReturn, filter: ReturnFilter) =>
  ret.returnDate >= filter.from &&
  ret.returnDate <= filter.to &&
  (!filter.productId || ret.items.some((item) => item.productId === filter.productId)) &&
  (!filter.customer || ret.customerName === filter.customer) &&
  (!filter.status || (filter.status === 'open' ? isActive(ret.status) && ret.status !== 'closed' : ret.status === filter.status));

/** The dashboard's figures for some returns. */
export function returnSummary(returns: SalesReturn[]) {
  const active = returns.filter((ret) => isActive(ret.status));
  const count = (statuses: ReturnStatus[]) => returns.filter((ret) => statuses.includes(ret.status)).length;
  const refunded = active.reduce((total, ret) => total + moneyOf(ret).paidOut, 0);
  const pendingRefund = active.filter((ret) => ret.status !== 'pending' && ret.status !== 'under_review').reduce((total, ret) => total + Math.max(0, moneyOf(ret).pendingOut), 0);
  const tally = <K extends string>(pick: (ret: SalesReturn) => K[]) => {
    const counts = new Map<K, number>();
    for (const ret of active) for (const value of pick(ret)) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  };
  const products = new Map<string, { name: string; qty: number; unit: string; value: number; returns: number }>();
  for (const ret of active)
    for (const item of ret.items) {
      const key = `${item.productId}\u0000${item.option}`;
      const row = products.get(key) ?? { name: item.name || item.description, qty: 0, unit: item.unit, value: 0, returns: 0 };
      row.qty = Math.round((row.qty + item.qty) * 1000) / 1000;
      row.value = r2(row.value + item.amount);
      row.returns += 1;
      products.set(key, row);
    }
  return {
    total: returns.length,
    pending: count(['pending', 'under_review']),
    approved: count(['approved', 'received', 'inspected']),
    completed: count(['refunded', 'replaced', 'closed']),
    rejected: count(['rejected']),
    items: r2(active.reduce((total, ret) => total + ret.items.reduce((sum, item) => sum + item.qty, 0), 0)),
    refunded,
    pendingRefund,
    replacements: active.filter((ret) => ret.kind === 'replacement').length,
    refunds: active.filter((ret) => ret.kind === 'refund').length,
    refundValue: active.filter((ret) => ret.kind === 'refund').reduce((total, ret) => total + ret.returnValue, 0),
    replacementValue: active.filter((ret) => ret.kind === 'replacement').reduce((total, ret) => total + ret.returnValue, 0),
    reasons: tally((ret) => [ret.reason]),
    conditions: tally((ret) => [...new Set(ret.items.map((item) => item.condition))]),
    products: [...products.values()].sort((a, b) => b.qty - a.qty || b.value - a.value),
  };
}

/** Returns and their value for each of the last 12 months, for the chart. */
export function returnsByMonth(returns: SalesReturn[], today = localDay()) {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, month - 12 + index, 1);
    const period = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    const inMonth = returns.filter((ret) => isActive(ret.status) && ret.returnDate.startsWith(period));
    return { period, date, count: inMonth.length, value: inMonth.reduce((total, ret) => total + ret.returnValue, 0) };
  });
}

/** Sent after a return changes, so the sidebar's counts catch up straight away. */
export const RETURNS_CHANGED = 'vimalnath:returns-changed';
