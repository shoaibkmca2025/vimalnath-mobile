import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Category, PriceList, Product } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { catalogueRoutes } from '../src/catalogue.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

type Catalogue = { products: Product[]; categories: Category[]; catalogues: PriceList[]; catalogPages: Record<string, string> };

testDatabase('catalogue', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/', catalogueRoutes(sql));
  app.route('/v1/admin', admin);
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/v1/admin${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

/** A signed-in staff member's cookie header. */
async function staff(role: string) {
  const email = `staff${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Staff ${next}`}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

const read = async () => (await (await send('/catalogue', 'GET', undefined, await staff('sales'))).json()) as Catalogue;
const editor = () => staff('catalogue');
const errorOf = async (res: Response) => ((await res.json()) as { error: { message: string; field?: string } }).error;
const [p1, p2] = seed.products as [Product, Product];

test('read: the catalogue comes back exactly as it was imported', { skip }, async () => {
  const catalogue = await read();
  assert.deepEqual(catalogue.products, seed.products);
  assert.deepEqual(catalogue.categories, seed.categories);
  assert.deepEqual(catalogue.catalogues, seed.catalogues);
  assert.deepEqual(catalogue.catalogPages, seed.catalogPages);
});

test('products: an edit replaces options and specs; a new product goes to the top', { skip }, async () => {
  const edited: Product = { ...p1, name: 'H Handle', options: [{ label: 'BM', mrp: 1800 }], specs: [{ label: 'Finish', value: 'Brass' }, { label: 'Size', value: '300 mm' }], featured: false };
  const added: Product = { ...p2, id: 'custom-tgh-60', code: 'TGH-60', options: [{ label: 'SSS', code: 'TGH-60-S', mrp: 2100 }] };
  assert.equal((await send('/products', 'PUT', { products: [edited, added] }, await editor())).status, 204);

  const { products } = await read();
  assert.deepEqual(products.map((product) => product.id), ['custom-tgh-60', 'p1', 'p2']);
  assert.deepEqual(products.find((product) => product.id === 'p1'), edited);
  assert.deepEqual(products.find((product) => product.id === 'custom-tgh-60'), added);
  assert.deepEqual(products.find((product) => product.id === 'p2'), p2);
});

test('products: refused input names the problem and saves none of the batch', { skip }, async () => {
  const cookie = await editor();
  const refuse = async (product: unknown) => {
    const res = await send('/products', 'PUT', { products: [{ ...p2, name: 'Should not save' }, product] }, cookie);
    assert.equal(res.status, 400);
    return errorOf(res);
  };
  assert.equal((await refuse({ ...p1, options: [{ label: 'SSS', mrp: 1500.5 }] })).message, 'Enter the MRP in whole rupees.');
  assert.equal((await refuse({ ...p1, options: [{ label: 'SSS', mrp: 1 }, { label: 'SSS', mrp: 2 }] })).message, 'Each option needs a different name.');
  assert.equal((await refuse({ ...p1, name: '', section: '' })).field, 'products.1.name');
  assert.equal((await refuse({ ...p1, image: 'javascript:alert(1)' })).message, 'Choose a JPG, PNG or WebP photo.');
  // Only the database knows which categories exist, so this one fails inside the transaction.
  assert.equal((await refuse({ ...p1, category: 'nope' })).field, 'category');
  assert.equal((await read()).products.find((product) => product.id === 'p2')!.name, '');
});

test('products: an uploaded photo is kept by its address; a photo inside the request is refused', { skip }, async () => {
  const cookie = await editor();
  const image = '/v1/media/0123456789abcdef01234567.webp';
  assert.equal((await send('/products', 'PUT', { products: [{ ...p2, image }] }, cookie)).status, 204);
  assert.equal((await read()).products.find((product) => product.id === 'p2')!.image, image);
  assert.equal((await send('/products', 'PUT', { products: [{ ...p2, image: 'data:image/png;base64,iVBORw0KGgo=' }] }, cookie)).status, 400);
});

test('delete: the product and its options go; a second delete is 404', { skip }, async () => {
  const cookie = await editor();
  assert.equal((await send('/products/custom-tgh-60', 'DELETE', undefined, cookie)).status, 204);
  assert.equal((await send('/products/custom-tgh-60', 'DELETE', undefined, cookie)).status, 404);
  const [row] = await sql`select count(*)::int as count from product_options where product_id = 'custom-tgh-60'`;
  assert.equal(row!.count, 0);
});

test('categories and price lists: saved in the order sent; a price list link must be https', { skip }, async () => {
  const cookie = await editor();
  const second: Category = { id: 'doorControl', label: 'Door Control', image: '/media/d.webp', fit: 'contain', visible: false };
  assert.equal((await send('/categories', 'PUT', { categories: [second, { ...seed.categories[0]!, label: 'Glass' }] }, cookie)).status, 204);
  const lists: PriceList[] = [
    { number: '02', kicker: 'SPACE', title: 'Space Systems', meta: 'Feb 2026', tone: 'blue', url: 'https://example.com/space.pdf' },
    { ...seed.catalogues[0]!, url: '/v1/media/0123456789abcdef01234567.pdf' },
  ];
  assert.equal((await send('/price-lists', 'PUT', { priceLists: lists }, cookie)).status, 204);

  const catalogue = await read();
  assert.deepEqual(catalogue.categories, [second, { ...seed.categories[0]!, label: 'Glass' }]);
  assert.deepEqual(catalogue.catalogues, lists);

  const insecure = await send('/price-lists', 'PUT', { priceLists: [{ ...lists[0]!, url: 'http://example.com/space.pdf' }] }, cookie);
  assert.equal((await errorOf(insecure)).message, 'Use a secure link that starts with https://.');
});

test('access: everyone signed in reads; only Owners and Catalogue editors change', { skip }, async () => {
  assert.equal((await send('/catalogue')).status, 401);
  const sales = await staff('sales');
  assert.equal((await send('/catalogue', 'GET', undefined, sales)).status, 200);
  assert.equal((await send('/products', 'PUT', { products: [p2] }, sales)).status, 403);
  assert.equal((await send('/products/p2', 'DELETE', undefined, sales)).status, 403);
  assert.equal((await send('/categories', 'PUT', { categories: seed.categories }, sales)).status, 403);
  assert.equal((await send('/products', 'PUT', { products: [p2] }, await staff('owner'))).status, 204);
});
