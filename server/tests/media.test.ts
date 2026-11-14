import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';
import sharp from 'sharp';

import { createApp } from '../src/app.ts';
import { mediaAdminRoutes, mediaRoutes } from '../src/media.ts';
import { migrate } from '../src/migrate.ts';
import { adminRoutes, issuePasswordLink } from '../src/staff.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const ORIGIN = 'https://admin.example.com';
const PASSWORD = 'correct horse battery';
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
let next = 0;

testDatabase('media', async (client) => {
  sql = client;
  await migrate(sql);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/media', mediaAdminRoutes(sql));
  app.route('/v1/admin', admin);
  app.route('/v1/media', mediaRoutes(sql));
});

const headers = { 'x-forwarded-for': '10.0.0.1' };

/** A signed-in staff member's cookie header. */
async function staff(role: string) {
  const email = `staff${++next}@example.com`;
  const [row] = await sql`insert into staff_users (name, email, role) values (${`Staff ${next}`}, ${email}, ${role}) returning id`;
  const token = new URL(await issuePasswordLink(sql, row!.id, ORIGIN)).searchParams.get('token');
  const json = { ...headers, 'Content-Type': 'application/json' };
  await app.request('/v1/admin/auth/set-password', { method: 'POST', headers: json, body: JSON.stringify({ token, password: PASSWORD }) });
  const res = await app.request('/v1/admin/auth/sign-in', { method: 'POST', headers: json, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

const upload = async (body: Uint8Array, type: string, cookie?: string, name = 'photo.jpg') =>
  app.request('/v1/admin/media', { method: 'POST', body: body as Uint8Array<ArrayBuffer>, headers: { ...headers, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name), ...(cookie ? { Cookie: cookie } : {}) } });
const get = (url: string) => app.request(url, { headers });
const sizeOf = async (res: Response) => sharp(Buffer.from(await res.arrayBuffer())).metadata();
const photo = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#c03030' } });

test('photo: becomes three WebP sizes, with the camera details dropped', { skip }, async () => {
  const cookie = await staff('catalogue');
  const jpeg = await photo(3000, 1500).jpeg().withExif({ IFD0: { Copyright: 'Taken at home, 19.07N 72.87E' } }).toBuffer();
  const res = await upload(jpeg, 'image/jpeg', cookie, 'हैंडल photo.jpg');
  assert.equal(res.status, 201);
  const { url, width, height } = (await res.json()) as { url: string; width: number; height: number };
  assert.match(url, /^\/v1\/media\/[a-f0-9]{24}\.webp$/);
  assert.deepEqual([width, height], [2400, 1200]);

  const large = await get(url);
  assert.equal(large.headers.get('content-type'), 'image/webp');
  assert.equal(large.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  // The app's web version shows it from another address.
  assert.equal(large.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const meta = await sizeOf(large);
  assert.deepEqual([meta.format, meta.width, meta.exif], ['webp', 2400, undefined]);
  assert.equal((await sizeOf(await get(url.replace('.webp', '-md.webp')))).width, 800);
  assert.equal((await sizeOf(await get(url.replace('.webp', '-sm.webp')))).width, 240);
  const [row] = await sql`select name, kind from media_files`;
  assert.deepEqual({ ...row }, { name: 'हैंडल photo.jpg', kind: 'image' });
});

test('photo: a small one is never blown up', { skip }, async () => {
  const res = await upload(await photo(120, 80).png().toBuffer(), 'image/png', await staff('owner'));
  assert.deepEqual(await res.json().then(({ width, height }) => [width, height]), [120, 80]);
});

test('pdf: kept exactly as uploaded', { skip }, async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF');
  const res = await upload(pdf, 'application/pdf', await staff('catalogue'), 'Master Feb 2026.pdf');
  const { url } = (await res.json()) as { url: string };
  assert.match(url, /^\/v1\/media\/[a-f0-9]{24}\.pdf$/);
  const file = await get(url);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);
  assert.equal((await get(url.replace('.pdf', '-sm.pdf'))).status, 404);
});

test('refused: wrong types, fakes and oversized files, each with a reason', { skip }, async () => {
  const cookie = await staff('catalogue');
  const reason = async (res: Response) => [res.status, ((await res.json()) as { error: { message: string } }).error.message];
  assert.deepEqual(await reason(await upload(Buffer.from('<svg/>'), 'image/svg+xml', cookie)), [400, 'Choose a JPG, PNG or WebP photo, or a PDF.']);
  assert.deepEqual(await reason(await upload(Buffer.from('not really a photo'), 'image/jpeg', cookie)), [400, 'That file isn’t a readable photo.']);
  assert.deepEqual(await reason(await upload(Buffer.from('<html>'), 'application/pdf', cookie)), [400, 'That file isn’t a readable PDF.']);
  assert.deepEqual(await reason(await upload(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png', cookie)), [413, 'Choose a photo under 5 MB.']);
  // Tiny as a file, 156 megapixels once opened: refused before it can use hundreds of MB.
  const huge = await photo(12500, 12500).png().toBuffer();
  assert.ok(huge.length < 5 * 1024 * 1024);
  assert.deepEqual(await reason(await upload(huge, 'image/png', cookie)), [400, 'That photo is too large. Save it under 150 megapixels and try again.']);
  assert.deepEqual(await reason(await upload(Buffer.alloc(25 * 1024 * 1024 + 1), 'application/pdf', cookie)), [413, 'Choose a file under 25 MB.']);
  // Everywhere else keeps the 1 MB limit.
  const big = await app.request('/v1/admin/auth/sign-in', { method: 'POST', body: Buffer.alloc(1024 * 1024 + 1) as Uint8Array<ArrayBuffer>, headers: { ...headers, 'Content-Type': 'application/json' } });
  assert.equal(big.status, 413);
});

test('access: only Owners and Catalogue editors upload; anyone can view', { skip }, async () => {
  const png = await photo(10, 10).png().toBuffer();
  assert.equal((await upload(png, 'image/png')).status, 401);
  assert.equal((await upload(png, 'image/png', await staff('sales'))).status, 403);
  const { url } = (await (await upload(png, 'image/png', await staff('owner'))).json()) as { url: string };
  assert.equal((await get(url)).status, 200);
  assert.equal((await get('/v1/media/0123456789abcdef01234567.webp')).status, 404);
  assert.equal((await get('/v1/media/../../etc/passwd')).status, 404);
});
