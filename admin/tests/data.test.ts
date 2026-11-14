import assert from 'node:assert/strict';
import { test } from 'node:test';

import { customersFromOrders, nextStatus, whatsappLink } from '../src/data/orders.ts';
import type { Order } from '../src/data/types.ts';
import { escapeHtml, withTimeout } from '../src/generated/app-lib/pdf-html.ts';
import { toCsv } from '../src/lib/csv.ts';

test('csv: cells Excel would run as formulas become plain text; phone numbers and real numbers stay as they are', () => {
  const [, first, second, third] = toCsv(
    ['Customer', 'Phone', 'Total'],
    [
      ['=HYPERLINK("http://x")', '+91 90000 10231', 1500],
      ['@SUM(A1)', '-1+2', -5],
      ['+cmd', null, undefined],
    ],
  ).split('\r\n');
  assert.equal(first, `"'=HYPERLINK(""http://x"")",+91 90000 10231,1500`);
  assert.equal(second, `'@SUM(A1),'-1+2,-5`);
  assert.equal(third, `'+cmd,,`);
});

test('csv: commas, quotes and line breaks stay inside their cell', () => {
  assert.equal(toCsv(['Address'], [['Shop 4, "Main" Road\nPune']]), 'Address\r\n"Shop 4, ""Main"" Road\nPune"');
});

const order = (customer: string, status: Order['status'], total: number, createdAt: string, phone?: string): Order => ({
  id: createdAt,
  number: 'VSC-0001',
  createdAt,
  customer,
  ...(phone ? { phone } : {}),
  status,
  lines: [{ productId: 'p', code: 'C', name: 'N', qty: 2, mrp: total / 2 }],
  total,
  history: [],
});

test('customers: one per name however it is typed; cancelled orders are not counted as spent', () => {
  // Times as the server sends them: +00:00, with fractions of a second that vary in length.
  const [ravi, anil] = customersFromOrders([
    order('Ravi & Sons', 'delivered', 1000, '2026-11-01T10:00:00+00:00', '90000 10231'),
    order('ravi and sons', 'placed', 500, '2026-11-14T12:54:03.12+00:00', '98200 12345'),
    order('RAVI AND SONS ', 'cancelled', 9999, '2026-11-14T12:54:03.5+00:00'),
    order('Anil', 'confirmed', 200, '2026-11-10T09:00:00.000Z'),
  ]);
  assert.deepEqual(
    { ...ravi },
    { key: 'ravi-and-sons', name: 'Ravi & Sons', orders: 3, spent: 1500, open: 1, firstOrder: '2026-11-01T10:00:00+00:00', lastOrder: '2026-11-14T12:54:03.5+00:00', phone: '98200 12345' },
  );
  assert.equal(anil?.spent, 200);
});

test('order steps: placed → confirmed → dispatched → delivered, and nothing after delivered or cancelled', () => {
  assert.deepEqual((['placed', 'confirmed', 'dispatched', 'delivered', 'cancelled'] as const).map(nextStatus), ['confirmed', 'dispatched', 'delivered', null, null]);
});

test('WhatsApp links: an Indian mobile number gets 91 in front; other countries keep theirs', () => {
  assert.equal(whatsappLink('98200 12345'), 'https://wa.me/919820012345');
  assert.equal(whatsappLink('+91 98200-12345'), 'https://wa.me/919820012345');
  assert.equal(whatsappLink('+44 20 7946 0000'), 'https://wa.me/442079460000');
});

test('app PDFs: text typed by a customer can’t become HTML in the order PDF', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('hi')"> & Sons`), '&lt;img src=x onerror=&quot;alert(&#39;hi&#39;)&quot;&gt; &amp; Sons');
});

test('app PDFs: a stuck PDF step gives up instead of spinning forever', async () => {
  assert.equal(await withTimeout(Promise.resolve('done'), 50, 'PDF'), 'done');
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'PDF'), /PDF timed out/);
});
