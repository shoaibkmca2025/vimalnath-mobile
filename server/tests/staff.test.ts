import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { migrate } from '../src/migrate.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const GOOD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('staff', async (client) => {
  sql = client;
  await migrate(sql);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  app.route('/v1/admin', adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true }));
});

function call(path: string, method = 'GET', body?: unknown, cookie?: string, client = '10.0.0.1') {
  return app.request(`/v1/admin${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': client, ...(cookie ? { Cookie: cookie } : {}) },
  });
}

const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!;
const signIn = (email: string, password = GOOD, client?: string) => call('/auth/sign-in', 'POST', { email, password }, undefined, client);
const session = async (email: string, password = GOOD) => cookieOf(await signIn(email, password));

/** A person with a password set, through the same one-time link staff use. */
async function person(role = 'owner', active = true) {
  const email = `person${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role, active) values (${`Person ${next}`}, ${email}, ${role}, true) returning id`;
  const link = await issuePasswordLink(sql, row!.id, ORIGIN);
  assert.equal((await call('/auth/set-password', 'POST', { token: tokenOf(link), password: GOOD })).status, 204);
  if (!active) await sql`update staff_users set active = false where id = ${row!.id}`;
  return { id: row!.id as number, email };
}

test('sign-in: the right password opens a session in a protected cookie', { skip }, async () => {
  const { email } = await person();
  const res = await signIn(email);
  assert.equal(res.status, 200);
  const header = res.headers.get('set-cookie')!;
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.doesNotMatch(header, /Secure/);
  assert.equal(((await res.json()) as { email: string }).email, email);
  const me = await call('/me', 'GET', undefined, cookieOf(res));
  assert.equal(((await me.json()) as { email: string }).email, email);
});

test('sign-in: email is matched in any case', { skip }, async () => {
  const { email } = await person();
  assert.equal((await signIn(email.toUpperCase())).status, 200);
});

test('sign-in: every failure gets the same answer', { skip }, async () => {
  const { email } = await person();
  const inactive = await person('sales', false);
  const [{ id } = {}] = await sql`insert into staff_users (name, email, role) values ('No Password', 'nopass@example.com', 'sales') returning id`;
  assert.ok(id);
  const answers = await Promise.all([signIn(email, 'wrong password'), signIn('nobody@example.com'), signIn(inactive.email), signIn('nopass@example.com')]);
  assert.deepEqual(answers.map((res) => res.status), [401, 401, 401, 401]);
  assert.equal(new Set(await Promise.all(answers.map((res) => res.text()))).size, 1);
});

test('lock: 5 wrong passwords block even the right one, for 15 minutes', { skip }, async () => {
  const { email } = await person();
  for (let i = 0; i < 5; i++) assert.equal((await signIn(email, 'wrong password')).status, 401);
  assert.equal((await signIn(email)).status, 401);
  await sql`update sign_in_attempts set expires_at = now() - interval '1 second' where email = ${email}`;
  assert.equal((await signIn(email)).status, 200);
});

test('lock: guesses sent together cannot get past it', { skip }, async () => {
  const { email } = await person();
  // The right password goes last, so 30 wrong tries are ahead of it while all of them are still being checked.
  const results = await Promise.all([...Array.from({ length: 30 }, () => signIn(email, 'wrong password')), signIn(email)]);
  assert.equal(results.at(-1)!.status, 401);
});

test('lock: an attacker elsewhere cannot lock someone out', { skip }, async () => {
  const { email } = await person();
  for (let i = 0; i < 6; i++) await signIn(email, 'wrong password', '203.0.113.9');
  assert.equal((await signIn(email, GOOD, '203.0.113.9')).status, 401);
  assert.equal((await signIn(email)).status, 200);
});

test('lock: a new password clears it', { skip }, async () => {
  const { id, email } = await person();
  for (let i = 0; i < 6; i++) await signIn(email, 'wrong password');
  const token = tokenOf(await issuePasswordLink(sql, id, ORIGIN));
  assert.equal((await call('/auth/set-password', 'POST', { token, password: GOOD })).status, 204);
  assert.equal((await signIn(email)).status, 200);
});

test('production: the sign-in cookie only travels over https', { skip }, async () => {
  const { email } = await person();
  const secure = createApp({ adminOrigin: ORIGIN, production: true, trustProxy: true, checkDatabase: async () => 1 });
  secure.route('/v1/admin', adminRoutes(sql, { adminOrigin: ORIGIN, production: true, trustProxy: true }));
  const res = await secure.request('/v1/admin/auth/sign-in', {
    method: 'POST',
    body: JSON.stringify({ email, password: GOOD }),
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1', 'x-forwarded-proto': 'https' },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie')!, /Secure/);
});

test('lock: a good sign-in resets the count', { skip }, async () => {
  const { email } = await person();
  for (let i = 0; i < 4; i++) await signIn(email, 'wrong password');
  assert.equal((await signIn(email)).status, 200);
  for (let i = 0; i < 4; i++) await signIn(email, 'wrong password');
  assert.equal((await signIn(email)).status, 200);
});

test('access: everything is private by default, even unknown addresses', { skip }, async () => {
  for (const path of ['/me', '/staff', '/products', '/anything/else']) assert.equal((await call(path)).status, 401, path);
  assert.equal((await call('/me', 'GET', undefined, 'vimalnath_session=made-up')).status, 401);
});

test('sessions: an expired one stops working, and use extends a live one', { skip }, async () => {
  const { id, email } = await person();
  const cookie = await session(email);
  await sql`update staff_sessions set expires_at = now() + interval '1 minute' where staff_id = ${id}`;
  assert.equal((await call('/me', 'GET', undefined, cookie)).status, 200);
  const [row] = await sql`select expires_at > now() + interval '11 hours' as extended from staff_sessions where staff_id = ${id}`;
  assert.equal(row!.extended, true);
  await sql`update staff_sessions set expires_at = now() - interval '1 second' where staff_id = ${id}`;
  assert.equal((await call('/me', 'GET', undefined, cookie)).status, 401);
});

test('sessions: sign-out ends it for good', { skip }, async () => {
  const { email } = await person();
  const cookie = await session(email);
  assert.equal((await call('/auth/sign-out', 'POST', undefined, cookie)).status, 204);
  assert.equal((await call('/me', 'GET', undefined, cookie)).status, 401);
});

test('roles: only an Owner can manage staff', { skip }, async () => {
  for (const role of ['sales', 'catalogue']) {
    const cookie = await session((await person(role)).email);
    assert.equal((await call('/staff', 'GET', undefined, cookie)).status, 403);
    assert.equal((await call('/staff', 'POST', { name: 'X', email: 'x@example.com', role: 'owner' }, cookie)).status, 403);
    assert.equal((await call('/me', 'GET', undefined, cookie)).status, 200);
  }
});

test('roles: a role change applies at once', { skip }, async () => {
  const target = await person('owner');
  const cookie = await session(target.email);
  assert.equal((await call('/staff', 'GET', undefined, cookie)).status, 200);
  await sql`update staff_users set role = 'sales' where id = ${target.id}`;
  assert.equal((await call('/staff', 'GET', undefined, cookie)).status, 403);
});

test('adding staff: the link works once and then they can sign in', { skip }, async () => {
  const owner = await session((await person()).email);
  const res = await call('/staff', 'POST', { name: ' New Person ', email: 'New.Person@Example.com', role: 'sales' }, owner);
  assert.equal(res.status, 201);
  const { staff, link } = (await res.json()) as { staff: Record<string, unknown>; link: string };
  assert.deepEqual([staff.name, staff.email, staff.hasPassword], ['New Person', 'new.person@example.com', false]);
  assert.ok(link.startsWith(`${ORIGIN}/set-password?token=`));
  assert.equal((await signIn('new.person@example.com')).status, 401);
  assert.equal((await call('/auth/set-password', 'POST', { token: tokenOf(link), password: GOOD })).status, 204);
  assert.equal((await call('/auth/set-password', 'POST', { token: tokenOf(link), password: GOOD })).status, 400);
  assert.equal((await signIn('new.person@example.com')).status, 200);
});

test('adding staff: one email cannot be used twice, in any case', { skip }, async () => {
  const owner = await session((await person()).email);
  const { email } = await person();
  const res = await call('/staff', 'POST', { name: 'Twin', email: email.toUpperCase(), role: 'sales' }, owner);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: { field: string } }).error.field, 'email');
});

test('passwords: too short is refused, and an expired link fails', { skip }, async () => {
  const { id } = await person();
  const token = tokenOf(await issuePasswordLink(sql, id, ORIGIN));
  assert.equal((await call('/auth/set-password', 'POST', { token, password: 'short' })).status, 400);
  await sql`update password_tokens set expires_at = now() - interval '1 second' where staff_id = ${id}`;
  assert.equal((await call('/auth/set-password', 'POST', { token, password: GOOD })).status, 400);
});

test('reset link: a new one cancels the old, and signs the person out', { skip }, async () => {
  const owner = await session((await person()).email);
  const target = await person('sales');
  const theirs = await session(target.email);
  const links: { link: string }[] = [];
  for (let i = 0; i < 2; i++) links.push((await (await call(`/staff/${target.id}/password-link`, 'POST', undefined, owner)).json()) as { link: string });
  assert.equal((await call('/auth/set-password', 'POST', { token: tokenOf(links[0]!.link), password: 'a brand new password' })).status, 400);
  assert.equal((await call('/auth/set-password', 'POST', { token: tokenOf(links[1]!.link), password: 'a brand new password' })).status, 204);
  assert.equal((await call('/me', 'GET', undefined, theirs)).status, 401);
  assert.equal((await signIn(target.email)).status, 401);
  assert.equal((await signIn(target.email, 'a brand new password')).status, 200);
});

test('change password: needs the current one, and signs out other devices only', { skip }, async () => {
  const { email } = await person();
  const here = await session(email);
  const elsewhere = await session(email);
  const wrong = await call('/auth/change-password', 'POST', { current: 'not it', password: 'a brand new password' }, here);
  assert.equal(wrong.status, 400);
  assert.equal(((await wrong.json()) as { error: { field: string } }).error.field, 'current');
  assert.equal((await call('/auth/change-password', 'POST', { current: GOOD, password: 'a brand new password' }, here)).status, 204);
  assert.equal((await call('/me', 'GET', undefined, here)).status, 200);
  assert.equal((await call('/me', 'GET', undefined, elsewhere)).status, 401);
  assert.equal((await signIn(email, 'a brand new password')).status, 200);
});

test('deactivating: access ends at once and old links stop working', { skip }, async () => {
  const owner = await session((await person()).email);
  const target = await person('sales');
  const theirs = await session(target.email);
  const link = await issuePasswordLink(sql, target.id, ORIGIN);
  assert.equal((await call(`/staff/${target.id}`, 'PATCH', { active: false }, owner)).status, 200);
  assert.equal((await call('/me', 'GET', undefined, theirs)).status, 401);
  assert.equal((await signIn(target.email)).status, 401);
  assert.equal((await call('/auth/set-password', 'POST', { token: tokenOf(link), password: 'a brand new password' })).status, 400);
  assert.equal((await call(`/staff/${target.id}/password-link`, 'POST', undefined, owner)).status, 404);
});

test('editing staff: bad input is refused', { skip }, async () => {
  const owner = await session((await person()).email);
  assert.equal((await call('/staff/abc', 'PATCH', { active: false }, owner)).status, 400);
  assert.equal((await call('/staff/99999999999', 'PATCH', { active: false }, owner)).status, 400);
  assert.equal((await call('/staff/999999', 'PATCH', { name: 'Ghost' }, owner)).status, 404);
  assert.equal((await call('/staff/1', 'PATCH', {}, owner)).status, 400);
  assert.equal((await call('/staff/1', 'PATCH', { role: 'king' }, owner)).status, 400);
});

test('editing staff: a mistyped email can be corrected, but not to one in use', { skip }, async () => {
  const owner = await session((await person()).email);
  const target = await person('sales');
  const other = await person('sales');
  const taken = await call(`/staff/${target.id}`, 'PATCH', { email: other.email.toUpperCase() }, owner);
  assert.equal(taken.status, 409);
  assert.equal(((await taken.json()) as { error: { field: string } }).error.field, 'email');
  assert.equal((await call(`/staff/${target.id}`, 'PATCH', { email: 'Fixed.Address@Example.com' }, owner)).status, 200);
  assert.equal((await signIn('fixed.address@example.com')).status, 200);
  assert.equal((await signIn(target.email)).status, 401);
});

test('nothing secret is ever sent or stored in the clear', { skip }, async () => {
  const owner = await session((await person()).email);
  const body = await (await call('/staff', 'GET', undefined, owner)).text();
  assert.doesNotMatch(body, /password_hash/);
  const token = owner.split('=')[1]!;
  const [stored] = await sql`select count(*)::int as n from staff_sessions where token_hash = ${token}`;
  assert.equal(stored!.n, 0);
  const [hash] = await sql`select password_hash from staff_users where password_hash = ${GOOD}`;
  assert.equal(hash, undefined);
});

// Runs last: it needs to be the only Owner left, so it deactivates the others first.
test('Owners: the last one cannot be removed, even by two at once', { skip }, async () => {
  const a = await person();
  const b = await person();
  const [cookieA, cookieB] = [await session(a.email), await session(b.email)];
  await sql`update staff_users set active = false where role = 'owner' and id not in (${a.id}, ${b.id})`;
  const results = await Promise.all([call(`/staff/${b.id}`, 'PATCH', { role: 'sales' }, cookieA), call(`/staff/${a.id}`, 'PATCH', { active: false }, cookieB)]);
  // The loser gets 400 if both got past the role check, or 403 if it had already been demoted.
  const statuses = results.map((res) => res.status).sort();
  assert.equal(statuses[0], 200);
  assert.ok([400, 403].includes(statuses[1]!));
  const [left] = await sql`select count(*)::int as n from staff_users where role = 'owner' and active`;
  assert.equal(left!.n, 1);
  const survivor = results[0]!.status === 200 ? a : b;
  const cookie = survivor === a ? cookieA : cookieB;
  const last = await call(`/staff/${survivor.id}`, 'PATCH', { role: 'sales' }, cookie);
  assert.equal(last.status, 400);
  assert.match(await last.text(), /at least one active Owner/);
});
