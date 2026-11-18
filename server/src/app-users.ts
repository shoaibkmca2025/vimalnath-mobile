import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { readCalculators } from './calculators.ts';
import { readCatalogue } from './catalogue.ts';
import { readContent } from './content.ts';
import { AppOrder, appOrders, placeOrder, respondToRequest } from './orders.ts';
import { newToken, only, sha256, type Env } from './staff.ts';
import { jsonBody, parse } from './validate.ts';

// The app sends its updates strictly in order and stops at the first one refused, so free text
// from it is cut to size instead of refused: one long name must not hold up the orders behind it.
const Text = z.string().max(5000).default('').transform((text) => text.trim().slice(0, 200));
const EventId = z.string().min(1).max(300);
const Label = z.string().trim().min(1, 'Enter who this is for.').max(100, 'Use 100 characters or fewer.');
const AppUserId = z.coerce.number().int().positive().max(2147483647);

const ProfileEvent = z.object({ eventId: EventId, profile: z.object({ name: Text, business: Text, phone: Text, email: Text, city: Text }) });
const OrderEvent = z.object({ eventId: EventId, order: AppOrder });
const ActivityEvent = z.object({
  eventId: EventId,
  type: z.string().min(1).max(40),
  occurredAt: z.string().max(40),
  productId: z.string().max(200).optional(),
  productName: z.string().max(500).optional(),
  optionIndex: z.number().int().optional(),
  optionLabel: z.string().max(500).optional(),
  price: z.number().optional(),
});

/**
 * Module 11: everything the app shows, as people in the app see it. Hidden products and categories, and banners
 * switched off, stay in the admin.
 */
export async function appContent(sql: Sql) {
  const [{ products, categories, catalogues, catalogPages }, { cutlist, sections }, { banners, videoSections, moreApps, settings }] = await Promise.all([readCatalogue(sql), readCalculators(sql), readContent(sql)]);
  return {
    products: products.filter((product) => product.visible).map(({ visible: _, ...product }) => product),
    categories: categories.filter((category) => category.visible).map(({ visible: _, ...category }) => category),
    catalogPages,
    priceLists: catalogues,
    cutlist,
    sections,
    banners: banners.filter((banner) => banner.active).map(({ active: _, ...banner }) => banner),
    videoSections,
    moreApps,
    settings,
  };
}

/** Everything under /v1/app: the customer's phone, signed in with the token the shop gave them. */
export function appRoutes(sql: Sql) {
  const app = new Hono<{ Variables: { deviceId: number } }>();

  app.use(async (c, next) => {
    const token = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1];
    // Blocked phones are still marked as seen, so staff can tell they keep trying.
    const [device] = token ? await sql`update app_devices set last_seen_at = now() where token_hash = ${sha256(token)} returning id, blocked` : [];
    if (!device) throw new HTTPException(401, { message: 'This token is not valid. Ask the shop for a new one.' });
    if (device.blocked) throw new HTTPException(403, { message: 'The shop has turned off this connection.' });
    c.set('deviceId', device.id);
    await next();
  });

  // The app calls this around every sync: customerId pins the phone to one customer, and
  // mobileEventId tells it which of its orders have arrived, so it never sends one twice.
  app.get('/orders', async (c) => c.json({ customerId: String(c.get('deviceId')), orders: await appOrders(sql, c.get('deviceId')) }));

  app.post('/orders', jsonBody(OrderEvent), async (c) => {
    const { eventId, order } = c.req.valid('json');
    await placeOrder(sql, c.get('deviceId'), eventId, order);
    return c.json({ received: true });
  });

  // The customer confirms or declines an order the shop sent. Confirmed, it goes to the inventory team.
  app.post('/orders/:id/respond', jsonBody(z.object({ decision: z.enum(['confirm', 'decline'], 'Choose confirm or decline.') })), async (c) => {
    const id = parse(AppUserId, c.req.param('id'));
    await respondToRequest(sql, c.get('deviceId'), id, c.req.valid('json').decision);
    return c.json({ orders: await appOrders(sql, c.get('deviceId')) });
  });

  app.post('/activity', jsonBody(ActivityEvent), async (c) => {
    const { eventId, ...activity } = c.req.valid('json');
    await sql`insert into app_events (device_id, event_id, kind, body) values (${c.get('deviceId')}, ${eventId}, 'activity', ${sql.json(activity)}) on conflict do nothing`;
    return c.json({ received: true });
  });

  // The phone sends the version it has (11.2): if nothing changed it gets only the version back; otherwise everything, about 40 KB gzipped.
  // shortcut: builds and fingerprints the whole catalogue on every check, and sends all of it when anything changed. Store a version
  // that each save moves on, and send only changed rows, once checks pass a few a second or the catalogue passes a few MB.
  app.get('/content', compress(), async (c) => {
    const content = await appContent(sql);
    const version = sha256(JSON.stringify(content)).slice(0, 16);
    return c.json(c.req.query('have') === version ? { version } : { version, content });
  });

  app.post('/profile', jsonBody(ProfileEvent), async (c) => {
    await sql`update app_devices set ${sql(c.req.valid('json').profile)}, profile_updated_at = now() where id = ${c.get('deviceId')}`;
    return c.json({ received: true });
  });

  return app;
}

/** /v1/admin/app-users: who has the app connected to the shop. Mounted after the staff sign-in check. */
export function appUserAdminRoutes(sql: Sql) {
  const admin = new Hono<Env>();
  admin.use(only('owner', 'sales'));

  // shortcut: counts every event ever received on each load; keep counters on app_devices once app_events passes about a million rows.
  const appUsers = (where = sql`true`) => sql`
    select d.id, d.label, d.name, d.business, d.phone, d.email, d.city, d.blocked,
      d.last_seen_at as "lastSeenAt", d.profile_updated_at as "profileUpdatedAt", d.created_at as "createdAt",
      (select count(*) from orders o where o.device_id = d.id)::int as orders,
      (select count(*) from app_events e where e.device_id = d.id)::int as views
    from app_devices d
    where ${where} order by d.created_at desc`;
  const one = async (id: number) => (await appUsers(sql`d.id = ${id}`))[0];

  // shortcut: sends every app user at once; page it on the server past a few thousand.
  admin.get('/', async (c) => c.json(await appUsers()));

  // The token is shown once: only its hash is kept.
  admin.post('/', jsonBody(z.object({ label: Label })), async (c) => {
    const token = newToken();
    const { label } = c.req.valid('json');
    // Each new app user starts as its own customer; staff merge them when one customer has several phones.
    const [row] = await sql`
      with customer as (insert into customers (name) values (${label}) returning id)
      insert into app_devices (label, token_hash, customer_id) select ${label}, ${sha256(token)}, id from customer returning id`;
    return c.json({ appUser: await one(row!.id), token }, 201);
  });

  const Change = z.object({ label: Label.optional(), blocked: z.boolean().optional() }).refine((change) => Object.keys(change).length > 0, 'Nothing to change.');

  admin.patch('/:id', jsonBody(Change), async (c) => {
    const id = parse(AppUserId, c.req.param('id'));
    const [row] = await sql`update app_devices set ${sql(c.req.valid('json'))} where id = ${id} returning id`;
    if (!row) throw new HTTPException(404, { message: 'That app user does not exist.' });
    return c.json(await one(id));
  });

  // Same customer, new token: the old one stops working, and the phone keeps its saved orders.
  admin.post('/:id/token', async (c) => {
    const id = parse(AppUserId, c.req.param('id'));
    const token = newToken();
    const [row] = await sql`update app_devices set token_hash = ${sha256(token)} where id = ${id} returning id`;
    if (!row) throw new HTTPException(404, { message: 'That app user does not exist.' });
    return c.json({ token });
  });

  return admin;
}
