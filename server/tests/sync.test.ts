import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { appRoutes, appUserAdminRoutes } from '../src/app-users.ts';
import { catalogueRoutes } from '../src/catalogue.ts';
import { contentRoutes } from '../src/content.ts';
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

testDatabase('sync', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/app-users', appUserAdminRoutes(sql));
  admin.route('/', catalogueRoutes(sql));
  admin.route('/', contentRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

async function owner() {
  const email = `owner${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Owner ${next}`}, ${email}, 'owner') returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

type Download = { version: string; content?: Record<string, unknown[] | Record<string, unknown>> };

async function phone() {
  const res = await send('/v1/app/register', 'POST', { name: `Phone ${++next}`, phone: `95${String(next).padStart(8, '0')}`, password: 'phone password' });
  const { token } = (await res.json()) as { token: string };
  return async (have?: string) => {
    const res = await send(`/v1/app/content${have ? `?have=${have}` : ''}`, 'GET', undefined, { Authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    return (await res.json()) as Download;
  };
}

test('a linked phone gets everything the app shows, then only the version while nothing changes', { skip }, async () => {
  const download = await phone();
  const first = await download();
  assert.match(first.version, /^[0-9a-f]{16}$/);
  const content = first.content!;
  assert.deepEqual(Object.keys(content), ['products', 'categories', 'catalogPages', 'priceLists', 'cutlist', 'sections', 'banners', 'videoSections', 'moreApps', 'settings']);
  assert.deepEqual(
    content.products!,
    seed.products.map(({ visible: _, ...product }) => ({ ...product, options: product.options.map(({ code, ...option }) => (code ? { label: option.label, code, mrp: option.mrp } : option)) })),
  );
  assert.deepEqual(content.categories, seed.categories.map(({ visible: _, ...category }) => category));
  assert.deepEqual(content.banners, seed.banners.map(({ active: _, ...banner }) => banner));
  assert.deepEqual([content.priceLists, content.sections, content.videoSections, content.catalogPages], [seed.catalogues, seed.sections, seed.videoSections, seed.catalogPages]);
  assert.equal((content.settings as Record<string, string>).companyName, seed.settings.companyName);

  assert.deepEqual(await download(first.version), { version: first.version });
  assert.deepEqual(await download('0000000000000000'), first);
});

test('an admin change gives a new version; hidden products and categories, and banners switched off, are left out', { skip }, async () => {
  const download = await phone();
  const before = await download();
  const cookie = await owner();
  const { products } = (await (await send('/v1/admin/catalogue', 'GET', undefined, cookie)).json()) as { products: { id: string; visible: boolean }[] };
  assert.equal((await send('/v1/admin/products', 'PUT', { products: [{ ...products[1]!, visible: false }] }, cookie)).status, 204);
  assert.equal((await send('/v1/admin/categories', 'PUT', { categories: [{ ...seed.categories[0]!, visible: false }] }, cookie)).status, 204);
  assert.equal((await send('/v1/admin/banners', 'PUT', { banners: [{ ...seed.banners[0]!, active: false }] }, cookie)).status, 204);

  const after = await download(before.version);
  assert.notEqual(after.version, before.version);
  assert.deepEqual((after.content!.products as { id: string }[]).map((product) => product.id), ['p1']);
  assert.deepEqual([after.content!.categories, after.content!.banners], [[], []]);
});

test('only linked phones download, and the download is gzipped for phones that accept it', { skip }, async () => {
  assert.equal((await send('/v1/app/content')).status, 401);
  const res = await send('/v1/app/register', 'POST', { name: 'Gzip', phone: '9499999999', password: 'phone password' });
  const { token } = (await res.json()) as { token: string };
  const gzipped = await send('/v1/app/content', 'GET', undefined, { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip' });
  assert.equal(gzipped.headers.get('content-encoding'), 'gzip');
});
