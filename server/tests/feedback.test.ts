import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { appRoutes } from '../src/app-users.ts';
import { feedbackAdminRoutes } from '../src/feedback.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { adminRoutes, issuePasswordLink, sha256 } from '../src/staff.ts';
import { seed } from './seed-fixture.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('feedback', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/feedback', feedbackAdminRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/app', appRoutes(sql));
});

const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers } });

async function staff(role: string) {
  const email = `staff${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Staff ${next}`}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  await send('/v1/admin/auth/set-password', 'POST', { token, password: PASSWORD });
  const res = await send('/v1/admin/auth/sign-in', 'POST', { email, password: PASSWORD });
  return { name: `Staff ${next}`, headers: { Cookie: res.headers.get('set-cookie')!.split(';')[0]! } };
}

/** A customer's phone, signed in with the shop's token. */
async function phone(label: string) {
  const token = `token-${++next}`;
  await sql`with customer as (insert into customers (name) values (${label}) returning id) insert into app_devices (label, token_hash, customer_id, phone) select ${label}, ${sha256(token)}, id, '98220 12345' from customer`;
  return (body: Record<string, unknown>) => send('/v1/app/feedback', 'POST', body, { Authorization: `Bearer ${token}` });
}

type Feedback = { id: string; rating: number | null; kind: string; message: string; appVersion: string; platform: string; status: string; staffNote: string; handledBy: string | null; appUser: { label: string }; customer: { name: string } | null };
const error = async (res: Response) => ((await res.json()) as { error: { message: string } }).error.message;

test('app: a rating, a problem or a suggestion is saved with the app version; a problem needs words', { skip }, async () => {
  const feedback = await phone('Ravi Glass Works');
  assert.equal((await feedback({ rating: 5, kind: 'feedback', message: ' Very easy to order. ', appVersion: '1.4.0', platform: 'android 15' })).status, 201);
  assert.equal((await feedback({ rating: 2, kind: 'feedback' })).status, 201);
  assert.equal((await feedback({ kind: 'suggestion', message: 'Add a WhatsApp share for quotes.' })).status, 201);

  const empty = await feedback({ kind: 'feedback' });
  assert.deepEqual([empty.status, await error(empty)], [400, 'Choose a rating or write a message.']);
  const problem = await feedback({ rating: 1, kind: 'problem', message: '   ' });
  assert.deepEqual([problem.status, await error(problem)], [400, 'Tell us what went wrong.']);
  assert.equal((await feedback({ rating: 6, kind: 'feedback' })).status, 400);
  assert.equal((await send('/v1/app/feedback', 'POST', { rating: 5, kind: 'feedback' })).status, 401);

  const owner = await staff('owner');
  const list = (await (await send('/v1/admin/feedback', 'GET', undefined, owner.headers)).json()) as Feedback[];
  const first = list.find((item) => item.message === 'Very easy to order.')!;
  assert.deepEqual([first.rating, first.kind, first.appVersion, first.platform, first.status, first.appUser.label, first.customer?.name], [5, 'feedback', '1.4.0', 'android 15', 'new', 'Ravi Glass Works', 'Ravi Glass Works']);
});

test('limit: one account can send 20 a day', { skip }, async () => {
  const feedback = await phone('Busy Co');
  for (let count = 0; count < 20; count += 1) assert.equal((await feedback({ rating: 4, kind: 'feedback' })).status, 201);
  const over = await feedback({ rating: 4, kind: 'feedback' });
  assert.deepEqual([over.status, await error(over)], [429, 'Thanks, we have plenty from you today. Please send more tomorrow.']);
});

test('admin: the count of new feedback, marking it seen or resolved with a note, and who may read it', { skip }, async () => {
  const feedback = await phone('Count Co');
  await feedback({ rating: 1, kind: 'problem', message: 'The cart crashed when I added a handle.' });
  const sales = await staff('sales');
  const count = async () => ((await (await send('/v1/admin/feedback/count', 'GET', undefined, sales.headers)).json()) as { new: number }).new;
  const before = await count();
  const [item] = ((await (await send('/v1/admin/feedback', 'GET', undefined, sales.headers)).json()) as Feedback[]).filter((one) => one.appUser.label === 'Count Co');

  assert.equal((await send(`/v1/admin/feedback/${item!.id}`, 'PATCH', { status: 'resolved', staffNote: 'Fixed in 1.4.1' }, sales.headers)).status, 204);
  assert.equal(await count(), before - 1);
  const [saved] = ((await (await send('/v1/admin/feedback', 'GET', undefined, sales.headers)).json()) as Feedback[]).filter((one) => one.id === item!.id);
  assert.deepEqual([saved!.status, saved!.staffNote, saved!.handledBy], ['resolved', 'Fixed in 1.4.1', sales.name]);
  assert.equal((await send(`/v1/admin/feedback/${item!.id}`, 'PATCH', {}, sales.headers)).status, 400);

  for (const role of ['catalogue', 'inventory']) assert.equal((await send('/v1/admin/feedback', 'GET', undefined, (await staff(role)).headers)).status, 403);
});
