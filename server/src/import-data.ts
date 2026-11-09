import { readFile } from 'node:fs/promises';

import type { Sql } from 'postgres';

import type { Seed } from '../../admin/src/data/types.ts';
import { loadConfig } from './config.ts';
import { connect } from './db.ts';

/** The app's data as files, already built by the admin's seed script (cd admin && npm run seed). */
const SEED = new URL('../../admin/public/data/seed.json', import.meta.url);

/** Copies the app's data into an empty database, all of it or none. Refuses to overwrite existing data. */
export async function importSeed(sql: Sql, seed: Seed) {
  await sql.begin(async (tx) => {
    const [existing] = await tx`select count(*)::int as count from products`;
    if (existing!.count > 0) throw new Error(`The database already has ${existing!.count} products. The import only runs on an empty database.`);

    const insert = (table: string, rows: object[]) => tx`insert into ${tx(table)} ${tx(rows)}`;

    await insert('categories', seed.categories.map(({ fit, ...category }, sort_order) => ({ ...category, image_fit: fit, sort_order })));
    await insert(
      'products',
      seed.products.map((product, sort_order) => ({
        id: product.id,
        code: product.code,
        name: product.name,
        section: product.section,
        category_id: product.category,
        catalogue_source: product.catalogPage.source,
        catalogue_page: product.catalogPage.page,
        image: product.image,
        featured: product.featured,
        visible: product.visible,
        sort_order,
      })),
    );
    await insert(
      'product_options',
      seed.products.flatMap((product) => product.options.map((option, sort_order) => ({ product_id: product.id, label: option.label, code: option.code ?? null, mrp: option.mrp, sort_order }))),
    );
    await insert('product_specs', seed.products.flatMap((product) => product.specs.map((spec, sort_order) => ({ product_id: product.id, ...spec, sort_order }))));
    await insert(
      'catalogue_pages',
      Object.entries(seed.catalogPages).map(([key, image]) => {
        const [source, page] = key.split('-');
        return { source, page: Number(page), image };
      }),
    );
    await insert('price_lists', seed.catalogues.map((list, sort_order) => ({ ...list, sort_order })));
    await insert('cutlist_systems', seed.cutlist.systems.map((system, sort_order) => ({ ...system, sort_order })));
    await insert(
      'cutlist_configurations',
      Object.entries(seed.cutlist.configurations).flatMap(([system_id, configurations]) => configurations.map((configuration, sort_order) => ({ system_id, ...configuration, sort_order }))),
    );
    await insert('bar_sections', seed.sections.map(({ bar, ...section }, sort_order) => ({ ...section, bar_mm: bar, sort_order })));
    await insert('banners', seed.banners.map((banner, sort_order) => ({ ...banner, sort_order })));
    for (const [sort_order, { title, videos }] of seed.videoSections.entries()) {
      const [section] = await tx`insert into video_sections ${tx({ title, sort_order })} returning id`;
      await insert('videos', videos.map((video, index) => ({ section_id: section!.id, ...video, sort_order: index })));
    }
    await insert('settings', Object.entries(seed.settings).map(([key, value]) => ({ key, value })));
  });
}

if (import.meta.main) {
  const text = await readFile(SEED, 'utf8').catch(() => {
    throw new Error('admin/public/data/seed.json is missing. Run: cd admin && npm run seed');
  });
  const seed = JSON.parse(text) as Seed;
  const sql = connect(loadConfig().DATABASE_URL);
  try {
    await importSeed(sql, seed);
    console.log(`Imported ${seed.products.length} products, ${seed.categories.length} categories, ${seed.sections.length} bar sections and ${seed.banners.length} banners.`);
  } finally {
    await sql.end();
  }
}
