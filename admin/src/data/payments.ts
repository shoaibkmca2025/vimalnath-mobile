import { customerOf } from './orders.ts';
import { inOrders } from './requests.ts';
import type { Order, PaymentMethod, PaymentTerms, Settings } from './types';

/**
 * Payments. Every order in Orders that isn't cancelled is a bill: its amount (the MRP total unless staff changed it),
 * what has been paid towards it, and when it falls due: on delivery for cash, the credit period after delivery for
 * credit. A bill still unpaid after that day is overdue, and shows in red.
 */

export const PAYMENT_METHODS: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', cheque: 'Cheque', return: 'Return refund', store_credit: 'Store credit' };
/** What staff choose when recording a customer's payment; a return's refund is recorded from the return. */
export const CUSTOMER_METHODS: PaymentMethod[] = ['cash', 'upi', 'bank', 'cheque', 'store_credit'];
/** Money methods only: what suppliers are paid with. */
export const MONEY_METHODS: PaymentMethod[] = ['cash', 'upi', 'bank', 'cheque'];
export const PAYMENT_TERMS: Record<PaymentTerms, string> = { cash: 'Cash', credit: 'Credit' };

const BILLED = new Set<Order['status']>(['placed', 'confirmed', 'packed', 'dispatched', 'delivered']);
/** Orders the customer owes for: in Orders (a request once they confirm it), and not cancelled. The server agrees. */
export const isBilled = (order: Order) => inOrders(order) && BILLED.has(order.status);

export const billOf = (order: Order) => order.bill ?? order.total;
export const paidOf = (order: Order) => (order.payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
export const remainingOf = (order: Order) => Math.max(0, billOf(order) - paidOf(order));
export const termsOf = (order: Order): PaymentTerms => order.terms ?? 'credit';

/** The credit period in days, one month if the setting is missing or unreadable. */
export const creditDaysOf = (settings: Pick<Settings, 'creditDays'>) => {
  const days = Number(settings.creditDays);
  return settings.creditDays !== '' && Number.isInteger(days) && days >= 0 ? days : 30;
};

const pad = (value: number) => String(value).padStart(2, '0');
/** A day here, where the admin is open, as YYYY-MM-DD. Days compare as text. */
export const localDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
const addDays = (day: string, days: number) => {
  const [year, month, date] = parts(day);
  return localDay(new Date(year, month - 1, date + days));
};
/** Whole days from one day to a later one. */
export const daysBetween = (from: string, to: string) => Math.round((Date.UTC(...shift(parts(to))) - Date.UTC(...shift(parts(from)))) / 86_400_000);
const shift = ([year, month, date]: [number, number, number]): [number, number, number] => [year, month - 1, date];
/** "19 Dec 2026" from 2026-12-19, without the time zone moving it a day. */
export const dayLabel = (day: string) => {
  const [year, month, date] = parts(day);
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, date));
};

/** The day an order was delivered, if it is delivered now. */
export const deliveredDay = (order: Order) => {
  if (order.status !== 'delivered') return null;
  const event = order.history.findLast((step) => step.status === 'delivered');
  return event ? localDay(new Date(event.at)) : null;
};

/** The last day to pay without being late: delivery for cash, the credit period after it for credit. Null until delivered. */
export function dueDay(order: Order, creditDays: number) {
  const delivered = deliveredDay(order);
  return delivered && addDays(delivered, termsOf(order) === 'cash' ? 0 : creditDays);
}

/**
 * paid: nothing left to pay. overdue: delivered, and past its due day. due: delivered, and not due yet.
 * open: not delivered yet, so not due. noBill: a total of ₹0 (every line priced from the catalogue) and no bill set.
 */
export type PaymentState = 'paid' | 'overdue' | 'due' | 'open' | 'noBill';
export type BillStatus = { state: PaymentState; bill: number; paid: number; remaining: number; due: string | null; lateDays: number };

export function billStatus(order: Order, creditDays: number, today = localDay()): BillStatus {
  const bill = billOf(order);
  const paid = paidOf(order);
  const remaining = Math.max(0, bill - paid);
  const due = dueDay(order, creditDays);
  const late = Boolean(due && today > due && remaining > 0);
  const state: PaymentState = bill === 0 && paid === 0 ? 'noBill' : remaining === 0 ? 'paid' : late ? 'overdue' : due ? 'due' : 'open';
  return { state, bill, paid, remaining, due, lateDays: late ? daysBetween(due!, today) : 0 };
}

export const isOverdue = (order: Order, creditDays: number, today = localDay()) => isBilled(order) && billStatus(order, creditDays, today).state === 'overdue';

/** "Overdue · 12 days", "Due 19 Dec", "Paid": the bill's state in a few words, and its badge tone. */
export function stateLabel(status: BillStatus): { label: string; tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral' } {
  const part = status.paid > 0 ? 'Part paid' : 'Unpaid';
  switch (status.state) {
    case 'paid':
      return { label: 'Paid', tone: 'success' };
    case 'overdue':
      return { label: `Overdue · ${status.lateDays} ${status.lateDays === 1 ? 'day' : 'days'}`, tone: 'danger' };
    case 'due':
      return { label: `${part} · due ${dayLabel(status.due!).replace(/ \d{4}$/, '')}`, tone: 'warning' };
    case 'open':
      return { label: `${part} · not delivered`, tone: 'neutral' };
    case 'noBill':
      return { label: 'Bill not set', tone: 'warning' };
  }
}

/** What one customer owes across their bills. */
export type Account = {
  key: string;
  name: string;
  phone?: string;
  /** Bills with something still to pay. */
  unpaid: Order[];
  billed: number;
  paid: number;
  remaining: number;
  overdue: number;
  overdueBills: number;
  /** Days the oldest overdue bill is late. */
  mostLate: number;
  lastPaid: string | null;
};

/** Every customer with a bill, worked out from the orders this admin has loaded. Unpaid bills are oldest first. */
export function accounts(orders: Order[], creditDays: number, today = localDay()): Account[] {
  const byKey = new Map<string, Account>();
  for (const order of [...orders].filter(isBilled).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const { key, name } = customerOf(order);
    const account = byKey.get(key) ?? { key, name, unpaid: [], billed: 0, paid: 0, remaining: 0, overdue: 0, overdueBills: 0, mostLate: 0, lastPaid: null };
    const status = billStatus(order, creditDays, today);
    if (order.phone) account.phone = order.phone;
    account.billed += status.bill;
    account.paid += status.paid;
    account.remaining += status.remaining;
    if (status.remaining > 0) account.unpaid.push(order);
    if (status.state === 'overdue') {
      account.overdue += status.remaining;
      account.overdueBills += 1;
      account.mostLate = Math.max(account.mostLate, status.lateDays);
    }
    for (const payment of order.payments ?? []) if (!account.lastPaid || payment.paidOn > account.lastPaid) account.lastPaid = payment.paidOn;
    byKey.set(key, account);
  }
  return [...byKey.values()];
}

/**
 * Money a customer paid, applied to their unpaid bills oldest first: it clears each bill before starting the next.
 * `orders` must be oldest first, as Account.unpaid is.
 */
export function splitPayment(orders: Order[], amount: number) {
  let left = amount;
  const parts: { order: Order; amount: number; clears: boolean }[] = [];
  for (const order of orders) {
    if (left <= 0) break;
    const remaining = remainingOf(order);
    if (remaining <= 0) continue;
    const take = Math.min(left, remaining);
    parts.push({ order, amount: take, clears: take === remaining });
    left -= take;
  }
  return parts;
}
