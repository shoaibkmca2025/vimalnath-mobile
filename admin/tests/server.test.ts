import assert from 'node:assert/strict';
import { test } from 'node:test';

import { changed, serverRequests } from '../src/data/server.ts';
import type { Category, Order, Product } from '../src/data/types.ts';

const product = (id: string, mrp = 1500): Product => ({
  id,
  code: id.toUpperCase(),
  name: 'Handle',
  category: 'glass',
  section: 'Door Handles',
  image: null,
  catalogPage: { source: 'master', page: 10 },
  options: [{ label: 'SSS', mrp }],
  specs: [],
  featured: false,
  visible: true,
});
const products = [product('a'), product('b'), product('c')];

test('catalogue saves: nothing changed sends nothing', () => {
  assert.deepEqual(serverRequests('products', products, products), []);
  assert.deepEqual(serverRequests('products', products, [...products]), []);
});

test('catalogue saves: only the edited product is sent, not the whole list', () => {
  const after = products.map((item) => (item.id === 'b' ? product('b', 1800) : item));
  assert.deepEqual(serverRequests('products', products, after), [{ path: '/products', method: 'PUT', body: { products: [product('b', 1800)] } }]);
});

test('catalogue saves: a new product is sent, a removed one deleted', () => {
  assert.deepEqual(serverRequests('products', products, [product('new'), ...products]), [{ path: '/products', method: 'PUT', body: { products: [product('new')] } }]);
  assert.deepEqual(serverRequests('products', products, products.filter((item) => item.id !== 'b')), [{ path: '/products/b', method: 'DELETE' }]);
  // Ids end up in the address, so odd characters must not change which product is deleted.
  assert.deepEqual(serverRequests('products', [product('a/b?')], []), [{ path: '/products/a%2Fb%3F', method: 'DELETE' }]);
});

test('catalogue saves: bulk hiding sends every hidden product in one request', () => {
  const after = products.map((item) => ({ ...item, visible: false }));
  const requests = serverRequests('products', products, after);
  assert.equal(requests.length, 1);
  assert.equal((requests[0]!.body as { products: Product[] }).products.length, 3);
});

test('catalogue saves: categories and price lists are sent whole, in their new order', () => {
  const glass: Category = { id: 'glass', label: 'Glass', image: '/media/a.webp', fit: 'cover', visible: true };
  const doors: Category = { ...glass, id: 'doors', label: 'Doors' };
  assert.deepEqual(serverRequests('categories', [glass, doors], [doors, glass]), [{ path: '/categories', method: 'PUT', body: { categories: [doors, glass] } }]);
  const lists = [{ number: '01', kicker: 'MASTER', title: 'Master', meta: 'Feb 2026', tone: 'blue', url: '' }];
  assert.deepEqual(serverRequests('catalogues', lists, lists), []);
});

const order = (id: string, status: Order['status'] = 'placed', note?: string): Order => ({
  id,
  number: `VSC-000${id}`,
  createdAt: '2026-11-14T10:00:00.000Z',
  customer: 'Site A',
  status,
  lines: [{ productId: 'p1', code: 'TGH-55', name: 'Handle', qty: 1, mrp: 1500 }],
  total: 1500,
  history: [{ status: 'placed', at: '2026-11-14T10:00:00.000Z', by: 'App' }],
  ...(note ? { internalNote: { text: note, at: '2026-11-14T11:00:00.000Z', by: 'Priya' } } : {}),
});

test('order saves: one request per new status, however many orders moved', () => {
  const before = [order('1'), order('2'), order('3', 'confirmed')];
  const after = [order('1', 'confirmed'), order('2', 'confirmed'), order('3', 'dispatched')];
  assert.deepEqual(serverRequests('orders', before, after), [
    { path: '/orders/status', method: 'POST', body: { ids: ['1', '2'], status: 'confirmed' } },
    { path: '/orders/status', method: 'POST', body: { ids: ['3'], status: 'dispatched' } },
  ]);
  // Undo puts the old list back: the same orders move back.
  assert.deepEqual(serverRequests('orders', after, before), [
    { path: '/orders/status', method: 'POST', body: { ids: ['1', '2'], status: 'placed' } },
    { path: '/orders/status', method: 'POST', body: { ids: ['3'], status: 'confirmed' } },
  ]);
});

test('order saves: a changed or removed internal note is sent; nothing else is', () => {
  assert.deepEqual(serverRequests('orders', [order('1')], [order('1', 'placed', 'Quoted ₹2,400')]), [{ path: '/orders/1/internal-note', method: 'PUT', body: { text: 'Quoted ₹2,400' } }]);
  assert.deepEqual(serverRequests('orders', [order('1', 'placed', 'x')], [order('1')]), [{ path: '/orders/1/internal-note', method: 'PUT', body: { text: '' } }]);
  assert.deepEqual(serverRequests('orders', [order('1')], [order('1')]), []);
});

test('order saves: the inventory note is sent the same way, and a request added to the list sends nothing (its page already sent it)', () => {
  const noted = { ...order('1'), inventoryNote: { text: 'VRL, LR 4471', at: '2026-11-18T10:00:00Z', by: 'Imran' } };
  assert.deepEqual(serverRequests('orders', [order('1')], [noted]), [{ path: '/orders/1/inventory-note', method: 'PUT', body: { text: 'VRL, LR 4471' } }]);
  assert.deepEqual(serverRequests('orders', [noted], [order('1')]), [{ path: '/orders/1/inventory-note', method: 'PUT', body: { text: '' } }]);
  assert.deepEqual(serverRequests('orders', [order('1')], [order('2', 'requested'), order('1')]), []);
});

test('calculator saves: the cutlist and the bar sections are sent whole, and only when they changed', () => {
  const cutlist = { systems: [], configurations: { telescopic: [], synchronized: [], folding: [] } };
  const edited = { ...cutlist, configurations: { ...cutlist.configurations, folding: [{ name: '2 Door', image: '/media/f.jpg' }] } };
  assert.deepEqual(serverRequests('cutlist', cutlist, edited), [{ path: '/cutlist', method: 'PUT', body: { cutlist: edited } }]);
  assert.deepEqual(serverRequests('cutlist', cutlist, cutlist), []);
  const sections = [{ code: 'S-101', name: 'Frame', system: 'Sliding', bar: 6000, dimensions: '', description: '' }];
  assert.deepEqual(serverRequests('sections', sections, []), [{ path: '/bar-sections', method: 'PUT', body: { sections: [] } }]);
});

test('the activity log keeps only what changed: list items that differ, or the fields of an object', () => {
  const [a, b, c] = [product('a'), product('b'), product('c')];
  assert.deepEqual(changed([a, b], [a, product('b', 1600), c]), { before: [b], after: [product('b', 1600), c] });
  assert.deepEqual(changed([a, b], [b, a]), { before: [], after: [] });
  assert.deepEqual(changed({ phone: '', email: 'x@y.in', logo: '/l.png' }, { phone: '+91 22', email: 'x@y.in', logo: '/l.png' }), { before: { phone: '' }, after: { phone: '+91 22' } });
});
