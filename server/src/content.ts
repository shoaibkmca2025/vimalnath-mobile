import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { distinct, Image, isHttps, Required, Text } from './catalogue.ts';
import { only, type Env } from './staff.ts';
import { jsonBody } from './validate.ts';
import { claimList, Seen } from './versions.ts';

const Link = Text(300).refine((url) => !url || isHttps(url), 'Use a secure link that starts with https://.');
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
/** Negative when version a is older than b: "1.9.0" is older than "1.10.0". */
const compareVersions = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

// Same limits as the admin's Home Banners form, so a phone's slide never overflows.
const Banners = z
  .array(
    z.object({
      id: z.string().regex(/^[\w-]{1,60}$/, 'That banner id is not valid.'),
      image: Image,
      kicker: Text(40),
      headline: Required(60, 'Enter a headline.'),
      body: Text(90),
      active: z.boolean(),
    }),
  )
  .max(20)
  .refine(distinct('id'), 'A banner is listed twice.');

const VideoSections = z
  .array(
    z.object({
      title: Required(80, 'Name the section.'),
      videos: z
        .array(
          z.object({
            title: Required(120, 'Enter the video’s title.'),
            detail: Text(200),
            url: Required(500, 'Paste the video’s link.').refine(isHttps, 'Use a secure link that starts with https://.'),
          }),
        )
        .min(1, 'A section needs at least one video.')
        .max(100),
    }),
  )
  .max(30)
  .refine(distinct('title'), 'Two sections have the same name.');

const MoreApps = z
  .array(
    z
      .object({ name: Required(60, 'Enter the app’s name.'), description: Text(200), icon: Image.nullable(), playStore: Link, appStore: Link })
      .refine((app) => app.playStore || app.appStore, { error: 'Add a Play Store or App Store link.', path: ['playStore'] }),
  )
  .max(20);

// `developer` is left out on purpose: it is not something the shop edits, so a save never changes it.
const Settings = z
  .object({
    companyName: Required(120, 'Enter the company name.'),
    tagline: Text(120),
    phone: Text(30).refine((phone) => !phone || phone.replace(/\D/g, '').length >= 10, 'Enter a 10-digit number, with the area code for landlines.'),
    email: Text(120).regex(/^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter an email address like sales@company.com.'),
    website: Text(300).refine((url) => !url || isHttps(url), 'Use the secure address, starting with https://.'),
    address: Text(300),
    logo: Image,
    defaultUnit: z.enum(['mm', 'in']),
    priceListEdition: Text(80),
    appVersion: z.string().regex(VERSION, 'Enter the version like 1.2.0.'),
    minAppVersion: z.string().refine((version) => !version || VERSION.test(version), 'Enter the version like 1.2.0, or leave it empty.'),
  })
  .refine((settings) => !settings.minAppVersion || compareVersions(settings.minAppVersion, settings.appVersion) <= 0, {
    error: 'The minimum version can’t be newer than the latest version.',
    path: ['minAppVersion'],
  });

/** Module 9: what the app shows besides the catalogue. Every signed-in person reads it; Owners and Catalogue editors change content, only Owners change settings. */
export function contentRoutes(sql: Sql) {
  const content = new Hono<Env>();
  const editors = only('owner', 'catalogue');

  content.get('/content', async (c) => {
    const [banners, sections, videos, moreApps, settings] = await Promise.all([
      sql`select id, image, kicker, headline, body, active from banners order by sort_order`,
      sql`select id, title from video_sections order by sort_order`,
      sql`select section_id, title, detail, url from videos order by section_id, sort_order`,
      sql`select name, description, icon, play_store as "playStore", app_store as "appStore" from more_apps order by sort_order`,
      sql`select key, value from settings`,
    ]);
    return c.json({
      banners,
      videoSections: sections.map((section) => ({ title: section.title, videos: videos.filter((video) => video.section_id === section.id).map(({ title, detail, url }) => ({ title, detail, url })) })),
      moreApps,
      // Databases imported before Module 9 have no minimum version: empty means none.
      settings: { minAppVersion: '', ...Object.fromEntries(settings.map((row) => [row.key, row.value])) },
    });
  });

  // Each list is short and saved whole, in the order the app shows it.
  content.put('/banners', editors, jsonBody(z.object({ banners: Banners, version: Seen })), async (c) => {
    const { banners, version } = c.req.valid('json');
    const rows = banners.map((banner, sort_order) => ({ ...banner, sort_order }));
    await sql.begin(async (tx) => {
      await claimList(tx, 'banners', version);
      await tx`delete from banners`;
      if (rows.length) await tx`insert into banners ${tx(rows)}`;
    });
    return c.body(null, 204);
  });

  content.put('/videos', editors, jsonBody(z.object({ videoSections: VideoSections, version: Seen })), async (c) => {
    const { videoSections, version } = c.req.valid('json');
    await sql.begin(async (tx) => {
      await claimList(tx, 'videoSections', version);
      await tx`delete from video_sections`; // their videos go too (on delete cascade)
      for (const [sort_order, { title, videos }] of videoSections.entries()) {
        const [section] = await tx`insert into video_sections ${tx({ title, sort_order })} returning id`;
        await tx`insert into videos ${tx(videos.map((video, index) => ({ section_id: section!.id, ...video, sort_order: index })))}`;
      }
    });
    return c.body(null, 204);
  });

  content.put('/more-apps', editors, jsonBody(z.object({ moreApps: MoreApps, version: Seen })), async (c) => {
    const { moreApps, version } = c.req.valid('json');
    const rows = moreApps.map(({ playStore, appStore, ...app }, sort_order) => ({ ...app, play_store: playStore, app_store: appStore, sort_order }));
    await sql.begin(async (tx) => {
      await claimList(tx, 'moreApps', version);
      await tx`delete from more_apps`;
      if (rows.length) await tx`insert into more_apps ${tx(rows)}`;
    });
    return c.body(null, 204);
  });

  content.put('/settings', only('owner'), jsonBody(z.object({ settings: Settings, version: Seen })), async (c) => {
    const { settings, version } = c.req.valid('json');
    const rows = Object.entries(settings).map(([key, value]) => ({ key, value }));
    await sql.begin(async (tx) => {
      await claimList(tx, 'settings', version);
      await tx`insert into settings ${tx(rows)} on conflict (key) do update set value = excluded.value`;
    });
    return c.body(null, 204);
  });

  return content;
}
