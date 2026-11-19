import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeCsv, exportRows, mergeStock, parseCsv, planImport, stockAlerts, stockRows, stockState, stockValue } from '../src/data/stock.ts';
import type { Product, StockItem } from '../src/data/types.ts';
import { toCsv } from '../src/lib/csv.ts';

const product = (id: string, options: string[]): Product => ({
  id,
  code: id.toUpperCase(),
  name: `Product ${id}`,
  category: 'glass',
  section: 'Section',
  image: null,
  catalogPage: { source: 'master', page: 1 },
  options: options.map((label) => ({ label, mrp: 1000 })),
  specs: [],
  featured: false,
  visible: true,
});

const item = (productId: string, option: string, extra: Partial<StockItem> = {}): StockItem => ({
  productId,
  option,
  sku: '',
  barcode: '',
  unit: 'pcs',
  brand: '',
  manufacturer: '',
  hsn: '',
  gstRate: null,
  purchasePrice: null,
  sellingPrice: null,
  wholesalePrice: null,
  quantity: 10,
  minStock: null,
  maxStock: null,
  rack: '',
  location: '',
  updatedAt: '2026-11-19T10:00:00.000Z',
  orphan: false,
  ...extra,
});

test('state: out at 0 or below, low at or under the minimum, over above the maximum', () => {
  assert.equal(stockState(undefined), 'untracked');
  assert.equal(stockState(item('a', '', { quantity: 0, minStock: 5 })), 'out');
  assert.equal(stockState(item('a', '', { quantity: -2 })), 'out');
  assert.equal(stockState(item('a', '', { quantity: 5, minStock: 5 })), 'low');
  assert.equal(stockState(item('a', '', { quantity: 51, maxStock: 50 })), 'over');
  assert.equal(stockState(item('a', '', { quantity: 6, minStock: 5, maxStock: 50 })), 'ok');
  assert.deepEqual(stockAlerts([item('a', '', { quantity: 0 }), item('b', '', { quantity: 1, minStock: 2 }), item('c', '', { quantity: 9, maxStock: 3 })]), { out: 1, low: 1, over: 1 });
});

test('rows: every option is an item, a product without options is one, and stock left by a renamed option is listed last', () => {
  const rows = stockRows([product('p1', ['SSS', 'BM']), product('p2', [])], [item('p1', 'BM'), item('p1', 'Gold', { orphan: true })]);
  assert.deepEqual(
    rows.map((row) => [row.title, row.option, row.state]),
    [
      ['Product p1 · SSS', 'SSS', 'untracked'],
      ['Product p1 · BM', 'BM', 'ok'],
      ['Product p2', '', 'untracked'],
      ['Product p1 · Gold', 'Gold', 'ok'],
    ],
  );
});

test('value: quantity at purchase price, nothing for stock below zero or without a price', () => {
  assert.deepEqual(stockValue([item('a', '', { quantity: 4, purchasePrice: 812.5 }), item('b', '', { quantity: -3, purchasePrice: 100 }), item('c', '', { quantity: 9 })]), { value: 3250, priced: 2 });
});

test('merge: changed items replaced in place, new ones added, removed ones gone', () => {
  const merged = mergeStock([item('a', ''), item('b', ''), item('c', '')], { stock: [item('b', '', { quantity: 1 }), item('d', '')], removedStock: [{ productId: 'c', option: '' }] });
  assert.deepEqual(merged.map((one) => [one.productId, one.quantity]), [['a', 10], ['b', 1], ['d', 10]]);
});

test('csv: quotes, commas and line breaks in cells, Windows line ends, and Excel’s Windows-1252 save', () => {
  assert.deepEqual(parseCsv('﻿a,"b, c","say ""hi"""\r\n"two\nlines",,x\r\n\r\n'), [
    ['a', 'b, c', 'say "hi"'],
    ['two\nlines', '', 'x'],
  ]);
  // "Kit · BM" saved by Excel as plain CSV: the dot is byte 0xB7.
  const ansi = new Uint8Array([...new TextEncoder().encode('Kit '), 0xb7, ...new TextEncoder().encode(' BM')]);
  assert.equal(decodeCsv(ansi.buffer), 'Kit · BM');
  assert.equal(decodeCsv(new TextEncoder().encode('Kit · BM').buffer as ArrayBuffer), 'Kit · BM');
});

test('import: an untouched export changes nothing; edits become saves, a new “In stock” a count', () => {
  const products = [product('p1', ['SSS', 'BM']), product('p2', [])];
  const rows = stockRows(products, [item('p1', 'SSS', { quantity: -2, purchasePrice: 812.5, minStock: 5, rack: 'A-3' })]);
  const exported = exportRows(rows, true);
  const csv = toCsv(exported.header, exported.rows);
  assert.deepEqual(planImport(csv, rows, true), { saves: [], added: 0, changed: 0, unchanged: 1, errors: [] });

  const lines = csv.split('\r\n');
  // SSS counted at 7 and moved to rack B-1; BM set up with 4 in stock; p2 left empty, so skipped.
  lines[1] = lines[1]!.replace(',-2,', ',7,').replace(',A-3,', ',B-1,');
  lines[2] = lines[2]!.replace(/,,,,,,,,$/, ',,,,4,,,,');
  const plan = planImport(lines.join('\r\n'), rows, true);
  assert.deepEqual([plan.added, plan.changed, plan.unchanged, plan.errors], [1, 1, 0, []]);
  assert.deepEqual(plan.saves.map((save) => [save.option, save.quantity, save.rack, save.purchasePrice]), [
    ['SSS', 7, 'B-1', 812.5],
    ['BM', 4, '', null],
  ]);
});

test('import: rows that don’t match or don’t make sense are listed, and the rest still go through', () => {
  const rows = stockRows([product('p1', ['SSS', 'BM'])], []);
  const csv = toCsv(
    ['Product ID', 'Option', 'Unit', 'GST %', 'HSN', 'In stock', 'Min stock', 'Max stock'],
    [
      ['p1', 'SSS', 'BOX', 18, '8302', 12, 2, 40],
      ['p1', 'Gold', 'PCS', '', '', 3, '', ''],
      ['p1', 'BM', 'DOZEN', 15, '83021', '-1', 9, 3],
    ],
  );
  const plan = planImport(csv, rows, false);
  assert.deepEqual(plan.saves.map((save) => [save.option, save.unit, save.gstRate, save.hsn, save.quantity, 'purchasePrice' in save]), [['SSS', 'box', 18, '8302', 12, false]]);
  assert.equal(plan.errors.length, 2);
  assert.match(plan.errors[0]!, /Row 3: no item with Product ID “p1” and option “Gold”/);
  assert.match(plan.errors[1]!, /Unit “DOZEN”.*GST % 15.*HSN “83021”.*In stock can’t be below 0.*Max stock is below Min stock/);
  assert.deepEqual(planImport('Product,Qty\r\nx,1', rows, true).errors, ['The file needs the Product ID, Option, In stock columns. Start from Export CSV.']);
});
