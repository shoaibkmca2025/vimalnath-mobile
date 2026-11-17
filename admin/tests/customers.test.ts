import assert from 'node:assert/strict';
import { test } from 'node:test';

import { duplicatePairs, type CustomerRecord } from '../src/data/customers.ts';
import { customersFromOrders } from '../src/data/orders.ts';
import type { Order } from '../src/data/types.ts';

const customer = (id: number, name: string, phone = '', orders = 0, appPhones: string[] = []): CustomerRecord => ({
  id,
  name,
  tags: [],
  note: '',
  createdAt: '2026-11-01T00:00:00Z',
  phone,
  business: '',
  email: '',
  city: '',
  appUsers: appPhones.map((each, index) => ({ id: id * 10 + index, label: name, phone: each, lastSeenAt: null, blocked: false })),
  orders,
  spent: 0,
  open: 0,
  firstOrder: null,
  lastOrder: null,
});

test('duplicates: the same phone however it is written, or the same name however it is typed', () => {
  const pairs = duplicatePairs([
    customer(1, 'Ravi Glass Works', '+91 98200 12345', 4),
    customer(2, 'Ravi (site phone)', '', 9, ['098200-12345']),
    customer(3, 'Patel Glass & Hardware', '', 1),
    customer(4, 'patel glass and hardware', '', 0),
    customer(5, 'Anil Traders', '98200 99999', 2),
  ]);
  assert.deepEqual(
    pairs.map((pair) => [pair.keep.id, pair.merge.id, pair.reason]),
    [
      // The one with more orders is kept.
      [2, 1, 'Same phone number, +91 98200 12345'],
      [3, 4, 'Same name'],
    ],
  );
});

test('duplicates: short numbers and one-off customers are never suggested', () => {
  assert.deepEqual(duplicatePairs([customer(1, 'A', '12345'), customer(2, 'B', '12345'), customer(3, 'C', '98200 11111')]), []);
});

test('customers group by their record, not by the name typed on each order', () => {
  const order = (id: string, customerName: string, record?: { id: number; name: string }): Order => ({
    id,
    number: `VSC-000${id}`,
    createdAt: `2026-11-1${id}T10:00:00+00:00`,
    customer: customerName,
    status: 'placed',
    lines: [{ productId: 'p', code: 'C', name: 'N', qty: 1, mrp: 100 }],
    total: 100,
    history: [],
    ...(record ? { customerRecord: record } : {}),
  });
  const grouped = customersFromOrders([
    order('1', 'Site A', { id: 7, name: 'Ravi Glass Works' }),
    order('2', 'Site B', { id: 7, name: 'Ravi Glass Works' }),
    order('3', 'Walk-in'),
  ]);
  assert.deepEqual(grouped.map((each) => [each.key, each.name, each.orders]), [
    ['7', 'Ravi Glass Works', 2],
    ['walk-in', 'Walk-in', 1],
  ]);
});
