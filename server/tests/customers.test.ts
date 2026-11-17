import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type postgres from 'postgres';

import type { Order } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
import { appRoutes, appUserAdminRoutes } from '../src/app-users.ts';
import { customerRoutes } from '../src/customers.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { orderAdminRoutes } from '../src/orders.ts';
import { adminRoutes, issuePasswordLink, sha256 } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

type Customer = {
  id: number;
  name: string;
  tags: string[];
  note: string;
  phone: string;
  business: string;
  city: string;
  appUsers: { id: number; label: string }[];
  orders: number;
  spent: number;
  open: number;
  firstOrder: string | null;
  lastOrder: string | null;
};

testDatabase('customers', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/app-users', appUserAdminRoutes(sql));
  admin.route('/orders', orderAdminRoutes(sql));
  admin.route('/customers', customerRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(route, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

async function staff(role = 'sales') {
  const email = `staff${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Staff ${next}`}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { Cookie: res.headers.get('set-cookie')!.split(';')[0]! };
}

/** An app user added by staff, and its phone placing orders and sending its profile. */
async function phone(label: string) {
  const res = await send('/v1/admin/app-users', 'POST', { label }, await staff());
  const { appUser, token } = (await res.json()) as { appUser: { id: number }; token: string };
  const auth = { Authorization: `Bearer ${token}` };
  let made = 0;
  return {
    id: appUser.id,
    order: (qty: number) => {
      made += 1;
      const order = { id: `local-${made}`, createdAt: new Date().toISOString(), customer: 'Site A', lines: [{ productId: 'p1', code: 'TGH-55', name: 'Handle', option: 'SSS', qty }] };
      return send('/v1/app/orders', 'POST', { eventId: `order:${label}:${made}`, order }, auth);
    },
    profile: (profile: Record<string, string>) => send('/v1/app/profile', 'POST', { eventId: `profile:${label}`, profile }, auth),
  };
}

const list = async () => (await (await send('/v1/admin/customers', 'GET', undefined, await staff())).json()) as Customer[];
const named = async (name: string) => (await list()).find((customer) => customer.name === name)!;
const ordersOf = async (label: string) => ((await (await send('/v1/admin/orders', 'GET', undefined, await staff())).json()) as Order[]).filter((order) => order.appUser?.label === label);

test('an app user added by staff starts as its own customer, named as staff named it', { skip }, async () => {
  await phone('Ravi Glass Works');
  const ravi = await named('Ravi Glass Works');
  assert.deepEqual([ravi.orders, ravi.spent, ravi.open, ravi.firstOrder, ravi.tags, ravi.appUsers.map((user) => user.label)], [0, 0, 0, null, [], ['Ravi Glass Works']]);
});

test('totals leave out cancelled orders; open counts what is not delivered yet', { skip }, async () => {
  const anil = await phone('Anil Traders');
  for (const qty of [1, 2, 3]) await anil.order(qty);
  const [third, second] = await ordersOf('Anil Traders');
  const desk = await staff();
  await send('/v1/admin/orders/status', 'POST', { ids: [third!.id], status: 'cancelled' }, desk);
  await send('/v1/admin/orders/status', 'POST', { ids: [second!.id], status: 'delivered' }, desk);
  const customer = await named('Anil Traders');
  // SSS on p1 is ₹1,500: 1 + 2 count, the cancelled 3 doesn't.
  assert.deepEqual([customer.orders, customer.spent, customer.open], [3, 4500, 1]);
  assert.ok(customer.firstOrder && customer.lastOrder);
  // Each order names its customer, so the admin groups it there.
  assert.equal(third!.customerRecord?.id, customer.id);
});

test('contact details come from the profile the customer’s app sent', { skip }, async () => {
  const meena = await phone('Meena Interiors');
  await meena.profile({ name: 'Meena Shah', business: 'Meena Interiors LLP', phone: '98200 11111', email: 'meena@example.com', city: 'Pune' });
  const customer = await named('Meena Interiors');
  assert.deepEqual([customer.business, customer.phone, customer.city], ['Meena Interiors LLP', '98200 11111', 'Pune']);
});

test('tags and notes: saved trimmed, one tag per spelling, and a name is required', { skip }, async () => {
  const { id } = await named('Ravi Glass Works');
  const desk = await staff();
  const res = await send(`/v1/admin/customers/${id}`, 'PATCH', { tags: [' dealer ', 'Dealer', 'pays late'], note: '  Collects from the godown  ' }, desk);
  const saved = (await res.json()) as Customer;
  assert.deepEqual([saved.tags, saved.note], [['dealer', 'pays late'], 'Collects from the godown']);
  assert.equal((await send(`/v1/admin/customers/${id}`, 'PATCH', { name: '  ' }, desk)).status, 400);
  assert.equal((await send(`/v1/admin/customers/${id}`, 'PATCH', {}, desk)).status, 400);
});

test('merge: phones and their orders move over, tags and notes are kept, and the old address shows the survivor', { skip }, async () => {
  const desk = await staff();
  const second = await phone('Ravi (second phone)');
  await second.order(1);
  const first = (await named('Ravi Glass Works')).appUsers[0]!;
  await sql`update app_devices set business = 'Ravi Glass Works LLP', city = 'Pune', profile_updated_at = now() - interval '1 day' where id = ${first.id}`;
  // The newer profile leaves the business blank; it mustn't hide the one the first phone sent.
  await second.profile({ name: 'Site manager', business: '', phone: '98200 22222', city: '' });
  const keep = await named('Ravi Glass Works');
  const gone = await named('Ravi (second phone)');
  await send(`/v1/admin/customers/${gone.id}`, 'PATCH', { tags: ['Dealer', 'contractor'], note: 'Second phone is the site manager’s' }, desk);

  const merged = (await (await send(`/v1/admin/customers/${keep.id}/merge`, 'POST', { from: gone.id }, desk)).json()) as Customer;
  assert.deepEqual(merged.appUsers.map((user) => user.label), ['Ravi Glass Works', 'Ravi (second phone)']);
  assert.deepEqual([merged.orders, merged.spent], [1, 1500]);
  assert.deepEqual([merged.business, merged.city, merged.phone], ['Ravi Glass Works LLP', 'Pune', '98200 22222']);
  assert.deepEqual(merged.tags, ['dealer', 'pays late', 'contractor']);
  assert.equal(merged.note, 'Collects from the godown\n\nSecond phone is the site manager’s');

  assert.equal((await list()).some((customer) => customer.id === gone.id), false);
  assert.equal(((await (await send(`/v1/admin/customers/${gone.id}`, 'GET', undefined, desk)).json()) as Customer).id, keep.id);
  assert.equal((await ordersOf('Ravi (second phone)'))[0]!.customerRecord?.id, keep.id);

  assert.equal((await send(`/v1/admin/customers/${keep.id}/merge`, 'POST', { from: keep.id }, desk)).status, 400);
  assert.equal((await send(`/v1/admin/customers/${keep.id}/merge`, 'POST', { from: gone.id }, desk)).status, 404);
});

test('access: Owners and Sales work with customers; Catalogue editors and signed-out people cannot', { skip }, async () => {
  assert.equal((await send('/v1/admin/customers')).status, 401);
  assert.equal((await send('/v1/admin/customers', 'GET', undefined, await staff('catalogue'))).status, 403);
  assert.equal((await send('/v1/admin/customers', 'GET', undefined, await staff('owner'))).status, 200);
});

// A database that had app users before Module 7: the migration gives each one its own customer.
const before = testDatabase('customers_backfill');

test('migration: app users from before Module 7 each get a customer named after them', { skip }, async () => {
  const all = fileURLToPath(new URL('../migrations/', import.meta.url));
  const older = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  for (const file of (await readdir(all)).filter((name) => name < '008')) await copyFile(path.join(all, file), path.join(older, file));
  await migrate(before.sql, new URL(`${pathToFileURL(older).href}/`));
  await before.sql`insert into app_devices (label, token_hash) values ('Old Shop', ${sha256('a')}), ('Older Shop', ${sha256('b')})`;

  await migrate(before.sql);
  const rows = await before.sql`select d.label, c.name from app_devices d join customers c on c.id = d.customer_id order by d.id`;
  assert.deepEqual(rows.map((row) => [row.label, row.name]), [['Old Shop', 'Old Shop'], ['Older Shop', 'Older Shop']]);
  await rm(older, { recursive: true });
});
