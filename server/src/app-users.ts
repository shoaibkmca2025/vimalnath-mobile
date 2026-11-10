import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type postgres from 'postgres';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { newToken, only, sha256, type Env } from './staff.ts';
import { jsonBody, parse } from './validate.ts';

// The app sends its updates strictly in order and stops at the first one refused, so free text
// from it is cut to size instead of refused: one long name must not hold up the orders behind it.
const Text = z.string().max(5000).default('').transform((text) => text.trim().slice(0, 200));
const EventId = z.string().min(1).max(300);
const Label = z.string().trim().min(1, 'Enter who this is for.').max(100, 'Use 100 characters or fewer.');
const AppUserId = z.coerce.number().int().positive().max(2147483647);

const ProfileEvent = z.object({ eventId: EventId, profile: z.object({ name: Text, business: Text, phone: Text, email: Text, city: Text }) });
// Kept whole for Module 6; only what identifies an order is checked here.
const OrderEvent = z.object({
  eventId: EventId,
  order: z.looseObject({ id: z.string().min(1).max(100), createdAt: z.string().max(40), lines: z.array(z.looseObject({})).min(1).max(1000), total: z.number() }),
});
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
  app.get('/orders', async (c) => {
    const deviceId = c.get('deviceId');
    const orders = await sql`
      select event_id as id, event_id as "mobileEventId", body->'order'->>'id' as "mobileOrderId", 'Received' as status
      from app_events where device_id = ${deviceId} and kind = 'order' order by received_at desc`;
    return c.json({ customerId: String(deviceId), orders });
  });

  app.post('/orders', jsonBody(OrderEvent), async (c) => {
    const { eventId, order } = c.req.valid('json');
    await sql`insert into app_events (device_id, event_id, kind, body) values (${c.get('deviceId')}, ${eventId}, 'order', ${sql.json({ order } as postgres.JSONValue)}) on conflict do nothing`;
    return c.json({ received: true });
  });

  app.post('/activity', jsonBody(ActivityEvent), async (c) => {
    const { eventId, ...activity } = c.req.valid('json');
    await sql`insert into app_events (device_id, event_id, kind, body) values (${c.get('deviceId')}, ${eventId}, 'activity', ${sql.json(activity)}) on conflict do nothing`;
    return c.json({ received: true });
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
      count(e.event_id) filter (where e.kind = 'order')::int as orders,
      count(e.event_id) filter (where e.kind = 'activity')::int as views
    from app_devices d left join app_events e on e.device_id = d.id
    where ${where} group by d.id order by d.created_at desc`;
  const one = async (id: number) => (await appUsers(sql`d.id = ${id}`))[0];

  // shortcut: sends every app user at once; page it on the server past a few thousand.
  admin.get('/', async (c) => c.json(await appUsers()));

  // The token is shown once: only its hash is kept.
  admin.post('/', jsonBody(z.object({ label: Label })), async (c) => {
    const token = newToken();
    const [row] = await sql`insert into app_devices (label, token_hash) values (${c.req.valid('json').label}, ${sha256(token)}) returning id`;
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
