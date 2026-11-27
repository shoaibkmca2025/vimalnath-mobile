import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { orderLink, queueOrderEvent } from './notifications.ts';
import { notifyCustomer, notifyStaff, rupees as inr } from './notify.ts';
import { storeCredit } from './returns.ts';
import { only, type Env } from './staff.ts';
import { moveStockForOrders } from './stock.ts';
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
/**
 * An app user becomes a customer with their first order: the customer is made then, named as they registered (their
 * name, else their business, else staff's label). Two orders arriving together make one: the row lock makes the
 * second wait, and it then finds the customer already there.
 */
async function ensureCustomer(tx: Sql, deviceId: number) {
  await tx`
    with device as (
      select id, coalesce(nullif(name, ''), nullif(business, ''), label) as customer_name
      from app_devices where id = ${deviceId} and customer_id is null for update
    ),
    customer as (insert into customers (name) select customer_name from device returning id)
    update app_devices set customer_id = (select id from customer) where id in (select id from device)`;
}

export async function placeOrder(sql: Sql, deviceId: number, eventId: string, order: AppOrder) {
  await sql.begin(async (tx) => {
    // A resend: checked first so it doesn't use up an order number.
    const [sent] = await tx`select 1 from orders where device_id = ${deviceId} and client_event_id = ${eventId}`;
    if (sent) return;
    await ensureCustomer(tx as unknown as Sql, deviceId);

    const ids = [...new Set(order.lines.map((line) => line.productId))];
    const found = await tx`
      select id, code, name, section, visible,
        coalesce((select json_agg(json_build_object('label', o.label, 'code', o.code, 'mrp', o.mrp)) from product_options o where o.product_id = p.id), '[]') as options
      from products p where id in ${tx(ids)}`;
    const products = new Map(found.map((product) => [product.id as string, product]));
    // The app stops out-of-stock items, but one sent offline or from an older catalogue still arrives: staff see it flagged.
    const out = new Set((await tx`select product_id, option_label from stock_items where product_id in ${tx(ids)} and quantity <= 0`).map((row) => `${row.product_id}\u0000${row.option_label}`));

    const lines = order.lines.map((line, position) => {
      const product = products.get(line.productId);
      const sent = { position, product_id: line.productId, code: line.code, name: line.name, option: line.option ?? null, option_code: null as string | null, note: line.note || null, qty: line.qty, mrp: null as number | null };
      if (!product) return { ...sent, problem: 'No longer in the catalogue' };
      const matched = { ...sent, code: product.code as string, name: (product.name || product.section) as string };
      const flagged = reasons(product.visible ? null : 'Hidden from the Shop', out.has(`${line.productId}\u0000${line.option ?? ''}`) ? 'Out of stock' : null);
      const options = product.options as Option[];
      const option = line.option === undefined ? undefined : options.find((item) => item.label === line.option);
      if (line.option !== undefined && !option) return { ...matched, problem: reasons(flagged, `“${line.option}” is no longer offered`) };
      if (line.option === undefined && options.length) return { ...matched, problem: reasons(flagged, 'No option was chosen') };
      // No options: priced from the catalogue page, so no MRP and nothing more to flag.
      if (!option) return { ...matched, problem: flagged };
      const shown = line.mrp !== undefined && line.mrp !== option.mrp ? `The app showed ${rupees(line.mrp)}` : null;
      return { ...matched, option_code: option.code, mrp: option.mrp, problem: reasons(flagged, shown) };
    });

    const placed = Date.parse(order.createdAt);
    const placedAt = Number.isFinite(placed) && placed <= Date.now() + DAY ? new Date(placed) : new Date();
    const [{ next }] = (await tx`select nextval('order_numbers')::int as next`) as unknown as [{ next: number }];
    // padStart never cuts, so number 10000 becomes VSC-10000.
    const number = `VSC-${String(next).padStart(4, '0')}`;
    const [row] = await tx`
      insert into orders ${tx({
        number,
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
    await queueOrderEvent(tx, row.id, 'placed');
    // Module 12: listed on the Activity page beside staff changes.
    await tx`insert into activity_log ${tx({ by: 'App', area: 'orders', summary: `Order ${number} placed in the app for ${order.customer}`, to_path: `/orders/${row.id}` })}`;
  });
}

/**
 * One phone's orders for GET /v1/app/orders: the shop's number, status and history. Internal and inventory notes stay out.
 * An order the shop sent ('admin') isn't on the phone yet, so it also carries its details, for the customer to confirm.
 * The first time a request reaches the phone is recorded, so staff can see it arrived.
 */
export async function appOrders(sql: Sql, deviceId: number) {
  await sql`update orders set customer_seen_at = now() where device_id = ${deviceId} and source = 'admin' and customer_seen_at is null`;
  return phoneOrders(sql, deviceId);
}

const phoneOrders = (sql: Sql, deviceId: number) => sql`
  select o.id::text as id, o.number, initcap(o.status) as status, o.client_order_id as "mobileOrderId", o.client_event_id as "mobileEventId", o.source,
    coalesce((select json_agg(json_build_object('status', initcap(e.status), 'at', e.at) order by e.at) from order_events e where e.order_id = o.id), '[]') as history,
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
    const [order] = await tx`select status, number, customer from orders where id = ${orderId} and device_id = ${deviceId} for update`;
    if (!order) throw new HTTPException(404, { message: 'That order is not on this connection.' });
    // Pressed twice, or on two phones: the same answer again is fine.
    if (order.status === status) return;
    if (order.status !== 'requested') throw new HTTPException(409, { message: order.status === 'cancelled' ? 'The shop has cancelled this order.' : 'This order has already been answered.' });
    await tx`update orders set status = ${status} where id = ${orderId}`;
    await tx`insert into order_events ${tx({ order_id: orderId, status, by: 'App' })}`;
    // The office hears the answer (a confirmed one goes on to the inventory team).
    await notifyStaff(
      tx,
      'request_answered',
      { customer: order.customer, answer: status, number: order.number },
      { entityType: 'order', entityId: orderId, data: { to: `/orders/${orderId}` } },
      { roles: ['sales'] },
      `request_answered:${orderId}`,
    );
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

/** Orders the customer owes for: from placing (or confirming a request) through delivery. Cancelled and declined ones don't. */
const BILLED: Status[] = ['placed', 'confirmed', 'packed', 'dispatched', 'delivered'];
/** ₹100 crore: far above any one order, and inside a Postgres integer. */
const MAX_RUPEES = 1_000_000_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const Payment = z.object({
  orderId: z.number().int().positive().max(2147483647),
  amount: z.number('Enter the amount in rupees.').int('Enter whole rupees.').positive('Enter an amount above ₹0.').max(MAX_RUPEES, 'Enter ₹100 crore or less.'),
  // store_credit: from what the customer holds after a return refunded as store credit.
  method: z.enum(['cash', 'upi', 'bank', 'cheque', 'store_credit'], 'Choose how they paid.'),
  // A real calendar day, not after tomorrow in UTC: in India it is already tomorrow for the first 5½ hours of the UTC day.
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the day it was paid.')
    .refine((day) => !Number.isNaN(Date.parse(day)) && isoDay(new Date(day)) === day, 'Pick the day it was paid.')
    .refine((day) => day >= '2000-01-01', 'Pick a day from 2000 on.')
    .refine((day) => day <= isoDay(new Date(Date.now() + DAY)), 'The day can’t be in the future.'),
  note: z.string().trim().max(300, 'Use 300 characters or fewer.').default(''),
});

/**
 * Orders in the admin's Order shape (admin/src/data/types.ts); empty fields are left out. `money` adds the bill and
 * payments, which the inventory team doesn't see. Returns use it too, when a refund pays off one of a customer's orders.
 */
export const adminOrders = async (sql: Sql | TransactionSql, where = sql`true`, money = true) =>
  (
    await sql`
      select json_strip_nulls(json_build_object(
        'terms', ${money ? sql`o.payment_terms` : sql`null`}, 'bill', ${money ? sql`o.bill_amount` : sql`null`},
        'payments', ${
          money
            ? sql`(select json_agg(json_build_object('id', p.id::text, 'amount', p.amount, 'method', p.method, 'paidOn', p.paid_on, 'note', nullif(p.note, ''), 'by', p.by, 'at', p.created_at) order by p.paid_on, p.id)
                from order_payments p where p.order_id = o.id)`
            : sql`null`
        },
        'id', o.id::text, 'number', o.number, 'createdAt', o.placed_at, 'customer', o.customer,
        'phone', nullif(o.phone, ''), 'notes', nullif(o.notes, ''), 'status', o.status, 'total', o.total,
        'lines', (select json_agg(json_build_object('productId', l.product_id, 'code', l.code, 'name', l.name, 'option', l.option,
            'optionCode', l.option_code, 'note', l.note, 'qty', l.qty, 'mrp', l.mrp, 'problem', l.problem,
            'picked', case when l.picked_at is not null then json_build_object('at', l.picked_at, 'by', l.picked_by) end) order by l.position)
          from order_lines l where l.order_id = o.id),
        -- An empty list, not null, for an order without events (an import, say): the admin reads it as a list.
        'history', coalesce((select json_agg(json_build_object('status', e.status, 'at', e.at, 'by', e.by) order by e.at) from order_events e where e.order_id = o.id), '[]'),
        'source', o.source,
        'customerSeenAt', o.customer_seen_at,
        'internalNote', case when o.internal_note is not null then json_build_object('text', o.internal_note, 'at', o.internal_note_at, 'by', o.internal_note_by) end,
        'inventoryNote', case when o.inventory_note is not null then json_build_object('text', o.inventory_note, 'at', o.inventory_note_at, 'by', o.inventory_note_by) end,
        'appUser', json_build_object('id', d.id, 'label', d.label),
        'customerRecord', case when cu.id is not null then json_build_object('id', cu.id, 'name', cu.name) end
      )) as "order"
      from orders o join app_devices d on d.id = o.device_id left join customers cu on cu.id = d.customer_id
      where ${where}
      order by o.placed_at desc, o.id desc`
  ).map((row) => row.order);

/**
 * /v1/admin/orders, for Owners and Sales; the inventory team sees and moves only the orders it packs and dispatches. The
 * Accountant sees every order and handles its money (bill and payments) but doesn't move it.
 */
export function orderAdminRoutes(sql: Sql) {
  const admin = new Hono<Env>();
  admin.use(only('owner', 'sales', 'inventory', 'accountant'));
  const office = only('owner', 'sales');
  // An order's bill and the payments towards it.
  const money = only('owner', 'accountant');
  const inventory = (role: string) => role === 'inventory';

  const orders = (where = sql`true`, money = true) => adminOrders(sql, where, money);

  // shortcut: every order at once, which the admin searches and filters itself; page it on the server past about 20,000 orders.
  // The inventory team also sees delivered orders, so an order doesn't vanish the moment the office marks it delivered.
  const forInventory = () => sql`o.status in ${sql([...INVENTORY_STATUSES, 'delivered'])}`;
  admin.get('/', async (c) => {
    const team = inventory(c.get('staff').role);
    return c.json(await orders(team ? forInventory() : sql`true`, !team));
  });

  // An order staff make for a customer, sent to their app to confirm. It reaches the inventory team once they confirm it.
  admin.post('/', office, jsonBody(OrderRequest), async (c) => {
    const request = c.req.valid('json');
    const by = c.get('staff').name;
    const id = await sql.begin(async (tx) => {
      const [device] = await tx`select id from app_devices where id = ${request.appUserId}`;
      if (!device) throw new HTTPException(400, { message: 'That app user does not exist.', cause: { field: 'appUserId' } });
      // A request is an order too: an app user who hasn't ordered yet becomes a customer with it.
      await ensureCustomer(tx as unknown as Sql, device.id);
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
      // The customer's phone: a new order from the shop to confirm.
      await queueOrderEvent(tx, row!.id as number, 'requested');
      return row!.id as number;
    });
    return c.json({ orders: await orders(sql`o.id = ${id}`) }, 201);
  });

  // One order or many: confirm, dispatch, deliver, cancel, or undo by setting the earlier status again. Each change is recorded.
  const OrderIds = z.array(z.coerce.number().int().positive().max(2147483647)).min(1).max(1000);
  // The inventory team moves orders between Pending (confirmed), Packed and Dispatched; marks a dispatched order
  // delivered (and back, to undo); and cancels one that hasn't gone out yet (Pending or Packed). Only the office can
  // restore a cancelled order, so the inventory team can't bring back, or confirm, an order the office cancelled.
  const INVENTORY_MOVES: Record<string, string[]> = {
    confirmed: [...INVENTORY_STATUSES],
    packed: [...INVENTORY_STATUSES],
    dispatched: [...INVENTORY_STATUSES, 'delivered'],
    delivered: ['dispatched'],
    cancelled: ['confirmed', 'packed'],
  };
  admin.post('/status', jsonBody(z.object({ ids: OrderIds, status: z.enum(STATUSES, 'Choose a status.') })), async (c) => {
    const { ids, status } = c.req.valid('json');
    const { name: by, role } = c.get('staff');
    const from = INVENTORY_MOVES[status];
    if (role === 'accountant') throw new HTTPException(403, { message: 'Accountants see orders but don’t change their status.' });
    if (inventory(role) && !from) throw new HTTPException(403, { message: 'The inventory team can mark orders pending, packed, dispatched, delivered or cancelled.' });
    // Sales move orders along; cancelling one, or bringing a cancelled one back, is the Owner's.
    if (role === 'sales' && status === 'cancelled') throw new HTTPException(403, { message: 'Only the Owner can cancel an order.' });
    await sql.begin(async (tx) => {
      const allowed = inventory(role) ? tx`and status in ${tx(from!)}` : role === 'sales' ? tx`and status <> 'cancelled'` : tx``;
      // Locked in id order, with the status each had, so stock knows which orders were delivered before.
      const changed = await tx`
        with picked as (select id, status as was from orders where id in ${tx(ids)} and status <> ${status} ${allowed} order by id for update)
        update orders o set status = ${status} from picked where o.id = picked.id returning o.id, picked.was`;
      // Returned goods came back against the delivery: undoing it would put the stock back twice.
      const undelivered = changed.filter((row) => row.was === 'delivered').map((row) => row.id as number);
      if (undelivered.length) {
        const [held] = await tx`
          select o.number, r.number as return_number from sales_returns r join orders o on o.id = r.order_id
          where r.order_id in ${tx(undelivered)} and r.status not in ('rejected', 'cancelled') order by r.id limit 1`;
        if (held) throw new HTTPException(409, { message: `${held.number} has return ${held.return_number}, so it stays delivered. Cancel the return first.` });
      }
      if (changed.length) await tx`insert into order_events ${tx(changed.map((row) => ({ order_id: row.id, status, by })))}`;
      // Delivered orders take their items from stock; one moved back from delivered puts them back.
      await moveStockForOrders(tx, changed.map((row) => ({ id: row.id as number, was: row.was as string, now: status })), by);
      // Module 10: the customer hears about it on the app's Notifications screen, and as a push if their phone takes them.
      for (const row of changed) await queueOrderEvent(tx, row.id, status);
    });
    return c.json({ orders: await orders(sql`o.id in ${sql(ids)}`, !inventory(role)) });
  });

  // Payments: money a customer paid towards one or more orders, e.g. one cheque split across their oldest bills. All are
  // saved or none. An order can't be paid past its bill, and only orders in progress or delivered take payments.
  admin.post('/payments', money, jsonBody(z.object({ payments: z.array(Payment).min(1, 'Enter a payment.').max(200) })), async (c) => {
    const { payments } = c.req.valid('json');
    const { name: by, id: staffId } = c.get('staff');
    const ids = [...new Set(payments.map((payment) => payment.orderId))];
    await sql.begin(async (tx) => {
      // Locked, in id order, so two people recording payments at once can't both take an order past its bill.
      const locked = await tx`select id, number, status, coalesce(bill_amount, total) as bill from orders where id in ${tx(ids)} order by id for update`;
      const sums = await tx`select order_id, sum(amount)::float8 as paid from order_payments where order_id in ${tx(ids)} group by order_id`;
      const paid = new Map(sums.map((row) => [row.order_id as number, row.paid as number]));
      const found = new Map(locked.map((row) => [row.id as number, row]));
      payments.forEach((payment, index) => {
        const order = found.get(payment.orderId);
        if (!order) throw new HTTPException(404, { message: 'That order does not exist.', cause: { field: `payments.${index}.orderId` } });
        if (!BILLED.includes(order.status)) throw new HTTPException(400, { message: `${order.number} is ${order.status}, so it takes no payments.`, cause: { field: `payments.${index}.orderId` } });
        const before = paid.get(order.id) ?? 0;
        if (order.bill === 0) throw new HTTPException(400, { message: `Set the bill amount for ${order.number} first.`, cause: { field: `payments.${index}.amount` } });
        if (before + payment.amount > order.bill) throw new HTTPException(400, { message: `That is more than ${order.number} still owes (${rupees(order.bill - before)}).`, cause: { field: `payments.${index}.amount` } });
        paid.set(order.id, before + payment.amount);
      });
      // Store credit: each customer's use of it in this request, against what they hold. Their row is locked, so two
      // people spending the same credit at once can't both succeed.
      const fromCredit = payments.filter((payment) => payment.method === 'store_credit');
      if (fromCredit.length) {
        const owners = await tx`
          select o.id, coalesce((select merged_into from customers where id = d.customer_id), d.customer_id) as customer_id
          from orders o join app_devices d on d.id = o.device_id where o.id in ${tx([...new Set(fromCredit.map((payment) => payment.orderId))])}`;
        const ownerOf = new Map(owners.map((row) => [row.id as number, row.customer_id as number | null]));
        const spend = new Map<number, number>();
        for (const payment of fromCredit) {
          const customer = ownerOf.get(payment.orderId);
          if (!customer) throw new HTTPException(400, { message: 'This order has no customer record, so it can’t use store credit.', cause: { field: 'payments' } });
          spend.set(customer, (spend.get(customer) ?? 0) + payment.amount);
        }
        for (const [customer, amount] of [...spend].sort((a, b) => a[0] - b[0])) {
          await tx`select id from customers where id = ${customer} for update`;
          const available = await storeCredit(tx, customer);
          if (amount > available) throw new HTTPException(400, { message: `The customer has ${rupees(available)} of store credit, less than ${rupees(amount)}.`, cause: { field: 'payments' } });
        }
      }
      const saved = await tx`insert into order_payments ${tx(payments.map((payment) => ({ order_id: payment.orderId, amount: payment.amount, method: payment.method, paid_on: payment.paidOn, note: payment.note, by })))} returning id, order_id`;
      // Each order's customer hears what came in and what's left (or that it's paid); the Accountant and Owner hear it too.
      const details = await tx`
        select o.id, o.number, o.customer, o.device_id, o.client_order_id, o.source, coalesce(o.bill_amount, o.total) as bill
        from orders o where o.id in ${tx(ids)}`;
      for (const order of details) {
        const received = payments.filter((payment) => payment.orderId === order.id).reduce((sum, payment) => sum + payment.amount, 0);
        const left = order.bill - (paid.get(order.id) ?? 0);
        const key = saved.filter((row) => row.order_id === order.id).map((row) => row.id).join(',');
        const link = orderLink(order as unknown as Parameters<typeof orderLink>[0]);
        await notifyCustomer(tx, order.device_id, 'payment_received', { amount: inr(received), number: order.number, balance: left > 0 ? `${inr(left)} is still to pay.` : 'It’s paid in full.' }, link, `payment_received:order:${key}`, order.id);
        if (left <= 0) await notifyCustomer(tx, order.device_id, 'invoice_paid', { number: order.number, total: inr(order.bill) }, link, `invoice_paid:order:${order.id}:${order.bill}`, order.id);
        await notifyStaff(
          tx,
          'payment_recorded',
          { by, amount: inr(received), customer: order.customer, number: order.number },
          { entityType: 'order', entityId: order.id, data: { to: `/orders/${order.id}` } },
          { roles: ['accountant'], except: { id: staffId } },
          `payment_recorded:order:${key}`,
        );
      }
    });
    return c.json({ orders: await orders(sql`o.id in ${sql(ids)}`) }, 201);
  });

  // A payment entered by mistake. The activity log keeps who removed it.
  admin.delete('/payments/:paymentId', money, async (c) => {
    const id = parse(OrderIds.element, c.req.param('paymentId'));
    const [settled] = await sql`
      select r.number from order_payments p join refund_transactions t on t.id = p.refund_id join sales_returns r on r.id = t.return_id where p.id = ${id}`;
    if (settled) throw new HTTPException(409, { message: `This payment is return ${settled.number}’s refund, set against the order. It stays on record.` });
    const [row] = await sql`delete from order_payments where id = ${id} returning order_id`;
    if (!row) throw new HTTPException(404, { message: 'That payment has already been removed.' });
    return c.json({ orders: await orders(sql`o.id = ${row.order_id}`) });
  });

  // Cash or credit, and what the customer owes for it. The MRP total given back is stored as "the MRP total".
  const Billing = z.object({
    terms: z.enum(['cash', 'credit'], 'Choose cash or credit.'),
    bill: z.number('Enter the bill in rupees.').int('Enter whole rupees.').min(0, 'Enter ₹0 or more.').max(MAX_RUPEES, 'Enter ₹100 crore or less.').nullable(),
  });
  admin.put('/:id/billing', money, jsonBody(Billing), async (c) => {
    const id = parse(OrderIds.element, c.req.param('id'));
    const { terms, bill } = c.req.valid('json');
    await sql.begin(async (tx) => {
      const [order] = await tx`select id, number, total, coalesce(bill_amount, total) as bill, device_id, client_order_id, source from orders where id = ${id} for update`;
      if (!order) throw new HTTPException(404, { message: 'That order does not exist.' });
      // A posted tax invoice fixes the bill; changing it means cancelling the invoice (or a credit note).
      const [invoice] = await tx`select number from sales_invoices where order_id = ${id} and status = 'posted' and return_id is null`;
      if (invoice) throw new HTTPException(409, { message: `Tax invoice ${invoice.number} fixes this bill. Cancel the invoice to change it.`, cause: { field: 'bill' } });
      const [{ paid }] = (await tx`select coalesce(sum(amount), 0)::float8 as paid from order_payments where order_id = ${id}`) as unknown as [{ paid: number }];
      if ((bill ?? order.total) < paid) throw new HTTPException(400, { message: `${rupees(paid)} has been paid already, so the bill can’t be less. Remove a payment first.`, cause: { field: 'bill' } });
      await tx`update orders set payment_terms = ${terms}, bill_amount = ${bill === order.total ? null : bill} where id = ${id}`;
      // A new bill amount reaches the customer (the same amount again tells nobody).
      if ((bill ?? order.total) !== order.bill)
        await notifyCustomer(tx, order.device_id, 'order_updated', { number: order.number, total: inr(bill ?? order.total) }, orderLink(order as unknown as Parameters<typeof orderLink>[0]), `order_updated:${id}:${bill ?? order.total}`, id);
    });
    return c.json({ orders: await orders(sql`o.id = ${id}`) });
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
  admin.put('/:id/inventory-note', only('owner', 'sales', 'inventory'), jsonBody(z.object({ text: z.string().trim().max(2000, 'Use 2,000 characters or fewer.') })), async (c) => {
    const id = parse(OrderIds.element, c.req.param('id'));
    const { text } = c.req.valid('json');
    const { name, role } = c.get('staff');
    const [row] = await sql`
      update orders o set inventory_note = ${text || null}, inventory_note_by = ${text ? name : null}, inventory_note_at = ${text ? sql`now()` : null}
      where o.id = ${id} and ${inventory(role) ? forInventory() : sql`true`} returning o.id`;
    if (!row) throw new HTTPException(404, { message: 'That order does not exist.' });
    return c.json({ orders: await orders(sql`o.id = ${id}`, !inventory(role)) });
  });

  // The pick list: a line ticked as the inventory team picks it (who and when), or unticked. Only while the order is
  // being packed. The office sees the ticks but doesn't tick.
  admin.put('/:id/lines/:position/picked', only('owner', 'inventory'), jsonBody(z.object({ picked: z.boolean() })), async (c) => {
    const id = parse(OrderIds.element, c.req.param('id'));
    const position = parse(z.coerce.number().int().min(0).max(1000), c.req.param('position'));
    const { picked } = c.req.valid('json');
    const { name, role } = c.get('staff');
    const [row] = await sql`
      update order_lines l set picked_at = ${picked ? sql`now()` : null}, picked_by = ${picked ? name : null}
      from orders o where o.id = l.order_id and l.order_id = ${id} and l.position = ${position} and o.status in ('confirmed', 'packed')
      returning l.order_id`;
    if (!row) throw new HTTPException(409, { message: 'This order isn’t being packed any more, so its items can’t be ticked.' });
    return c.json({ orders: await orders(sql`o.id = ${id}`, !inventory(role)) });
  });

  return admin;
}
