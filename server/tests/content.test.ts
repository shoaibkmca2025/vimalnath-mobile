import assert from 'node:assert/strict';
import { test } from 'node:test';

import type postgres from 'postgres';

import type { Banner, MoreApp, Settings, VideoSection } from '../../admin/src/data/types.ts';
import { createApp } from '../src/app.ts';
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

type Content = { banners: Banner[]; videoSections: VideoSection[]; moreApps: MoreApp[]; settings: Settings };

testDatabase('content', async (client) => {
  sql = client;
  await migrate(sql);
  await importSeed(sql, seed);
  app = createApp({ adminOrigin: ORIGIN, production: false, trustProxy: true, checkDatabase: async () => 1, requestsPerMinute: 100000 });
  const admin = adminRoutes(sql, { adminOrigin: ORIGIN, production: false, trustProxy: true });
  admin.route('/', contentRoutes(sql));
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

const read = async () => (await (await send('/content', 'GET', undefined, await staff('sales'))).json()) as Content;
const reason = async (res: Response) => {
  const { error } = (await res.json()) as { error: { message: string; field?: string } };
  return [res.status, error.message, error.field];
};

test('read: banners, videos and settings come back exactly as imported, with no More Apps yet', { skip }, async () => {
  assert.deepEqual(await read(), { banners: seed.banners, videoSections: seed.videoSections, moreApps: [], settings: seed.settings });
});

test('banners: the slideshow is saved whole, in order, with hidden ones kept', { skip }, async () => {
  const cookie = await staff('catalogue');
  const banners: Banner[] = [
    { id: 'banner-2', image: '/v1/media/0123456789abcdef01234567.webp', kicker: '', headline: 'Folding doors', body: 'Open the whole wall.', active: false },
    { ...seed.banners[0]!, headline: 'Systems that move with you' },
  ];
  assert.equal((await send('/banners', 'PUT', { banners }, cookie)).status, 204);
  assert.deepEqual((await read()).banners, banners);
  assert.equal((await send('/banners', 'PUT', { banners: [] }, cookie)).status, 204);
  assert.deepEqual((await read()).banners, []);
  assert.equal((await send('/banners', 'PUT', { banners: seed.banners }, cookie)).status, 204);
});

test('banners: refused input says why and saves nothing', { skip }, async () => {
  const cookie = await staff('owner');
  const banner = seed.banners[0]!;
  const tries = [
    [[banner, banner], 'A banner is listed twice.', 'banners'],
    [[{ ...banner, headline: '  ' }], 'Enter a headline.', 'banners.0.headline'],
    [[{ ...banner, headline: 'x'.repeat(61) }], 'Use 60 characters or fewer.', 'banners.0.headline'],
    [[{ ...banner, image: 'javascript:alert(1)' }], 'Choose a JPG, PNG or WebP photo.', 'banners.0.image'],
  ] as const;
  for (const [banners, message, field] of tries) assert.deepEqual(await reason(await send('/banners', 'PUT', { banners }, cookie)), [400, message, field || undefined]);
  assert.deepEqual((await read()).banners, seed.banners);
});

test('videos: sections and their videos are saved in order; an empty section or a plain http link is refused', { skip }, async () => {
  const cookie = await staff('catalogue');
  const videoSections: VideoSection[] = [
    { title: 'Partitions', videos: [{ title: 'Slim partition', detail: '', url: 'https://www.youtube.com/watch?v=abc' }] },
    { title: 'Sliding', videos: [{ title: 'Synchronized', detail: '2+0', url: 'https://youtu.be/xyz' }, ...seed.videoSections[0]!.videos] },
  ];
  assert.equal((await send('/videos', 'PUT', { videoSections }, cookie)).status, 204);
  assert.deepEqual((await read()).videoSections, videoSections);

  assert.deepEqual(await reason(await send('/videos', 'PUT', { videoSections: [{ title: 'Empty', videos: [] }] }, cookie)), [400, 'A section needs at least one video.', 'videoSections.0.videos']);
  assert.deepEqual(await reason(await send('/videos', 'PUT', { videoSections: [videoSections[0], videoSections[0]] }, cookie)), [400, 'Two sections have the same name.', 'videoSections']);
  const insecure = [{ title: 'Sliding', videos: [{ title: 'Old', detail: '', url: 'http://youtube.com/x' }] }];
  assert.deepEqual(await reason(await send('/videos', 'PUT', { videoSections: insecure }, cookie)), [400, 'Use a secure link that starts with https://.', 'videoSections.0.videos.0.url']);
  assert.deepEqual((await read()).videoSections, videoSections);
});

test('more apps: saved in order; an app needs at least one secure store link', { skip }, async () => {
  const cookie = await staff('catalogue');
  const moreApps: MoreApp[] = [
    { name: 'Glass Quote', description: 'Quotes for glass work.', icon: '/v1/media/0123456789abcdef01234567.webp', playStore: 'https://play.google.com/store/apps/details?id=x', appStore: '' },
    { name: 'Site Diary', description: '', icon: null, playStore: '', appStore: 'https://apps.apple.com/app/id1' },
  ];
  assert.equal((await send('/more-apps', 'PUT', { moreApps }, cookie)).status, 204);
  assert.deepEqual((await read()).moreApps, moreApps);
  assert.deepEqual(await reason(await send('/more-apps', 'PUT', { moreApps: [{ ...moreApps[0], playStore: '' }] }, cookie)), [400, 'Add a Play Store or App Store link.', 'moreApps.0.playStore']);
  assert.deepEqual(await reason(await send('/more-apps', 'PUT', { moreApps: [{ ...moreApps[0], playStore: 'http://play.google.com/x' }] }, cookie)), [400, 'Use a secure link that starts with https://.', 'moreApps.0.playStore']);
  assert.deepEqual((await read()).moreApps, moreApps);
  assert.equal((await send('/more-apps', 'PUT', { moreApps: [moreApps[1]] }, cookie)).status, 204);
  assert.deepEqual((await read()).moreApps, [moreApps[1]]);
});

test('settings: an Owner saves company details and update control; the developer line stays as it is', { skip }, async () => {
  const owner = await staff('owner');
  const settings: Settings = { ...seed.settings, phone: '+91 22 4000 1234', email: 'sales@vimalnath.in', website: 'https://vimalnath.in', appVersion: '1.10.0', minAppVersion: '1.9.0', defaultUnit: 'in' };
  assert.equal((await send('/settings', 'PUT', { settings: { ...settings, developer: 'Someone else' } }, owner)).status, 204);
  assert.deepEqual((await read()).settings, settings);
});

test('settings: a minimum newer than the latest version, or a bad email, is refused beside its field', { skip }, async () => {
  const owner = await staff('owner');
  const before = (await read()).settings;
  const tries = [
    [{ minAppVersion: '1.10.1', appVersion: '1.10.0' }, 'The minimum version can’t be newer than the latest version.', 'settings.minAppVersion'],
    [{ appVersion: '1.10' }, 'Enter the version like 1.2.0.', 'settings.appVersion'],
    [{ email: 'sales@' }, 'Enter an email address like sales@company.com.', 'settings.email'],
    [{ website: 'http://vimalnath.in' }, 'Use the secure address, starting with https://.', 'settings.website'],
    [{ phone: '12345' }, 'Enter a 10-digit number, with the area code for landlines.', 'settings.phone'],
  ] as const;
  for (const [change, message, field] of tries) assert.deepEqual(await reason(await send('/settings', 'PUT', { settings: { ...before, ...change } }, owner)), [400, message, field]);
  assert.deepEqual((await read()).settings, before);
});

test('settings: a database imported before update control reads an empty minimum', { skip }, async () => {
  await sql`delete from settings where key = 'minAppVersion'`;
  assert.equal((await read()).settings.minAppVersion, '');
});

test('access: everyone signed in reads; Sales changes nothing; only Owners change settings', { skip }, async () => {
  assert.equal((await send('/content')).status, 401);
  const sales = await staff('sales');
  const catalogue = await staff('catalogue');
  assert.equal((await send('/content', 'GET', undefined, catalogue)).status, 200);
  for (const [path, body] of [['/banners', { banners: seed.banners }], ['/videos', { videoSections: seed.videoSections }], ['/more-apps', { moreApps: [] }], ['/settings', { settings: seed.settings }]] as const) {
    assert.equal((await send(path, 'PUT', body, sales)).status, 403, path);
  }
  assert.equal((await send('/settings', 'PUT', { settings: seed.settings }, catalogue)).status, 403);
});
