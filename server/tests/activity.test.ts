import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import { activityRoutes } from '../src/activity.ts';
import { createApp } from '../src/app.ts';
import { appRoutes, appUserAdminRoutes } from '../src/app-users.ts';
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

testDatabase('activity', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/app-users', appUserAdminRoutes(sql));
  admin.route('/', activityRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

async function staff(role: string) {
  const name = `${role} ${++next}`;
  const email = `staff${next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${name}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { name, cookie: { Cookie: res.headers.get('set-cookie')!.split(';')[0]! } };
}

type Entry = { id: string; at: string; by: string; area: string; summary: string; to: string | null };
const log = async (cookie: Record<string, string>) => (await (await send('/v1/admin/activity', 'GET', undefined, cookie)).json()) as Entry[];

test('an entry takes who and when from the session, and keeps what changed', { skip }, async () => {
  const owner = await staff('owner');
  const change = { area: 'content', summary: 'Edited the home banner “Move”', to: '/banners', before: [{ id: 'hero-1', headline: 'Move' }], after: [{ id: 'hero-1', headline: 'Glide' }] };
  // Someone trying to sign it as another person, or back-date it.
  const res = await send('/v1/admin/activity', 'POST', { ...change, by: 'Somebody else', at: '2000-01-01T00:00:00Z' }, owner.cookie);
  assert.equal(res.status, 201);
  const entry = (await res.json()) as Entry;
  assert.deepEqual({ by: entry.by, area: entry.area, summary: entry.summary, to: entry.to }, { by: owner.name, area: 'content', summary: change.summary, to: '/banners' });
  assert.ok(Date.now() - Date.parse(entry.at) < 60_000);
  const [row] = await sql`select before, after from activity_log where id = ${Number(entry.id)}`;
  assert.deepEqual([row!.before, row!.after], [change.before, change.after]);
});

test('Owners see everyone’s changes; Sales and Catalogue editors see only their own', { skip }, async () => {
  const [owner, sales, editor] = [await staff('owner'), await staff('sales'), await staff('catalogue')];
  for (const person of [owner, sales, editor]) await send('/v1/admin/activity', 'POST', { area: 'orders', summary: `Change by ${person.name}` }, person.cookie);
  const everyone = (await log(owner.cookie)).map((entry) => entry.summary);
  assert.ok([owner, sales, editor].every((person) => everyone.includes(`Change by ${person.name}`)));
  assert.deepEqual((await log(sales.cookie)).map((entry) => entry.summary), [`Change by ${sales.name}`]);
  assert.deepEqual((await log(editor.cookie)).map((entry) => entry.by), [editor.name]);
  assert.equal((await send('/v1/admin/activity')).status, 401);
});

test('bad entries are refused, and there is no way to edit or delete one', { skip }, async () => {
  const owner = await staff('owner');
  for (const bad of [{ area: 'staff', summary: 'x' }, { area: 'orders', summary: '  ' }, { area: 'orders', summary: 'x', to: 'https://example.com/' }]) {
    assert.equal((await send('/v1/admin/activity', 'POST', bad, owner.cookie)).status, 400, JSON.stringify(bad));
  }
  const [entry] = await log(owner.cookie);
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await send(`/v1/admin/activity/${entry!.id}`, method, {}, owner.cookie)).status, 404, method);
  assert.equal((await log(owner.cookie))[0]!.summary, entry!.summary);
});

test('an order placed in the app is listed for Owners, by "App", linking to the order', { skip }, async () => {
  const owner = await staff('owner');
  const { token } = (await (await send('/v1/app/register', 'POST', { name: 'Ravi Glass Works', phone: '9820000001', password: 'phone password' })).json()) as { token: string };
  const order = { id: 'phone-1', number: 'VSC-0001', createdAt: '2026-11-10T10:00:00.000Z', customer: 'Site A', status: 'Placed', lines: [{ productId: 'p1', code: 'TGH-55', name: 'Handle', qty: 2, mrp: 450 }], total: 900 };
  assert.equal((await send('/v1/app/orders', 'POST', { eventId: 'e-1', order }, { Authorization: `Bearer ${token}` })).status, 200);
  const [placed] = await sql`select id, number from orders where client_event_id = 'e-1'`;
  const [entry] = await log(owner.cookie);
  assert.deepEqual({ by: entry!.by, area: entry!.area, summary: entry!.summary, to: entry!.to }, { by: 'App', area: 'orders', summary: `Order ${placed!.number} placed in the app for Site A`, to: `/orders/${placed!.id}` });
});
