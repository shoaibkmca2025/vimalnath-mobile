import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { jsonBody } from './validate.ts';

// Rules match the admin's product editor, so anything it allows is saved and anything it stops is refused here too.
const Text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const Required = (max: number, message: string) => Text(max).min(1, message);
// One of the app's own photos (/media/...), or one uploaded through /v1/admin/media.
const Image = z.string().max(300).regex(/^(\/media\/[\w./-]+|\/v1\/media\/[a-f0-9]{24}\.webp)$/, 'Choose a JPG, PNG or WebP photo.');
const isHttps = (url: string) => URL.canParse(url) && new URL(url).protocol === 'https:';

const distinct = <K extends string>(key: K) => (items: Record<K, string>[]) => new Set(items.map((item) => item[key])).size === items.length;

const Product = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,100}$/, 'That product id is not valid.'),
    code: Required(60, 'Enter the product code from the catalogue.'),
    name: Text(200),
    category: z.string().min(1).max(60),
    section: Text(200),
    image: Image.nullable(),
    catalogPage: z.object({
      source: z.enum(['master', 'office', 'tavic'], 'Choose a catalogue.'),
      page: z.number().int('Enter the page number, 1 or more.').min(1, 'Enter the page number, 1 or more.').max(10_000),
    }),
    options: z
      .array(z.object({ label: Required(200, 'Name every option.'), code: Text(60).optional(), mrp: z.number().int('Enter the MRP in whole rupees.').positive('Enter an MRP above ₹0.').max(100_000_000) }))
      .max(200)
      // The app and saved carts find an option by its name.
      .refine(distinct('label'), 'Each option needs a different name.'),
    specs: z.array(z.object({ label: Required(100, 'Name every specification.'), value: Required(500, 'Give every specification a value.') })).max(50),
    featured: z.boolean(),
    visible: z.boolean(),
  })
  .refine((product) => product.name || product.section, { message: 'Enter a name, or a section the app can show instead.', path: ['name'] });

const Category = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,60}$/, 'That category id is not valid.'),
  label: Required(60, 'Enter a name for this category.'),
  image: Image,
  fit: z.enum(['cover', 'contain']),
  visible: z.boolean(),
});

const PriceList = z.object({
  number: z.string().regex(/^\w{1,10}$/, 'That price list number is not valid.'),
  kicker: Text(60),
  title: Required(100, 'Enter the price list’s title.'),
  meta: Text(200),
  tone: Text(20),
  // Empty until published (the app shows "coming soon"), an uploaded PDF, or a secure link.
  url: z.string().max(2000).refine((url) => url === '' || /^\/v1\/media\/[a-f0-9]{24}\.pdf$/.test(url) || isHttps(url), 'Use a secure link that starts with https://.'),
});


/** The catalogue under /v1/admin: every signed-in staff member reads it; Owners and Catalogue editors change it. */
export function catalogueRoutes(sql: Sql) {
  const catalogue = new Hono<Env>();
  const editors = only('owner', 'catalogue');

  // The whole catalogue in the admin's shape (about 250 KB for the real one), so its pages search and filter it themselves.
  catalogue.get('/catalogue', async (c) => {
    const [products, categories, catalogues, pages] = await Promise.all([
      sql`
        select p.id, p.code, p.name, p.category_id as category, p.section, p.image,
          json_build_object('source', p.catalogue_source, 'page', p.catalogue_page) as "catalogPage",
          coalesce((select json_agg(json_strip_nulls(json_build_object('label', o.label, 'code', o.code, 'mrp', o.mrp)) order by o.sort_order)
            from product_options o where o.product_id = p.id), '[]') as options,
          coalesce((select json_agg(json_build_object('label', s.label, 'value', s.value) order by s.sort_order)
            from product_specs s where s.product_id = p.id), '[]') as specs,
          p.featured, p.visible
        from products p order by p.sort_order, p.id`,
      sql`select id, label, image, image_fit as fit, visible from categories order by sort_order`,
      sql`select number, kicker, title, meta, tone, url from price_lists order by sort_order`,
      sql`select source || '-' || page as key, image from catalogue_pages`,
    ]);
    return c.json({ products, categories, catalogues, catalogPages: Object.fromEntries(pages.map((page) => [page.key, page.image])) });
  });

  // Saves whole products, new or changed, with their options and specs. Five queries however many products, so hiding 650 at once stays quick.
  catalogue.put('/products', editors, jsonBody(z.object({ products: z.array(Product).min(1).max(1000).refine(distinct('id'), 'A product is listed twice.') })), async (c) => {
    const { products } = c.req.valid('json');
    const ids = products.map((product) => product.id);
    await sql
      .begin(async (tx) => {
        // New products go to the top of the list, as the admin shows them.
        const [{ first }] = (await tx`select coalesce(min(sort_order), 0)::int as first from products`) as unknown as [{ first: number }];
        const rows = products.map((product, index) => ({
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
          sort_order: first - products.length + index,
        }));
        await tx`
          insert into products ${tx(rows)}
          on conflict (id) do update set code = excluded.code, name = excluded.name, section = excluded.section, category_id = excluded.category_id,
            catalogue_source = excluded.catalogue_source, catalogue_page = excluded.catalogue_page, image = excluded.image,
            featured = excluded.featured, visible = excluded.visible`;
        await tx`delete from product_options where product_id in ${tx(ids)}`;
        await tx`delete from product_specs where product_id in ${tx(ids)}`;
        const options = products.flatMap((product) => product.options.map((option, sort_order) => ({ product_id: product.id, label: option.label, code: option.code || null, mrp: option.mrp, sort_order })));
        const specs = products.flatMap((product) => product.specs.map((spec, sort_order) => ({ product_id: product.id, label: spec.label, value: spec.value, sort_order })));
        if (options.length) await tx`insert into product_options ${tx(options)}`;
        if (specs.length) await tx`insert into product_specs ${tx(specs)}`;
      })
      .catch((error: { code?: string }) => {
        if (error.code === '23503') throw new HTTPException(400, { message: 'That category does not exist.', cause: { field: 'category' } });
        throw error;
      });
    return c.body(null, 204);
  });

  // Old orders keep their own copy of what was ordered, so deleting a product never changes them.
  catalogue.delete('/products/:id', editors, async (c) => {
    const [row] = await sql`delete from products where id = ${c.req.param('id')} returning id`;
    if (!row) throw new HTTPException(404, { message: 'That product does not exist.' });
    return c.body(null, 204);
  });

  // The whole list, in the order the app shows it.
  catalogue.put('/categories', editors, jsonBody(z.object({ categories: z.array(Category).min(1).max(100).refine(distinct('id'), 'A category is listed twice.') })), async (c) => {
    const rows = c.req.valid('json').categories.map(({ fit, ...category }, sort_order) => ({ ...category, image_fit: fit, sort_order }));
    await sql`
      insert into categories ${sql(rows)}
      on conflict (id) do update set label = excluded.label, image = excluded.image, image_fit = excluded.image_fit, visible = excluded.visible, sort_order = excluded.sort_order`;
    return c.body(null, 204);
  });

  catalogue.put('/price-lists', editors, jsonBody(z.object({ priceLists: z.array(PriceList).min(1).max(20).refine(distinct('number'), 'A price list is listed twice.') })), async (c) => {
    const rows = c.req.valid('json').priceLists.map((list, sort_order) => ({ ...list, sort_order }));
    await sql`
      insert into price_lists ${sql(rows)}
      on conflict (number) do update set kicker = excluded.kicker, title = excluded.title, meta = excluded.meta, tone = excluded.tone, url = excluded.url, sort_order = excluded.sort_order`;
    return c.body(null, 204);
  });

  return catalogue;
}
