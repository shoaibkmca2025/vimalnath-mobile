import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { jsonBody } from './validate.ts';

/**
 * Stock, stage 1 of inventory: what the shop has of each item, what it costs and sells for, where it is kept, and every
 * change to the quantity. Owners and the inventory team change it; Sales see it without purchase prices.
 */

export const UNITS = ['pcs', 'box', 'packet', 'set', 'feet', 'rft', 'meter', 'sqft', 'sqm', 'kg', 'sheet', 'length'] as const;
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40] as const;
/** Why staff added or took away stock by hand. */
export const ADJUST_REASONS = ['damaged', 'lost', 'returned', 'used', 'found', 'correction', 'other'] as const;
/** Quantities go to 3 decimals (KG, metres), up to 1 crore of anything. */
const MAX_QUANTITY = 10_000_000;
const MAX_PRICE = 100_000_000;

const Quantity = (label: string) =>
  z
    .number(`Enter the ${label} as a number.`)
    .min(0, `Enter 0 or more for the ${label}.`)
    .max(MAX_QUANTITY, `Enter a ${label} of 1 crore or less.`)
    .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6, `Use up to 3 decimal places for the ${label}.`);
const Price = (label: string) =>
  z
    .number(`Enter the ${label} in rupees.`)
    .min(0, `Enter ₹0 or more for the ${label}.`)
    .max(MAX_PRICE, `Enter a ${label} of ₹10 crore or less.`)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, `Use rupees and paise, e.g. 125.50, for the ${label}.`)
    .nullable();
const Text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const Key = { productId: z.string().min(1).max(200), option: z.string().max(200) };

const Item = z
  .object({
    ...Key,
    sku: Text(60),
    barcode: Text(60).regex(/^[\w\-./ ]*$/, 'Use letters, numbers and - . / for the barcode.'),
    unit: z.enum(UNITS, 'Choose a unit.'),
    brand: Text(100),
    manufacturer: Text(100),
    hsn: Text(8).regex(/^(\d{4}|\d{6}|\d{8})?$/, 'Enter the HSN code: 4, 6 or 8 digits.'),
    gstRate: z
      .number()
      .refine((rate) => (GST_RATES as readonly number[]).includes(rate), 'Choose a GST rate: 0, 0.25, 3, 5, 12, 18, 28 or 40%.')
      .nullable(),
    purchasePrice: Price('purchase price').optional(),
    sellingPrice: Price('selling price'),
    wholesalePrice: Price('wholesale price'),
    minStock: Quantity('minimum stock').nullable(),
    maxStock: Quantity('maximum stock').nullable(),
    rack: Text(40),
    location: Text(100),
    /** A new item's opening stock, or a counted quantity that replaces what's recorded. Left out: unchanged. */
    quantity: Quantity('stock').optional(),
  })
  .refine((item) => item.minStock === null || item.maxStock === null || item.minStock <= item.maxStock, { message: 'The maximum can’t be below the minimum.', path: ['maxStock'] });
type Item = z.output<typeof Item>;

const key = (productId: string, option: string) => `${productId}\u0000${option}`;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** The stock list in the admin's shape (admin/src/data/types.ts StockItem). Purchase prices only for Owners. */
export const stockItems = (sql: Sql | TransactionSql, owner: boolean, where = sql`true`) => sql`
  select s.product_id as "productId", s.option_label as option, s.sku, s.barcode, s.unit, s.brand, s.manufacturer, s.hsn,
    s.gst_rate::float8 as "gstRate", ${owner ? sql`s.purchase_price::float8` : sql`null::float8`} as "purchasePrice",
    s.selling_price::float8 as "sellingPrice", s.wholesale_price::float8 as "wholesalePrice", s.quantity::float8 as quantity,
    s.min_stock::float8 as "minStock", s.max_stock::float8 as "maxStock", s.rack, s.location, s.updated_at as "updatedAt",
    s.held::float8 as held, s.damaged::float8 as damaged, s.defective::float8 as defective,
    -- An option renamed or removed in the product editor leaves its stock behind; the admin shows it to clear up.
    (not exists (select 1 from product_options o where o.product_id = s.product_id and o.label = s.option_label)
      and not (s.option_label = '' and not exists (select 1 from product_options o where o.product_id = s.product_id))) as orphan
  from stock_items s where ${where} order by s.product_id, s.option_label`;

/**
 * For the app, by product and option ('' for a product without options): each counted item that is out (none left) or
 * low (at or below its minimum), the admin's own rules. Only that word goes to phones; counts and prices stay here.
 */
export async function appStock(sql: Sql) {
  const rows = await sql<{ product_id: string; option_label: string; state: 'out' | 'low' }[]>`
    select product_id, option_label, case when quantity <= 0 then 'out' else 'low' end as state
    from stock_items where quantity <= 0 or quantity <= min_stock order by product_id, option_label`;
  const states: Record<string, Record<string, 'out' | 'low'>> = {};
  for (const row of rows) (states[row.product_id] ??= {})[row.option_label] = row.state;
  return states;
}

/** Which stock a change moves: what can be sold, or goods held for inspection, damaged or defective. */
export const BUCKETS = ['available', 'held', 'damaged', 'defective'] as const;
export type Bucket = (typeof BUCKETS)[number];
const COLUMN: Record<Bucket, string> = { available: 'quantity', held: 'held', damaged: 'damaged', defective: 'defective' };

type MoveRecord = { kind: string; reason?: string; note?: string; orderId?: number; purchaseId?: number; returnId?: number; supplierReturnId?: number; bucket?: Bucket; by: string };

/**
 * Changes one item's quantity, in one of its stocks, and records why. The update locks the row, so two changes at once
 * both count. Returns the new balance, or null for an item that isn't counted (nothing to move). Only what can be sold
 * goes below zero; held, damaged and defective stock refuse to (a database check).
 */
export async function move(tx: TransactionSql, item: { productId: string; option: string }, change: number, record: MoveRecord) {
  const bucket = record.bucket ?? 'available';
  const column = tx(COLUMN[bucket]);
  const [row] = await tx`
    update stock_items set ${column} = ${column} + ${change}, updated_at = now()
    where product_id = ${item.productId} and option_label = ${item.option} returning ${column}::float8 as balance`;
  if (!row) return null;
  await tx`insert into stock_moves ${tx({ product_id: item.productId, option_label: item.option, change, balance: row.balance, kind: record.kind, reason: record.reason ?? '', note: record.note ?? '', order_id: record.orderId ?? null, purchase_id: record.purchaseId ?? null, return_id: record.returnId ?? null, supplier_return_id: record.supplierReturnId ?? null, bucket, by: record.by })}`;
  return row.balance as number;
}

/**
 * Orders whose status just changed: a delivered order takes its lines from stock, and one moved away from delivered puts
 * back exactly what it took. Only tracked items move, so an item counted after an order was delivered isn't refilled by it.
 */
export async function moveStockForOrders(tx: TransactionSql, changes: { id: number; was: string; now: string }[], by: string) {
  const delivered = changes.filter((change) => change.now === 'delivered').map((change) => change.id);
  const undone = changes.filter((change) => change.was === 'delivered' && change.now !== 'delivered').map((change) => change.id);
  if (!delivered.length && !undone.length) return;
  const ids = [...delivered, ...undone];
  const [wanted, taken] = await Promise.all([
    delivered.length
      ? tx`
          select l.order_id, l.product_id, coalesce(l.option, '') as option, sum(l.qty)::float8 as qty
          from order_lines l join stock_items s on s.product_id = l.product_id and s.option_label = coalesce(l.option, '')
          where l.order_id in ${tx(delivered)} group by 1, 2, 3`
      : [],
    tx`select order_id, product_id, option_label as option, sum(change)::float8 as net from stock_moves where order_id in ${tx(ids)} group by 1, 2, 3`,
  ]);
  // What each order should have taken from each item now (delivered: its lines; otherwise nothing), less what it has taken.
  const target = new Map<string, { orderId: number; productId: string; option: string; net: number }>();
  const at = (orderId: number, productId: string, option: string) => `${orderId}\u0000${key(productId, option)}`;
  for (const row of wanted) target.set(at(row.order_id, row.product_id, row.option), { orderId: row.order_id, productId: row.product_id, option: row.option, net: -row.qty });
  const steps: { orderId: number; productId: string; option: string; change: number }[] = [];
  const seen = new Set<string>();
  for (const row of taken) {
    const id = at(row.order_id, row.product_id, row.option);
    seen.add(id);
    const change = round3((target.get(id)?.net ?? 0) - row.net);
    if (change) steps.push({ orderId: row.order_id, productId: row.product_id, option: row.option, change });
  }
  for (const [id, want] of target) if (!seen.has(id) && want.net) steps.push({ ...want, change: want.net });
  // Same order every time, so two status changes at once lock rows in turn instead of deadlocking.
  steps.sort((a, b) => key(a.productId, a.option).localeCompare(key(b.productId, b.option)) || a.orderId - b.orderId);
  for (const step of steps) await move(tx, step, step.change, { kind: step.change < 0 ? 'delivered' : 'undelivered', orderId: step.orderId, by });
}

/** /v1/admin/stock. */
export function stockRoutes(sql: Sql) {
  const stock = new Hono<Env>();
  stock.use(only('owner', 'inventory', 'sales'));
  const keepers = only('owner', 'inventory');
  const isOwner = (role: string) => role === 'owner';

  stock.get('/', async (c) => c.json(await stockItems(sql, isOwner(c.get('staff').role))));

  // Starts tracking items, or changes their details: many at once for a CSV import. A quantity given for a new item is
  // its opening stock; for a tracked one it is a count that replaces what's recorded.
  stock.put('/', keepers, jsonBody(z.object({ items: z.array(Item).min(1).max(2000), reason: Text(200).default('') })), async (c) => {
    const { items, reason } = c.req.valid('json');
    const { name: by, role } = c.get('staff');
    if (new Set(items.map((item) => key(item.productId, item.option))).size !== items.length) throw new HTTPException(400, { message: 'An item is listed twice.' });
    const productIds = [...new Set(items.map((item) => item.productId))];
    await sql.begin(async (tx) => {
      const products = await tx`
        select p.id, coalesce(array_agg(o.label) filter (where o.label is not null), '{}') as options
        from products p left join product_options o on o.product_id = p.id where p.id in ${tx(productIds)} group by p.id`;
      const known = new Map(products.map((row) => [row.id as string, row.options as string[]]));
      const existing = await tx`
        select product_id, option_label, quantity::float8 as quantity, purchase_price::float8 as price from stock_items
        where product_id in ${tx(productIds)} order by product_id, option_label for update`;
      const tracked = new Map(existing.map((row) => [key(row.product_id, row.option_label), row.quantity as number]));
      const prices = new Map(existing.map((row) => [key(row.product_id, row.option_label), row.price as number | null]));
      items.forEach((item, index) => {
        const options = known.get(item.productId);
        const isTracked = tracked.has(key(item.productId, item.option));
        // An item left behind by a renamed option can still be edited; a new one must be in the catalogue.
        if (!isTracked && (!options || (options.length ? !options.includes(item.option) : item.option !== '')))
          throw new HTTPException(400, { message: `${item.option ? `“${item.option}”` : 'That item'} isn’t in the catalogue any more.`, cause: { field: `items.${index}.option` } });
      });
      const rows = items.map((item: Item) => ({
        product_id: item.productId,
        option_label: item.option,
        sku: item.sku,
        barcode: item.barcode,
        unit: item.unit,
        brand: item.brand,
        manufacturer: item.manufacturer,
        hsn: item.hsn,
        gst_rate: item.gstRate,
        // Only Owners set it; anyone else's save, or an Owner's without it (a CSV without the column), keeps the one there.
        purchase_price: isOwner(role) && item.purchasePrice !== undefined ? item.purchasePrice : (prices.get(key(item.productId, item.option)) ?? null),
        selling_price: item.sellingPrice,
        wholesale_price: item.wholesalePrice,
        min_stock: item.minStock,
        max_stock: item.maxStock,
        rack: item.rack,
        location: item.location,
      }));
      await tx`
        insert into stock_items ${tx(rows)}
        on conflict (product_id, option_label) do update set sku = excluded.sku, barcode = excluded.barcode, unit = excluded.unit,
          brand = excluded.brand, manufacturer = excluded.manufacturer, hsn = excluded.hsn, gst_rate = excluded.gst_rate,
          purchase_price = excluded.purchase_price,
          selling_price = excluded.selling_price, wholesale_price = excluded.wholesale_price, min_stock = excluded.min_stock,
          max_stock = excluded.max_stock, rack = excluded.rack, location = excluded.location, updated_at = now()`;
      for (const item of items) {
        const was = tracked.get(key(item.productId, item.option));
        if (was === undefined) await move(tx, item, round3(item.quantity ?? 0), { kind: 'opening', reason, by });
        else if (item.quantity !== undefined && round3(item.quantity - was) !== 0) await move(tx, item, round3(item.quantity - was), { kind: 'count', reason, by });
      }
    });
    const keys = sql.json(items.map(({ productId, option }) => ({ productId, option })));
    const saved = sql`exists (select 1 from jsonb_to_recordset(${keys}) as k("productId" text, option text) where k."productId" = s.product_id and k.option = s.option_label)`;
    return c.json({ stock: await stockItems(sql, isOwner(role), saved) });
  });

  // Stock added or taken away by hand (damaged, returned, found…), or a counted quantity.
  const Adjust = z
    .object({
      ...Key,
      change: z.number('Enter the quantity as a number.').min(-MAX_QUANTITY).max(MAX_QUANTITY).optional(),
      count: Quantity('counted quantity').optional(),
      reason: z.enum(ADJUST_REASONS, 'Choose a reason.').optional(),
      note: Text(300).default(''),
    })
    .refine((adjust) => (adjust.change === undefined) !== (adjust.count === undefined), 'Give a change or a count.')
    .refine((adjust) => adjust.change === undefined || round3(adjust.change) !== 0, { message: 'Enter a quantity other than 0.', path: ['change'] })
    .refine((adjust) => adjust.change === undefined || adjust.reason, { message: 'Choose a reason.', path: ['reason'] });
  stock.post('/adjust', keepers, jsonBody(Adjust), async (c) => {
    const adjust = c.req.valid('json');
    const { name: by, role } = c.get('staff');
    await sql.begin(async (tx) => {
      const [row] = await tx`select quantity::float8 as quantity from stock_items where product_id = ${adjust.productId} and option_label = ${adjust.option} for update`;
      if (!row) throw new HTTPException(404, { message: 'That item isn’t tracked yet. Set up its stock first.' });
      const change = adjust.count === undefined ? round3(adjust.change!) : round3(adjust.count - row.quantity);
      if (change) await move(tx, adjust, change, { kind: adjust.count === undefined ? 'adjust' : 'count', reason: adjust.reason ?? '', note: adjust.note, by });
    });
    return c.json({ stock: await stockItems(sql, isOwner(role), sql`s.product_id = ${adjust.productId} and s.option_label = ${adjust.option}`) });
  });

  // One item's history, newest first, or the newest changes to every item.
  stock.get('/moves', async (c) => {
    const productId = c.req.query('productId');
    const option = c.req.query('option') ?? '';
    return c.json(
      await sql`
        select m.id::text as id, m.product_id as "productId", m.option_label as option, m.change::float8 as change, m.balance::float8 as balance,
          m.kind, m.reason, m.note, m.order_id::text as "orderId", o.number as "orderNumber", m.purchase_id::text as "purchaseId", pu.number as "purchaseNumber",
          m.bucket, m.return_id::text as "returnId", r.number as "returnNumber", m.supplier_return_id::text as "supplierReturnId", sr.number as "supplierReturnNumber", m.by, m.at
        from stock_moves m left join orders o on o.id = m.order_id left join purchases pu on pu.id = m.purchase_id
          left join sales_returns r on r.id = m.return_id left join supplier_returns sr on sr.id = m.supplier_return_id
        where ${productId === undefined ? sql`true` : sql`m.product_id = ${productId} and m.option_label = ${option}`}
        order by m.id desc limit 300`,
    );
  });

  // Stops counting an item, for example one left behind by a renamed option. Its history goes with it.
  stock.delete('/item', only('owner'), async (c) => {
    const productId = c.req.query('productId') ?? '';
    const option = c.req.query('option') ?? '';
    const [row] = await sql`delete from stock_items where product_id = ${productId} and option_label = ${option} returning product_id`;
    if (!row) throw new HTTPException(404, { message: 'That item isn’t tracked.' });
    return c.json({ removedStock: [{ productId, option }] });
  });

  return stock;
}
