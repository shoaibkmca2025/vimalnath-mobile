import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { jsonBody, parse } from './validate.ts';

const STATUSES = ['placed', 'confirmed', 'dispatched', 'delivered', 'cancelled'] as const;
const DAY = 86_400_000;

// The app stops sending at the first update the server refuses, so free text is cut to size, never refused.
const Text = (max: number) => z.string().max(5000).default('').transform((text) => text.trim().slice(0, max));

/** An order as the app sends it (Order in the app's src/providers/OrdersProvider.tsx). Prices and totals in it are ignored. */
export const AppOrder = z.object({
  id: z.string().min(1).max(100),
  createdAt: z.string().max(40),
  customer: Text(200),
  phone: Text(40),
  notes: Text(2000),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1).max(200),
        code: Text(100),
        name: Text(300),
        option: z.string().max(500).optional(),
        note: Text(500),
        qty: z.number().int().positive().max(100_000),
        mrp: z.number().optional(),
      }),
    )
    .min(1)
    .max(1000),
});
type AppOrder = z.output<typeof AppOrder>;
type Option = { label: string; code: string | null; mrp: number };

const reasons = (...notes: (string | null)[]) => notes.filter(Boolean).join('. ') || null;
const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

/**
 * Saves an order from the app once, however often it is sent. Each line takes the server's current MRP.
 * A line that no longer matches the catalogue is kept and flagged for staff instead of refused: refusing
 * would stop that phone from sending any later order.
 */
export async function placeOrder(sql: Sql, deviceId: number, eventId: string, order: AppOrder) {
  await sql.begin(async (tx) => {
    // A resend: checked first so it doesn't use up an order number.
    const [sent] = await tx`select 1 from orders where device_id = ${deviceId} and client_event_id = ${eventId}`;
    if (sent) return;

    const ids = [...new Set(order.lines.map((line) => line.productId))];
    const found = await tx`
      select id, code, name, section, visible,
        coalesce((select json_agg(json_build_object('label', o.label, 'code', o.code, 'mrp', o.mrp)) from product_options o where o.product_id = p.id), '[]') as options
      from products p where id in ${tx(ids)}`;
    const products = new Map(found.map((product) => [product.id as string, product]));

    const lines = order.lines.map((line, position) => {
      const product = products.get(line.productId);
      const sent = { position, product_id: line.productId, code: line.code, name: line.name, option: line.option ?? null, option_code: null as string | null, note: line.note || null, qty: line.qty, mrp: null as number | null };
      if (!product) return { ...sent, problem: 'No longer in the catalogue' };
      const matched = { ...sent, code: product.code as string, name: (product.name || product.section) as string };
      const hidden = product.visible ? null : 'Hidden from the Shop';
      const options = product.options as Option[];
      const option = line.option === undefined ? undefined : options.find((item) => item.label === line.option);
      if (line.option !== undefined && !option) return { ...matched, problem: reasons(hidden, `“${line.option}” is no longer offered`) };
      if (line.option === undefined && options.length) return { ...matched, problem: reasons(hidden, 'No option was chosen') };
      // No options: priced from the catalogue page, so no MRP and nothing to flag.
      if (!option) return { ...matched, problem: hidden };
      const shown = line.mrp !== undefined && line.mrp !== option.mrp ? `The app showed ${rupees(line.mrp)}` : null;
      return { ...matched, option_code: option.code, mrp: option.mrp, problem: reasons(hidden, shown) };
    });

    const placed = Date.parse(order.createdAt);
    const placedAt = Number.isFinite(placed) && placed <= Date.now() + DAY ? new Date(placed) : new Date();
    const [{ next }] = (await tx`select nextval('order_numbers')::int as next`) as unknown as [{ next: number }];
    const [row] = await tx`
      insert into orders ${tx({
        // padStart never cuts, so number 10000 becomes VSC-10000.
        number: `VSC-${String(next).padStart(4, '0')}`,
        device_id: deviceId,
        client_event_id: eventId,
        client_order_id: order.id,
        customer: order.customer,
        phone: order.phone,
        notes: order.notes,
        total: lines.reduce((sum, line) => sum + (line.mrp ?? 0) * line.qty, 0),
        placed_at: placedAt,
      })}
      on conflict (device_id, client_event_id) do nothing
      returning id`;
    // The same order sent twice at the same moment: the other one saved it.
    if (!row) return;
    await tx`insert into order_lines ${tx(lines.map((line) => ({ order_id: row.id, ...line })))}`;
    await tx`insert into order_events ${tx({ order_id: row.id, status: 'placed', at: placedAt, by: 'App' })}`;
  });
}

/** One phone's orders for GET /v1/app/orders: the shop's number, status and history. Internal notes stay out. */
export const appOrders = (sql: Sql, deviceId: number) => sql`
  select o.id::text as id, o.number, initcap(o.status) as status, o.client_order_id as "mobileOrderId", o.client_event_id as "mobileEventId",
    (select json_agg(json_build_object('status', initcap(e.status), 'at', e.at) order by e.at) from order_events e where e.order_id = o.id) as history
  from orders o where o.device_id = ${deviceId}
  order by o.placed_at desc, o.id desc`;

/** /v1/admin/orders, for Owners and Sales. */
export function orderAdminRoutes(sql: Sql) {
  const admin = new Hono<Env>();
  admin.use(only('owner', 'sales'));

  // In the admin's Order shape (admin/src/data/types.ts); empty fields are left out.
  const orders = async (where = sql`true`) =>
    (
      await sql`
        select json_strip_nulls(json_build_object(
          'id', o.id::text, 'number', o.number, 'createdAt', o.placed_at, 'customer', o.customer,
          'phone', nullif(o.phone, ''), 'notes', nullif(o.notes, ''), 'status', o.status, 'total', o.total,
          'lines', (select json_agg(json_build_object('productId', l.product_id, 'code', l.code, 'name', l.name, 'option', l.option,
              'optionCode', l.option_code, 'note', l.note, 'qty', l.qty, 'mrp', l.mrp, 'problem', l.problem) order by l.position)
            from order_lines l where l.order_id = o.id),
          'history', (select json_agg(json_build_object('status', e.status, 'at', e.at, 'by', e.by) order by e.at) from order_events e where e.order_id = o.id),
          'internalNote', case when o.internal_note is not null then json_build_object('text', o.internal_note, 'at', o.internal_note_at, 'by', o.internal_note_by) end,
          'appUser', json_build_object('id', d.id, 'label', d.label)
        )) as "order"
        from orders o join app_devices d on d.id = o.device_id
        where ${where}
        order by o.placed_at desc, o.id desc`
    ).map((row) => row.order);

  // shortcut: every order at once, which the admin searches and filters itself; page it on the server past about 20,000 orders.
  admin.get('/', async (c) => c.json(await orders()));

  // One order or many: confirm, dispatch, deliver, cancel, or undo by setting the earlier status again. Each change is recorded.
  const OrderIds = z.array(z.coerce.number().int().positive().max(2147483647)).min(1).max(1000);
  admin.post('/status', jsonBody(z.object({ ids: OrderIds, status: z.enum(STATUSES, 'Choose a status.') })), async (c) => {
    const { ids, status } = c.req.valid('json');
    const by = c.get('staff').name;
    await sql.begin(async (tx) => {
      const changed = await tx`update orders set status = ${status} where id in ${tx(ids)} and status <> ${status} returning id`;
      if (changed.length) await tx`insert into order_events ${tx(changed.map((row) => ({ order_id: row.id, status, by })))}`;
    });
    return c.json({ orders: await orders(sql`o.id in ${sql(ids)}`) });
  });

  admin.put('/:id/internal-note', jsonBody(z.object({ text: z.string().trim().max(2000, 'Use 2,000 characters or fewer.') })), async (c) => {
    const id = parse(OrderIds.element, c.req.param('id'));
    const { text } = c.req.valid('json');
    const [row] = await sql`
      update orders set internal_note = ${text || null}, internal_note_by = ${text ? c.get('staff').name : null}, internal_note_at = ${text ? sql`now()` : null}
      where id = ${id} returning id`;
    if (!row) throw new HTTPException(404, { message: 'That order does not exist.' });
    return c.json({ orders: await orders(sql`o.id = ${id}`) });
  });

  return admin;
}
