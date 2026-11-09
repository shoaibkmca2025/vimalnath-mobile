import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { api, type ApiError } from '../src/lib/api.ts';

let reloads = 0;
const globals = globalThis as unknown as { window: unknown; fetch: unknown };

/** Makes the next API call get this response. */
const respondWith = (response: Response) => (globals.fetch = async () => response);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const failureOf = (call: Promise<unknown>) => call.then(() => assert.fail('should have failed'), (error: ApiError) => error);

beforeEach(() => {
  reloads = 0;
  globals.window = { location: { reload: () => reloads++ } };
});

test('a session that ends mid-use reloads the page', async () => {
  respondWith(json(401, { error: { message: 'Please sign in.' } }));
  await failureOf(api('/staff'));
  assert.equal(reloads, 1);
});

test('the who-is-signed-in check never reloads, or signed-out visitors would loop forever', async () => {
  respondWith(json(401, { error: { message: 'Please sign in.' } }));
  await failureOf(api('/me'));
  assert.equal(reloads, 0);
});

test('a wrong password stays on the page and shows its message', async () => {
  respondWith(json(401, { error: { message: 'Wrong email or password.' } }));
  assert.equal((await failureOf(api('/auth/sign-in', 'POST', {}))).message, 'Wrong email or password.');
  assert.equal(reloads, 0);
});

test('an error names the field it is about', async () => {
  respondWith(json(400, { error: { message: 'Enter a name.', field: 'name' } }));
  const error = await failureOf(api('/staff', 'POST', {}));
  assert.deepEqual([error.message, error.field], ['Enter a name.', 'name']);
});

test('a reply that is not from the API says the server is unreachable', async () => {
  respondWith(new Response('Bad Gateway', { status: 502 }));
  assert.match((await failureOf(api('/staff'))).message, /reach the server/);
});

test('no network says the server is unreachable', async () => {
  globals.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  assert.match((await failureOf(api('/staff'))).message, /reach the server/);
});

test('an empty success returns nothing', async () => {
  respondWith(new Response(null, { status: 204 }));
  assert.equal(await api('/auth/sign-out', 'POST'), undefined);
});
