import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { jsonBody } from '../src/validate.ts';

const ADMIN = 'https://admin.example.com';

function makeApp(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({ adminOrigin: ADMIN, production: false, trustProxy: true, checkDatabase: async () => 1, ...options });
}

const fromClient = (ip: string) => ({ headers: { 'x-forwarded-for': ip } });
const jsonPost = (body: string) => ({ method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
/** What the Node adapter passes in for a real connection from this address. */
const socketFrom = (remoteAddress: string) => ({ incoming: { socket: { remoteAddress, remotePort: 1, remoteFamily: 'IPv4' } } });

test('settings: a good environment loads, with defaults', () => {
  const config = loadConfig({ DATABASE_URL: 'postgres://u:p@h/d', ADMIN_ORIGIN: ADMIN });
  assert.equal(config.PORT, 3000);
  assert.equal(config.TRUST_PROXY, false);
});

test('settings: a slash at the end of the admin address is ignored', () => {
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://u:p@h/d', ADMIN_ORIGIN: `${ADMIN}/` }).ADMIN_ORIGIN, ADMIN);
});

test('settings: a bad environment stops startup and never prints the secret', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'mysql://user:hunter2@h/d', ADMIN_ORIGIN: ADMIN }), (error: Error) => {
    assert.match(error.message, /DATABASE_URL/);
    assert.doesNotMatch(error.message, /hunter2/);
    return true;
  });
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://u:p@h/d' }), /ADMIN_ORIGIN/);
});

test('health: ok when the database answers', async () => {
  const res = await makeApp().request('/v1/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('health: 503 when the database is down, with no details leaked', async () => {
  const res = await makeApp({ checkDatabase: () => Promise.reject(new Error('password authentication failed for user x')) }).request('/v1/health');
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: { message: 'The database is not reachable.' } });
});

test('errors: an unknown address gets the standard format', async () => {
  const res = await makeApp().request('/v1/nothing');
  assert.equal(res.status, 404);
  assert.ok(((await res.json()) as { error: { message: string } }).error.message);
});

test('errors: a crash returns 500 without its details', async () => {
  const app = makeApp();
  app.get('/v1/app/boom', () => {
    throw new Error('secret internal detail');
  });
  const res = await app.request('/v1/app/boom', fromClient('1.1.1.1'));
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /secret internal detail/);
});

function appWithValidation() {
  const app = makeApp();
  app.post('/v1/app/echo', jsonBody(z.object({ name: z.string().min(1, 'Enter a name.') })), (c) => c.json(c.req.valid('json')));
  return app;
}

test('validation: good input reaches the handler', async () => {
  const res = await appWithValidation().request('/v1/app/echo', { ...jsonPost('{"name":"Sharma"}'), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.2' } });
  assert.deepEqual(await res.json(), { name: 'Sharma' });
});

test('validation: a bad field is named in the error', async () => {
  const res = await appWithValidation().request('/v1/app/echo', { ...jsonPost('{"name":""}'), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.3' } });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: { message: 'Enter a name.', field: 'name' } });
});

test('validation: broken JSON is a 400, not a crash', async () => {
  const res = await appWithValidation().request('/v1/app/echo', { ...jsonPost('{broken'), headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.4' } });
  assert.equal(res.status, 400);
});

test('security: a body over 1 MB is refused', async () => {
  const body = JSON.stringify({ name: 'x'.repeat(1024 * 1024 + 1) });
  const res = await appWithValidation().request('/v1/app/echo', { ...jsonPost(body), headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), 'x-forwarded-for': '1.1.1.5' } });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: { message: 'That request is too large.' } });
});

function appWithLimit(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  const app = makeApp({ requestsPerMinute: 2, ...options });
  app.get('/v1/app/ping', (c) => c.text('pong'));
  return app;
}

test('rate limit: blocks over the limit, per client, and says when to retry', async () => {
  const app = appWithLimit();
  assert.equal((await app.request('/v1/app/ping', fromClient('2.2.2.2'))).status, 200);
  assert.equal((await app.request('/v1/app/ping', fromClient('2.2.2.2'))).status, 200);
  const blocked = await app.request('/v1/app/ping', fromClient('2.2.2.2'));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
  assert.equal((await app.request('/v1/app/ping', fromClient('3.3.3.3'))).status, 200);
});

test('rate limit: a faked X-Forwarded-For cannot dodge it', async () => {
  // Behind a proxy, only the last entry counts.
  const proxied = appWithLimit();
  for (const fake of ['8.8.8.8', '9.9.9.9']) assert.equal((await proxied.request('/v1/app/ping', fromClient(`${fake}, 4.4.4.4`))).status, 200);
  assert.equal((await proxied.request('/v1/app/ping', fromClient('7.7.7.7, 4.4.4.4'))).status, 429);

  // With no proxy, the header is ignored and the real connection counts.
  const direct = appWithLimit({ trustProxy: false });
  for (const fake of ['8.8.8.8', '9.9.9.9']) assert.equal((await direct.request('/v1/app/ping', fromClient(fake), socketFrom('5.5.5.5'))).status, 200);
  assert.equal((await direct.request('/v1/app/ping', fromClient('7.7.7.7'), socketFrom('5.5.5.5'))).status, 429);
});

test('security: health is never rate limited, so monitors keep working', async () => {
  const app = appWithLimit();
  for (let i = 0; i < 5; i++) assert.equal((await app.request('/v1/health')).status, 200);
});

test('security: only the admin site gets browser access to the admin API', async () => {
  const app = makeApp();
  const preflight = (origin: string) => app.request('/v1/admin/products', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT' } });
  assert.equal((await preflight(ADMIN)).headers.get('Access-Control-Allow-Origin'), ADMIN);
  assert.notEqual((await preflight('https://evil.example.com')).headers.get('Access-Control-Allow-Origin'), 'https://evil.example.com');
  assert.equal((await app.request('/v1/health', { headers: { Origin: ADMIN } })).headers.get('Access-Control-Allow-Origin'), null);
});

test('security: plain http is refused in production behind a proxy', async () => {
  const app = makeApp({ production: true });
  assert.equal((await app.request('/v1/health', { headers: { 'x-forwarded-proto': 'http' } })).status, 403);
  assert.equal((await app.request('/v1/health', { headers: { 'x-forwarded-proto': 'https' } })).status, 200);
});

test('security: responses carry the protective headers', async () => {
  const res = await makeApp().request('/v1/health');
  assert.ok(res.headers.get('Strict-Transport-Security'));
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
});
