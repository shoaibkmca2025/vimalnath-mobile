import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { calculatorRoutes } from '../src/calculators.ts';
import { catalogueRoutes } from '../src/catalogue.ts';
import { contentRoutes } from '../src/content.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { versionRoutes } from '../src/versions.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('versions', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  for (const routes of [catalogueRoutes, calculatorRoutes, contentRoutes, versionRoutes]) admin.route('/', routes(sql));
  app.route('/v1/admin', admin);
});

const send = (route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/v1/admin${route}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

async function staff(role: string) {
  const email = `staff${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Staff ${next}`}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

const versions = async (cookie: Record<string, string>) => (await (await send('/versions', 'GET', undefined, cookie)).json()) as Record<string, number>;
const STALE = 'Someone else changed this list. Reload to see their change.';

// Every list the admin saves whole, with a body it can save as it is.
const LISTS = [
  ['categories', '/categories', { categories: seed.categories }],
  ['catalogues', '/price-lists', { priceLists: seed.catalogues }],
  ['cutlist', '/cutlist', { cutlist: seed.cutlist }],
  ['sections', '/bar-sections', { sections: seed.sections }],
  ['banners', '/banners', { banners: seed.banners }],
  ['videoSections', '/videos', { videoSections: seed.videoSections }],
  ['moreApps', '/more-apps', { moreApps: [] }],
  ['settings', '/settings', { settings: seed.settings }],
] as const;

test('every whole-list save from an out-of-date copy is refused, and the newer save is kept', { skip }, async () => {
  const owner = await staff('owner');
  const start = await versions(owner);
  assert.deepEqual(Object.keys(start).sort(), LISTS.map(([name]) => name).sort());
  for (const [name, path, body] of LISTS) {
    const seen = start[name]!;
    assert.equal((await send(path, 'PUT', { ...body, version: seen }, owner)).status, 204, name);
    const stale = await send(path, 'PUT', { ...body, version: seen }, owner);
    assert.deepEqual([stale.status, ((await stale.json()) as { error: { message: string } }).error.message], [409, STALE], name);
    assert.equal((await versions(owner))[name], seen + 1, name);
  }
});

test('two saves from the same copy at the same moment: one lands, the other is refused', { skip }, async () => {
  const owner = await staff('owner');
  const seen = (await versions(owner)).banners!;
  const save = (headline: string) => send('/banners', 'PUT', { banners: [{ ...seed.banners[0]!, headline }], version: seen }, owner);
  const results = await Promise.all([save('First'), save('Second')]);
  assert.deepEqual(results.map((res) => res.status).sort(), [204, 409]);
  const winner = results[0]!.status === 204 ? 'First' : 'Second';
  const content = (await (await send('/content', 'GET', undefined, owner)).json()) as { banners: { headline: string }[] };
  assert.equal(content.banners[0]!.headline, winner);
});

test('a save without a version is not checked but still counts; refused and invalid saves do not count', { skip }, async () => {
  const owner = await staff('owner');
  const seen = (await versions(owner)).sections!;
  assert.equal((await send('/bar-sections', 'PUT', { sections: seed.sections }, owner)).status, 204);
  assert.equal((await send('/bar-sections', 'PUT', { sections: seed.sections }, await staff('sales'))).status, 403);
  assert.equal((await send('/bar-sections', 'PUT', { sections: [{ ...seed.sections[0]!, bar: 1 }], version: seen + 1 }, owner)).status, 400);
  assert.equal((await versions(owner)).sections, seen + 1);
});
