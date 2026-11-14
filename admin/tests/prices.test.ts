import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bulkPrice, priceKey, priceRows, withPrices } from '../src/data/prices.ts';
import type { Product } from '../src/data/types.ts';

const product = (id: string, options: Product['options']): Product => ({
  id,
  code: id.toUpperCase(),
  name: '',
  category: 'glass',
  section: 'Door Handles',
  image: null,
  catalogPage: { source: 'master', page: 10 },
  options,
  specs: [],
  featured: false,
  visible: true,
});

test('bulk price: percent or rupees, up or down, rounded to the step chosen', () => {
  assert.equal(bulkPrice(1500, { direction: 'up', by: 'percent', amount: 8, roundTo: 10 }), 1620);
  assert.equal(bulkPrice(999, { direction: 'up', by: 'percent', amount: 10, roundTo: 1 }), 1099);
  assert.equal(bulkPrice(1234, { direction: 'up', by: 'percent', amount: 10, roundTo: 50 }), 1350);
  assert.equal(bulkPrice(2475, { direction: 'down', by: 'percent', amount: 5, roundTo: 100 }), 2400);
  assert.equal(bulkPrice(1500, { direction: 'down', by: 'rupees', amount: 125, roundTo: 1 }), 1375);
  assert.equal(bulkPrice(387000, { direction: 'up', by: 'percent', amount: 2.5, roundTo: 100 }), 396700);
});

test('bulk price: a change that would take an MRP to ₹0 or below gives no price, never a negative one', () => {
  assert.equal(bulkPrice(100, { direction: 'down', by: 'rupees', amount: 100, roundTo: 1 }), null);
  assert.equal(bulkPrice(40, { direction: 'up', by: 'percent', amount: 1, roundTo: 100 }), null);
  assert.equal(bulkPrice(500, { direction: 'down', by: 'percent', amount: 100, roundTo: 1 }), null);
});

test('price rows: one per option, named by the section when the product has no name', () => {
  const rows = priceRows([product('p1', [{ label: 'SSS', code: 'P1-S', mrp: 1500 }, { label: 'BM', mrp: 1700 }]), product('p2', [])]);
  assert.deepEqual(rows.map((row) => [row.key, row.name, row.option, row.optionCode, row.mrp]), [
    [priceKey('p1', 'SSS'), 'Door Handles', 'SSS', 'P1-S', 1500],
    [priceKey('p1', 'BM'), 'Door Handles', 'BM', undefined, 1700],
  ]);
});

test('new prices: only products with a changed price become new objects, so only they are saved', () => {
  const products = [product('p1', [{ label: 'SSS', mrp: 1500 }, { label: 'BM', mrp: 1700 }]), product('p2', [{ label: 'SSS', mrp: 900 }])];
  const next = withPrices(products, new Map([[priceKey('p1', 'BM'), 1800]]));
  assert.deepEqual(next[0]!.options, [{ label: 'SSS', mrp: 1500 }, { label: 'BM', mrp: 1800 }]);
  assert.equal(next[1], products[1]);
  assert.equal(products[0]!.options[1]!.mrp, 1700);
});
