import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { jsonBody, parse } from './validate.ts';

const STATUSES = ['requested', 'declined', 'placed', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'] as const;
type Status = (typeof STATUSES)[number];
/** The inventory team works on confirmed orders: "Pending" (confirmed) until packed, then dispatched. */
const INVENTORY_STATUSES = ['confirmed', 'packed', 'dispatched'] as const satisfies Status[];
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

/**
 * One phone's orders for GET /v1/app/orders: the shop's number, status and history. Internal and inventory notes stay out.
 * An order the shop sent ('admin') isn't on the phone yet, so it also carries its details, for the customer to confirm.
 */
export const appOrders = (sql: Sql, deviceId: number) => sql`
  select o.id::text as id, o.number, initcap(o.status) as status, o.client_order_id as "mobileOrderId", o.client_event_id as "mobileEventId", o.source,
    (select json_agg(json_build_object('status', initcap(e.status), 'at', e.at) order by e.at) from order_events e where e.order_id = o.id) as history,
    case when o.source = 'admin' then json_strip_nulls(json_build_object(
      'createdAt', o.placed_at, 'customer', o.customer, 'phone', nullif(o.phone, ''), 'notes', nullif(o.notes, ''), 'total', o.total,
      'lines', (select json_agg(json_build_object('productId', l.product_id, 'code', l.code, 'name', l.name, 'option', l.option,
          'optionCode', l.option_code, 'note', l.note, 'qty', l.qty, 'mrp', l.mrp) order by l.position)
        from order_lines l where l.order_id = o.id)
    )) end as details
  from orders o where o.device_id = ${deviceId}
  order by o.placed_at desc, o.id desc`;

/** The customer's answer to an order the shop sent: confirming it passes it to the inventory team. */
export async function respondToRequest(sql: Sql, deviceId: number, orderId: number, decision: 'confirm' | 'decline') {
  const status = decision === 'confirm' ? 'confirmed' : 'declined';
  await sql.begin(async (tx) => {
    const [order] = await tx`select status from orders where id = ${orderId} and device_id = ${deviceId} for update`;
    if (!order) throw new HTTPException(404, { message: 'That order is not on this connection.' });
    // Pressed twice, or on two phones: the same answer again is fine.
    if (order.status === status) return;
    if (order.status !== 'requested') throw new HTTPException(409, { message: order.status === 'cancelled' ? 'The shop has cancelled this order.' : 'This order has already been answered.' });
    await tx`update orders set status = ${status} where id = ${orderId}`;
    await tx`insert into order_events ${tx({ order_id: orderId, status, by: 'App' })}`;
  });
}

/** Lines for an order staff send to a customer: each priced from the catalogue now, as an app order is. */
const RequestLine = z.object({
  productId: z.string().min(1).max(200),
  option: z.string().max(500).optional(),
  qty: z.number().int('Enter whole numbers.').positive('Enter a quantity of 1 or more.').max(100_000),
  note: z.string().trim().max(500, 'Use 500 characters or fewer.').optional(),
});
const OrderRequest = z.object({
  appUserId: z.coerce.number().int().positive('Choose who to send it to.').max(2147483647),
  customer: z.string().trim().min(1, 'Enter the customer or site name.').max(200, 'Use 200 characters or fewer.'),
  phone: z.string().trim().max(40, 'Use 40 characters or fewer.').default(''),
  notes: z.string().trim().max(2000, 'Use 2,000 characters or fewer.').default(''),
  lines: z.array(RequestLine).min(1, 'Add at least one product.').max(1000),
});

/** /v1/admin/orders, for Owners and Sales; the inventory team sees and moves only the orders it packs and dispatches. */
export function orderAdminRoutes(sql: Sql) {
  const admin = new Hono<Env>();
  admin.use(only('owner', 'sales', 'inventory'));
  const office = only('owner', 'sales');
  const inventory = (role: string) => role === 'inventory';

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
          'source', o.source,
          'internalNote', case when o.internal_note is not null then json_build_object('text', o.internal_note, 'at', o.internal_note_at, 'by', o.internal_note_by) end,
          'inventoryNote', case when o.inventory_note is not null then json_build_object('text', o.inventory_note, 'at', o.inventory_note_at, 'by', o.inventory_note_by) end,
          'appUser', json_build_object('id', d.id, 'label', d.label),
          'customerRecord', json_build_object('id', cu.id, 'name', cu.name)
        )) as "order"
        from orders o join app_devices d on d.id = o.device_id join customers cu on cu.id = d.customer_id
        where ${where}
        order by o.placed_at desc, o.id desc`
    ).map((row) => row.order);

  // shortcut: every order at once, which the admin searches and filters itself; page it on the server past about 20,000 orders.
  // The inventory team also sees delivered orders, so an order doesn't vanish the moment the office marks it delivered.
  const forInventory = () => sql`o.status in ${sql([...INVENTORY_STATUSES, 'delivered'])}`;
  admin.get('/', async (c) => c.json(await orders(inventory(c.get('staff').role) ? forInventory() : sql`true`)));

  // An order staff make for a customer, sent to their app to confirm. It reaches the inventory team once they confirm it.
  admin.post('/', office, jsonBody(OrderRequest), async (c) => {
    const request = c.req.valid('json');
    const by = c.get('staff').name;
    const id = await sql.begin(async (tx) => {
      const [device] = await tx`select id from app_devices where id = ${request.appUserId}`;
      if (!device) throw new HTTPException(400, { message: 'That app user does not exist.', cause: { field: 'appUserId' } });
      const ids = [...new Set(request.lines.map((line) => line.productId))];
      const found = await tx`
        select id, code, name, section,
          coalesce((select json_agg(json_build_object('label', o.label, 'code', o.code, 'mrp', o.mrp)) from product_options o where o.product_id = p.id), '[]') as options
        from products p where id in ${tx(ids)}`;
      const products = new Map(found.map((product) => [product.id as string, product]));
      const lines = request.lines.map((line, position) => {
        const product = products.get(line.productId);
        if (!product) throw new HTTPException(400, { message: 'A product in this order is no longer in the catalogue.', cause: { field: `lines.${position}.productId` } });
        const options = product.options as Option[];
        const option = line.option === undefined ? undefined : options.find((item) => item.label === line.option);
        if (options.length && !option) throw new HTTPException(400, { message: `Choose an option for ${product.code}.`, cause: { field: `lines.${position}.option` } });
        return {
          position,
          product_id: product.id as string,
          code: product.code as string,
          name: (product.name || product.section) as string,
          option: option?.label ?? null,
          option_code: option?.code ?? null,
          note: line.note || null,
          qty: line.qty,
          mrp: option?.mrp ?? null,
          problem: null,
        };
      });
      const [{ next }] = (await tx`select nextval('order_numbers')::int as next`) as unknown as [{ next: number }];
      const number = `VSC-${String(next).padStart(4, '0')}`;
      const [row] = await tx`
        insert into orders ${tx({
          number,
          device_id: device.id,
          // Never matches an id the app makes up, so the app doesn't take it for one of its own orders.
          client_event_id: `admin:${number}`,
          client_order_id: `admin:${number}`,
          source: 'admin',
          customer: request.customer,
          phone: request.phone,
          notes: request.notes,
          status: 'requested',
          total: lines.reduce((sum, line) => sum + (line.mrp ?? 0) * line.qty, 0),
          placed_at: new Date(),
        })}
        returning id`;
      await tx`insert into order_lines ${tx(lines.map((line) => ({ order_id: row!.id, ...line })))}`;
      await tx`insert into order_events ${tx({ order_id: row!.id, status: 'requested', by })}`;
      return row!.id as number;
    });
    return c.json({ orders: await orders(sql`o.id = ${id}`) }, 201);
  });

  // One order or many: confirm, dispatch, deliver, cancel, or undo by setting the earlier status again. Each change is recorded.
  const OrderIds = z.array(z.coerce.number().int().positive().max(2147483647)).min(1).max(1000);
  // The inventory team can only move orders between Pending (confirmed), Packed and Dispatched.
  admin.post('/status', jsonBody(z.object({ ids: OrderIds, status: z.enum(STATUSES, 'Choose a status.') })), async (c) => {
    const { ids, status } = c.req.valid('json');
    const { name: by, role } = c.get('staff');
    if (inventory(role) && !(INVENTORY_STATUSES as readonly string[]).includes(status)) throw new HTTPException(403, { message: 'The inventory team can mark orders pending, packed or dispatched.' });
    await sql.begin(async (tx) => {
      const allowed = inventory(role) ? tx`and status in ${tx([...INVENTORY_STATUSES])}` : tx``;
      const changed = await tx`update orders set status = ${status} where id in ${tx(ids)} and status <> ${status} ${allowed} returning id`;
      if (changed.length) await tx`insert into order_events ${tx(changed.map((row) => ({ order_id: row.id, status, by })))}`;
    });
    return c.json({ orders: await orders(sql`o.id in ${sql(ids)}`) });
  });

  admin.put('/:id/internal-note', office, jsonBody(z.object({ text: z.string().trim().max(2000, 'Use 2,000 characters or fewer.') })), async (c) => {
    const id = parse(OrderIds.element, c.req.param('id'));
    const { text } = c.req.valid('json');
    const [row] = await sql`
      update orders set internal_note = ${text || null}, internal_note_by = ${text ? c.get('staff').name : null}, internal_note_at = ${text ? sql`now()` : null}
      where id = ${id} returning id`;
    if (!row) throw new HTTPException(404, { message: 'That order does not exist.' });
    return c.json({ orders: await orders(sql`o.id = ${id}`) });
  });

  // The inventory team's note, e.g. "2 hinges short" or the transport and LR number. All staff read it; the customer never does.
  admin.put('/:id/inventory-note', jsonBody(z.object({ text: z.string().trim().max(2000, 'Use 2,000 characters or fewer.') })), async (c) => {
    const id = parse(OrderIds.element, c.req.param('id'));
    const { text } = c.req.valid('json');
    const { name, role } = c.get('staff');
    const [row] = await sql`
      update orders o set inventory_note = ${text || null}, inventory_note_by = ${text ? name : null}, inventory_note_at = ${text ? sql`now()` : null}
      where o.id = ${id} and ${inventory(role) ? forInventory() : sql`true`} returning o.id`;
    if (!row) throw new HTTPException(404, { message: 'That order does not exist.' });
    return c.json({ orders: await orders(sql`o.id = ${id}`) });
  });

  return admin;
}
