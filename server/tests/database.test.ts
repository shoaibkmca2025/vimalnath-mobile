import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import type { Seed } from '../../admin/src/data/types.ts';
import { importSeed } from '../src/import-data.ts';
import { migrate } from '../src/migrate.ts';
import { needsDatabase as skip, testDatabase } from './test-db.ts';

const db = testDatabase('data');

const seed: Seed = {
  generatedAt: '2026-11-09',
  categories: [{ id: 'glass', label: 'Glass Hardware', image: '/media/a.webp', fit: 'cover', visible: true }],
  products: [
    {
      id: 'p1',
      code: 'TGH-55',
      name: 'H Type Handle',
      category: 'glass',
      section: 'Door Handles',
      image: null,
      catalogPage: { source: 'master', page: 10 },
      options: [
        { label: 'SSS', code: 'TGH-55-S', mrp: 1500 },
        { label: 'BM', mrp: 1700 },
      ],
      specs: [{ label: 'Finish', value: 'Steel' }],
      featured: true,
      visible: true,
    },
    // The same code on a second product, as the real catalogues have.
    { id: 'p2', code: 'TGH-55', name: '', category: 'glass', section: 'Partition Hardware', image: '/media/b.webp', catalogPage: { source: 'office', page: 21 }, options: [{ label: 'SSS', mrp: 1500 }], specs: [], featured: false, visible: true },
  ],
  catalogPages: { 'master-10': '/media/pages/master-10.webp', 'office-21': '/media/pages/office-21.webp' },
  catalogues: [{ number: '01', kicker: 'MASTER', title: 'Master', meta: 'Feb 2026', tone: 'blue', url: '' }],
  sections: [{ code: 'S-101', name: 'Sliding frame', system: 'Sliding', bar: 6000, dimensions: '45 × 25 mm', description: 'Frame.' }],
  videoSections: [{ title: 'Sliding', videos: [{ title: 'Telescopic', detail: '1+0 to 4+1', url: 'https://youtube.com/x' }] }],
  cutlist: {
    systems: [{ id: 'telescopic', name: 'Telescopic', subtitle: 'Travel', photo: null }],
    configurations: { telescopic: [{ name: '1+0', image: '/media/c.jpg' }], synchronized: [], folding: [] },
  },
  banners: [{ id: 'hero-1', image: '/media/h.webp', kicker: 'New', headline: 'Move', body: 'Text', active: true }],
  settings: { companyName: 'Vimalnath', tagline: 't', phone: '', email: '', website: '', address: '', defaultUnit: 'mm', priceListEdition: 'Feb 2026', developer: '4AM', appVersion: '1.0.0', logo: '/media/l.png' },
};

const count = async (table: string) => Number((await db.sql`select count(*) from ${db.sql(table)}`)[0]!.count);

test('migrations: a failed one rolls back completely', { skip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  await writeFile(path.join(dir, '001_good.sql'), 'create table temp_good (id integer);');
  await writeFile(path.join(dir, '002_bad.sql'), 'select this is not sql;');
  await assert.rejects(migrate(db.sql, new URL(`${pathToFileURL(dir).href}/`)));
  const [table] = await db.sql`select to_regclass('temp_good') as found`;
  assert.equal(table!.found, null);
  await rm(dir, { recursive: true });
});

test('migrations: two at once both finish and apply each file once', { skip }, async () => {
  const results = await Promise.all([migrate(db.sql), migrate(db.sql)]);
  // One does all the work and the other finds nothing left to do.
  assert.equal(Math.min(...results.map((applied) => applied.length)), 0);
  assert.ok(Math.max(...results.map((applied) => applied.length)) > 0);
});

test('migrations: running again changes nothing', { skip }, async () => {
  assert.deepEqual(await migrate(db.sql), []);
});

test('import: everything lands, prices intact', { skip }, async () => {
  await importSeed(db.sql, seed);
  assert.equal(await count('products'), 2);
  assert.equal(await count('product_options'), 3);
  assert.equal(await count('catalogue_pages'), 2);
  assert.equal(await count('videos'), 1);
  assert.equal(await count('settings'), 11);
  const options = await db.sql`select label, code, mrp from product_options where product_id = 'p1' order by sort_order`;
  assert.deepEqual([...options].map((row) => ({ ...row })), [
    { label: 'SSS', code: 'TGH-55-S', mrp: 1500 },
    { label: 'BM', code: null, mrp: 1700 },
  ]);
});

test('import: refuses to run over existing data', { skip }, async () => {
  await assert.rejects(importSeed(db.sql, seed), /already has 2 products/);
  assert.equal(await count('products'), 2);
});

test('import: a failure leaves nothing behind', { skip }, async () => {
  await db.sql`delete from products`;
  await db.sql`delete from cutlist_configurations`;
  await db.sql`delete from cutlist_systems`;
  await db.sql`delete from categories`;
  await db.sql`delete from catalogue_pages`;
  await db.sql`delete from price_lists`;
  await db.sql`delete from bar_sections`;
  await db.sql`delete from banners`;
  await db.sql`delete from video_sections`;
  await db.sql`delete from settings`;
  // A bad price: rejected by the database partway through.
  await assert.rejects(importSeed(db.sql, { ...seed, products: seed.products.map((product) => ({ ...product, options: [{ label: 'X', mrp: -1 }] })) }));
  assert.equal(await count('categories'), 0);
  assert.equal(await count('products'), 0);
});

test('database rules: a price must be above zero', { skip }, async () => {
  await assert.rejects(db.sql`insert into product_options (product_id, label, mrp, sort_order) values ('nope', 'x', 0, 0)`);
});
