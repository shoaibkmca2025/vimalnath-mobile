import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accounts, billStatus, creditDaysOf, daysBetween, dueDay, isOverdue, splitPayment, stateLabel } from '../src/data/payments.ts';
import type { Order, Payment } from '../src/data/types.ts';

/** Noon, so the day is the same wherever the tests run. */
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString();
const paid = (amount: number, paidOn = '2026-11-01'): Payment => ({ id: `${amount}-${paidOn}`, amount, method: 'cash', paidOn, by: 'Asha', at: at(paidOn) });

function order(id: string, extra: Partial<Order> & { delivered?: string } = {}): Order {
  const { delivered, ...rest } = extra;
  return {
    id,
    number: `VSC-${id}`,
    createdAt: at('2026-10-01'),
    customer: 'Laude',
    status: delivered ? 'delivered' : 'confirmed',
    lines: [{ productId: 'p', code: 'C', name: 'N', qty: 1, mrp: 10_000 }],
    total: 10_000,
    history: [{ status: 'placed', at: at('2026-10-01'), by: 'App' }, ...(delivered ? [{ status: 'delivered' as const, at: at(delivered), by: 'Asha' }] : [])],
    customerRecord: { id: 7, name: 'Laude' },
    ...rest,
  };
}

test('due day: credit is the credit period after delivery, cash is the delivery day, and nothing is due before delivery', () => {
  assert.equal(dueDay(order('1', { delivered: '2026-11-19' }), 30), '2026-12-19');
  assert.equal(dueDay(order('2', { delivered: '2026-01-31', terms: 'credit' }), 30), '2026-03-02');
  assert.equal(dueDay(order('3', { delivered: '2026-11-19', terms: 'cash' }), 30), '2026-11-19');
  assert.equal(dueDay(order('4'), 30), null);
  assert.equal(daysBetween('2026-12-19', '2027-01-03'), 15);
});

test('state: unpaid on the due day is still on time; the day after, it is overdue and counts the days late', () => {
  const delivered = order('1', { delivered: '2026-11-19', payments: [paid(4000)] });
  const onTime = billStatus(delivered, 30, '2026-12-19');
  assert.deepEqual([onTime.state, onTime.remaining, onTime.lateDays], ['due', 6000, 0]);
  assert.equal(stateLabel(onTime).label, 'Part paid · due 19 Dec');

  const late = billStatus(delivered, 30, '2026-12-24');
  assert.deepEqual([late.state, late.lateDays], ['overdue', 5]);
  assert.deepEqual(stateLabel(late), { label: 'Overdue · 5 days', tone: 'danger' });
  assert.equal(isOverdue(delivered, 30, '2026-12-24'), true);
});

test('state: paid in full, a discounted bill, not delivered yet, and a bill of ₹0 nobody has set', () => {
  assert.equal(billStatus(order('1', { delivered: '2026-01-01', payments: [paid(10_000)] }), 30, '2026-12-01').state, 'paid');
  // Staff gave a discount: ₹9,500 clears it.
  assert.equal(billStatus(order('2', { delivered: '2026-01-01', bill: 9500, payments: [paid(9500)] }), 30, '2026-12-01').state, 'paid');
  assert.equal(billStatus(order('3'), 30, '2027-06-01').state, 'open');
  assert.equal(billStatus(order('4', { delivered: '2026-01-01', total: 0, lines: [{ productId: 'p', code: 'C', name: 'N', qty: 1 }] }), 30, '2026-12-01').state, 'noBill');
});

test('overdue: cancelled orders and requests the customer hasn’t confirmed are never billed', () => {
  const cancelled = { ...order('1', { delivered: '2026-01-01' }), status: 'cancelled' as const };
  const request = order('2', { source: 'admin', status: 'requested' });
  assert.equal(isOverdue(cancelled, 30, '2026-12-01'), false);
  assert.deepEqual(accounts([cancelled, request], 30, '2026-12-01'), []);
});

test('accounts: totals per customer, unpaid bills oldest first, and the latest payment', () => {
  const [laude] = accounts(
    [
      order('new', { createdAt: at('2026-11-10'), delivered: '2026-11-15' }),
      order('old', { createdAt: at('2026-09-01'), delivered: '2026-09-05', payments: [paid(2000, '2026-10-20')] }),
      order('done', { createdAt: at('2026-08-01'), delivered: '2026-08-02', payments: [paid(10_000, '2026-08-30')] }),
    ],
    30,
    '2026-11-20',
  );
  assert.deepEqual(
    { billed: laude!.billed, paid: laude!.paid, remaining: laude!.remaining, overdue: laude!.overdue, overdueBills: laude!.overdueBills, mostLate: laude!.mostLate, lastPaid: laude!.lastPaid },
    { billed: 30_000, paid: 12_000, remaining: 18_000, overdue: 8000, overdueBills: 1, mostLate: 46, lastPaid: '2026-10-20' },
  );
  assert.deepEqual(laude!.unpaid.map((item) => item.id), ['old', 'new']);
});

test('split: a payment clears the oldest bills first, and never more than a bill owes', () => {
  const bills = [order('a', { payments: [paid(4000)] }), order('b'), order('c')];
  assert.deepEqual(
    splitPayment(bills, 12_000).map((part) => [part.order.id, part.amount, part.clears]),
    [
      ['a', 6000, true],
      ['b', 6000, false],
    ],
  );
  assert.deepEqual(splitPayment(bills, 500).map((part) => [part.order.id, part.amount]), [['a', 500]]);
});

test('credit period: the setting, or one month when it is missing or unreadable', () => {
  assert.equal(creditDaysOf({ creditDays: '45' }), 45);
  assert.equal(creditDaysOf({ creditDays: '0' }), 0);
  assert.equal(creditDaysOf({ creditDays: '' }), 30);
  assert.equal(creditDaysOf({ creditDays: 'abc' }), 30);
});
