import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Seed, Section } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { calculatorRoutes } from '../src/calculators.ts';
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

type Calculators = { cutlist: Seed['cutlist']; sections: Section[] };

testDatabase('calculators', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/', calculatorRoutes(sql));
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

const read = async () => (await (await send('/calculators', 'GET', undefined, await staff('sales'))).json()) as Calculators;
const reason = async (res: Response) => [res.status, ((await res.json()) as { error: { message: string } }).error.message];

test('read: the cutlist and bar sections come back exactly as imported', { skip }, async () => {
  assert.deepEqual(await read(), { cutlist: seed.cutlist, sections: seed.sections });
});

test('cutlist: card edits, renamed, reordered and new configurations are saved in order', { skip }, async () => {
  const { cutlist } = await read();
  const changed: Seed['cutlist'] = {
    systems: cutlist.systems.map((system) => (system.id === 'telescopic' ? { ...system, subtitle: 'Panels that travel together', photo: '/v1/media/0123456789abcdef01234567.webp' } : system)),
    configurations: {
      telescopic: [{ name: '2+0', image: '/media/t2.jpg' }, { name: '1+0 Sliding', image: '/media/c.jpg' }],
      synchronized: [{ name: '2+0 Synchro', image: '/media/s2.jpg' }],
      folding: [],
    },
  };
  assert.equal((await send('/cutlist', 'PUT', { cutlist: changed }, await staff('catalogue'))).status, 204);
  assert.deepEqual((await read()).cutlist, changed);
});

test('cutlist: refused input says why and saves nothing', { skip }, async () => {
  const cookie = await staff('owner');
  const before = (await read()).cutlist;
  const tries = [
    [{ ...before, systems: before.systems.map((system, index) => (index ? system : { ...system, id: 'sliding' })) }, 'Invalid option: expected one of "telescopic"|"synchronized"|"folding"'],
    [{ ...before, systems: before.systems.slice(1) }, 'Send all three systems.'],
    [{ ...before, configurations: { ...before.configurations, folding: [{ name: '2 Door', image: '/media/a.jpg' }, { name: '2 Door', image: '/media/b.jpg' }] } }, 'Each configuration in a system needs a different name.'],
    [{ ...before, configurations: { ...before.configurations, folding: [{ name: '2 Door', image: 'javascript:alert(1)' }] } }, 'Choose a JPG, PNG or WebP photo.'],
  ] as const;
  for (const [cutlist, message] of tries) assert.deepEqual(await reason(await send('/cutlist', 'PUT', { cutlist }, cookie)), [400, message]);
  assert.deepEqual((await read()).cutlist, before);
});

test('bar sections: the library is saved whole, including additions, edits and removals', { skip }, async () => {
  const cookie = await staff('catalogue');
  const sections: Section[] = [
    { code: 'S-102', name: 'Interlock', system: 'Sliding', bar: 5800, dimensions: '38 × 25 mm', description: 'New.' },
    { ...seed.sections[0]!, name: 'Sliding frame (heavy)', bar: 6000 },
  ];
  assert.equal((await send('/bar-sections', 'PUT', { sections }, cookie)).status, 204);
  assert.deepEqual((await read()).sections, sections);
  assert.equal((await send('/bar-sections', 'PUT', { sections: [] }, cookie)).status, 204);
  assert.deepEqual((await read()).sections, []);
});

test('bar sections: the same code twice, or a bar length out of range, is refused', { skip }, async () => {
  const cookie = await staff('catalogue');
  const section = seed.sections[0]!;
  assert.deepEqual(await reason(await send('/bar-sections', 'PUT', { sections: [section, { ...section, code: section.code.toLowerCase() }] }, cookie)), [400, 'Two sections have the same code.']);
  assert.deepEqual(await reason(await send('/bar-sections', 'PUT', { sections: [{ ...section, bar: 499 }] }, cookie)), [400, 'Enter the standard bar length in mm, between 500 and 12,000.']);
  assert.deepEqual(await reason(await send('/bar-sections', 'PUT', { sections: [{ ...section, bar: 1500.5 }] }, cookie)), [400, 'Enter the standard bar length in mm, between 500 and 12,000.']);
});

test('access: everyone signed in reads; only Owners and Catalogue editors change', { skip }, async () => {
  assert.equal((await send('/calculators')).status, 401);
  const sales = await staff('sales');
  assert.equal((await send('/calculators', 'GET', undefined, sales)).status, 200);
  assert.equal((await send('/bar-sections', 'PUT', { sections: seed.sections }, sales)).status, 403);
  assert.equal((await send('/cutlist', 'PUT', { cutlist: seed.cutlist }, sales)).status, 403);
});
