import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { isInterstate } from './gst.ts';
import { GST_RATES, UNITS, move, stockItems } from './stock.ts';
import { jsonBody, parse } from './validate.ts';

/**
 * Phase 2, purchases (docs/ERP-ROADMAP.md): suppliers, their bills, receiving the goods into stock, and paying them.
 * Owners only until roles get permissions. Totals are worked out here, never taken from the admin.
 */

const DAY = 86_400_000;
const MAX_RUPEES = 100_000_000;
const METHODS = ['cash', 'upi', 'bank', 'cheque'] as const;
/** 2 digits for the state, the PAN, an entity number, Z, and a check character. */
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const MEDIA = /^\/v1\/media\/[a-f0-9]{24}\.(webp|pdf)$/;

const Id = z.coerce.number().int().positive().max(2147483647);
const Text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const paise = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
const Rupees = (label: string) =>
  z
    .number(`Enter the ${label} in rupees.`)
    .min(0, `Enter ₹0 or more for the ${label}.`)
    .max(MAX_RUPEES, `Enter a ${label} of ₹10 crore or less.`)
    .refine(paise, `Use rupees and paise, e.g. 125.50, for the ${label}.`);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const Day = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Pick the ${label}.`)
    .refine((day) => !Number.isNaN(Date.parse(day)) && isoDay(new Date(day)) === day, `Pick the ${label}.`)
    .refine((day) => day >= '2000-01-01', 'Pick a day from 2000 on.')
    // Not after tomorrow in UTC: in India it is already tomorrow for the first 5½ hours of the UTC day.
    .refine((day) => day <= isoDay(new Date(Date.now() + DAY)), 'The day can’t be in the future.');
const r2 = (value: number) => Math.round(value * 100) / 100;
const key = (productId: string, option: string) => `${productId}\u0000${option}`;
const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;
const UNIT_LABEL: Record<string, string> = { pcs: 'PCS', box: 'BOX', packet: 'PACKET', set: 'SET', feet: 'FEET', rft: 'RFT', meter: 'METER', sqft: 'SQ FT', sqm: 'SQ M', kg: 'KG', sheet: 'SHEET', length: 'LENGTH' };

const Supplier = z.object({
  name: Text(100).min(1, 'Enter the supplier’s name.'),
  company: Text(150).default(''),
  contactPerson: Text(100).default(''),
  phone: Text(30)
    .default('')
    .refine((phone) => !phone || phone.replace(/\D/g, '').length >= 10, 'Enter a 10-digit number, with the area code for landlines.'),
  email: Text(120)
    .default('')
    .refine((email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter an email address like sales@supplier.com.'),
  gstin: Text(15)
    .default('')
    .transform((gstin) => gstin.toUpperCase())
    .refine((gstin) => !gstin || GSTIN.test(gstin), 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.'),
  address: Text(500).default(''),
  state: Text(50).default(''),
  openingBalance: Rupees('opening balance').default(0),
  paymentDays: z.number().int('Enter whole days.').min(0, 'Enter 0 or more days.').max(365, 'Use 365 days or fewer.').nullable().default(null),
  bankDetails: Text(500).default(''),
  notes: Text(2000).default(''),
  archived: z.boolean().default(false),
});

const Item = z.object({
  productId: z.string().min(1).max(200),
  option: z.string().max(200),
  qty: z
    .number('Enter the quantity.')
    .positive('Enter a quantity above 0.')
    .max(10_000_000, 'Enter 1 crore or less.')
    .refine((qty) => Math.abs(qty * 1000 - Math.round(qty * 1000)) < 1e-6, 'Use up to 3 decimal places.'),
  unit: z.enum(UNITS, 'Choose a unit.'),
  rate: Rupees('rate'),
  discountPct: z.number('Enter the discount as a number.').min(0, 'Enter 0% or more.').max(100, 'Enter 100% or less.').refine(paise, 'Use up to 2 decimal places.').default(0),
  gstRate: z.number().refine((rate) => (GST_RATES as readonly number[]).includes(rate), 'Choose a GST rate: 0, 0.25, 3, 5, 12, 18, 28 or 40%.'),
});

const PurchaseInput = z.object({
  supplierId: Id,
  supplierInvoice: Text(50).default(''),
  billDate: Day('bill date'),
  items: z.array(Item).min(1, 'Add at least one item.').max(500),
  freight: Rupees('freight').default(0),
  otherCharges: Rupees('other charges').default(0),
  discount: Rupees('discount').default(0),
  roundOff: z.number('Enter the round-off in rupees.').min(-100, 'Round off by ₹100 or less.').max(100, 'Round off by ₹100 or less.').refine(paise, 'Use rupees and paise.').default(0),
  notes: Text(2000).default(''),
  attachment: z.string().regex(MEDIA, 'Upload the bill as a PDF or photo.').nullable().default(null),
});
type PurchaseInput = z.output<typeof PurchaseInput>;

const Payment = z.object({
  purchaseId: Id.nullable().default(null),
  amount: Rupees('amount').refine((amount) => amount > 0, 'Enter an amount above ₹0.'),
  method: z.enum(METHODS, 'Choose how it was paid.'),
  paidOn: Day('day it was paid'),
  note: Text(300).default(''),
});

/** A bill's figures from its items and charges: each line's amount after its discount, GST on that, then the charges. */
export function purchaseTotals(input: Pick<PurchaseInput, 'items' | 'freight' | 'otherCharges' | 'discount' | 'roundOff'>) {
  let subtotal = 0;
  let tax = 0;
  for (const item of input.items) {
    const amount = r2(item.qty * item.rate * (1 - item.discountPct / 100));
    subtotal += amount;
    tax += r2((amount * item.gstRate) / 100);
  }
  subtotal = r2(subtotal);
  tax = r2(tax);
  return { subtotal, tax, total: r2(subtotal + tax + input.freight + input.otherCharges - input.discount + input.roundOff) };
}

/** Bills in the admin's Purchase shape (admin/src/data/types.ts). */
const purchases = (sql: Sql | TransactionSql, where = sql`true`) =>
  sql`
    select json_strip_nulls(json_build_object(
      'id', p.id::text, 'number', p.number, 'supplier', json_build_object('id', s.id, 'name', s.name),
      'supplierInvoice', nullif(p.supplier_invoice, ''), 'billDate', p.bill_date, 'status', p.status,
      'freight', p.freight::float8, 'otherCharges', p.other_charges::float8, 'discount', p.discount::float8, 'roundOff', p.round_off::float8,
      'subtotal', p.subtotal::float8, 'tax', p.tax::float8, 'total', p.total::float8,
      'notes', nullif(p.notes, ''), 'attachment', p.attachment,
      'createdBy', p.created_by, 'createdAt', p.created_at, 'receivedBy', p.received_by, 'receivedAt', p.received_at,
      'cancelledBy', p.cancelled_by, 'cancelledAt', p.cancelled_at, 'supplierGstin', nullif(s.gstin, ''), 'interstate', p.interstate,
      'itcStatus', p.itc_status, 'itcPeriod', p.itc_period, 'itcNote', nullif(p.itc_note, ''), 'itcBy', p.itc_by, 'itcAt', p.itc_at,
      'items', (select json_agg(json_build_object('productId', i.product_id, 'option', i.option_label, 'name', i.name, 'code', i.code,
          'qty', i.qty::float8, 'unit', i.unit, 'rate', i.rate::float8, 'discountPct', i.discount_pct::float8, 'gstRate', i.gst_rate::float8) order by i.position)
        from purchase_items i where i.purchase_id = p.id),
      'payments', (select json_agg(json_build_object('id', sp.id::text, 'amount', sp.amount::float8, 'method', sp.method, 'paidOn', sp.paid_on,
          'note', nullif(sp.note, ''), 'by', sp.by, 'at', sp.created_at) order by sp.paid_on, sp.id)
        from supplier_payments sp where sp.purchase_id = p.id)
    )) as purchase
    from purchases p join suppliers s on s.id = p.supplier_id
    where ${where}
    order by p.bill_date desc, p.id desc`.then((rows) => rows.map((row) => row.purchase));

/** Suppliers with what the shop bought from them (received bills), paid them, and still owes them. */
const suppliers = (sql: Sql | TransactionSql, where = sql`true`) => sql`
  select s.id, s.name, s.company, s.contact_person as "contactPerson", s.phone, s.email, s.gstin, s.address, s.state,
    s.opening_balance::float8 as "openingBalance", s.payment_days as "paymentDays", s.bank_details as "bankDetails", s.notes,
    s.archived, s.created_at as "createdAt",
    coalesce(b.bills, 0)::int as bills, coalesce(b.billed, 0)::float8 as billed, coalesce(pay.paid, 0)::float8 as paid,
    (s.opening_balance + coalesce(b.billed, 0) - coalesce(pay.paid, 0))::float8 as outstanding,
    to_char(b.last, 'YYYY-MM-DD') as "lastPurchase", coalesce(d.drafts, 0)::int as drafts
  from suppliers s
  left join lateral (select count(*) as bills, sum(total) as billed, max(bill_date) as last from purchases where supplier_id = s.id and status = 'received') b on true
  left join lateral (select sum(amount) as paid from supplier_payments where supplier_id = s.id) pay on true
  left join lateral (select count(*) as drafts from purchases where supplier_id = s.id and status = 'draft') d on true
  where ${where}
  order by s.archived, s.name`;

/**
 * Checks a bill's items against the catalogue and the stock: each must still be a product option (or a product without
 * options), and a counted item must be bought in the unit it's counted in. Returns the copies to store.
 */
async function checkItems(tx: TransactionSql, items: PurchaseInput['items']) {
  const ids = [...new Set(items.map((item) => item.productId))];
  const products = await tx`
    select p.id, p.code, coalesce(nullif(p.name, ''), p.section) as name,
      coalesce((select json_agg(json_build_object('label', o.label, 'code', o.code)) from product_options o where o.product_id = p.id), '[]') as options
    from products p where p.id in ${tx(ids)}`;
  const byId = new Map(products.map((product) => [product.id as string, product]));
  const counted = await tx`select product_id, option_label, unit from stock_items where product_id in ${tx(ids)}`;
  const units = new Map(counted.map((row) => [key(row.product_id, row.option_label), row.unit as string]));
  return items.map((item, position) => {
    const product = byId.get(item.productId);
    const options = (product?.options ?? []) as { label: string; code: string | null }[];
    const option = options.find((one) => one.label === item.option);
    if (!product || (options.length ? !option : item.option !== ''))
      throw new HTTPException(400, { message: 'An item on this bill isn’t in the catalogue any more. Remove it and add it again.', cause: { field: `items.${position}.productId` } });
    const counting = units.get(key(item.productId, item.option));
    if (counting && counting !== item.unit)
      throw new HTTPException(400, { message: `${product.name}${item.option ? ` · ${item.option}` : ''} is counted in ${UNIT_LABEL[counting]}. Enter its quantity in ${UNIT_LABEL[counting]}.`, cause: { field: `items.${position}.unit` } });
    return {
      position,
      product_id: item.productId,
      option_label: item.option,
      name: `${product.name}${item.option ? ` · ${item.option}` : ''}`,
      code: option?.code ?? (product.code as string),
      qty: item.qty,
      unit: item.unit,
      rate: item.rate,
      discount_pct: item.discountPct,
      gst_rate: item.gstRate,
    };
  });
}

/** Saves a bill's header, figures and items; a new one gets the next PUR number. */
async function saveBill(tx: TransactionSql, input: PurchaseInput, by: string, id?: number) {
  const [supplier] = await tx`select archived, gstin, state from suppliers where id = ${input.supplierId}`;
  if (!supplier) throw new HTTPException(400, { message: 'Choose a supplier.', cause: { field: 'supplierId' } });
  const items = await checkItems(tx, input.items);
  const totals = purchaseTotals(input);
  if (totals.total < 0) throw new HTTPException(400, { message: 'The discount is more than the bill.', cause: { field: 'discount' } });
  const row = {
    supplier_id: input.supplierId,
    supplier_invoice: input.supplierInvoice,
    bill_date: input.billDate,
    freight: input.freight,
    other_charges: input.otherCharges,
    discount: input.discount,
    round_off: input.roundOff,
    ...totals,
    notes: input.notes,
    attachment: input.attachment,
    // IGST or CGST + SGST, fixed now: a supplier's later move doesn't rewrite the bill.
    interstate: await isInterstate(tx, supplier.gstin, supplier.state),
  };
  const duplicate = (number?: string) =>
    new HTTPException(409, { message: `Bill ${input.supplierInvoice} from this supplier is already entered${number ? ` as ${number}` : ''}.`, cause: { field: 'supplierInvoice' } });
  if (input.supplierInvoice) {
    const [other] = await tx`
      select number from purchases where supplier_id = ${input.supplierId} and upper(supplier_invoice) = upper(${input.supplierInvoice})
        and status <> 'cancelled' and id <> ${id ?? 0} limit 1`;
    if (other) throw duplicate(other.number);
  }
  // In a savepoint, so the same bill saved twice at the same moment is refused cleanly rather than failing the transaction.
  id = await tx
    .savepoint(async (point) => {
      if (id !== undefined) {
        await point`update purchases set ${point({ ...row })}, updated_at = now() where id = ${id}`;
        await point`delete from purchase_items where purchase_id = ${id}`;
        return id;
      }
      const [{ next }] = (await point`select nextval('purchase_numbers')::int as next`) as unknown as [{ next: number }];
      const [saved] = await point`insert into purchases ${point({ ...row, number: `PUR-${String(next).padStart(4, '0')}`, created_by: by })} returning id`;
      return saved!.id as number;
    })
    .catch((error: { constraint_name?: string }) => {
      if (error.constraint_name === 'purchases_supplier_invoice') throw duplicate();
      throw error;
    });
  await tx`insert into purchase_items ${tx(items.map((item) => ({ purchase_id: id!, ...item })))}`;
  return id;
}

/**
 * The goods on a draft bill arrive: each item's stock goes up, once, and its purchase price becomes the bill's rate after
 * the line discount. An item not counted yet starts being counted here, in the bill's unit.
 */
async function receive(tx: TransactionSql, id: number, by: string) {
  const [bill] = await tx`select number, status from purchases where id = ${id} for update`;
  if (!bill) throw new HTTPException(404, { message: 'That purchase does not exist.' });
  if (bill.status !== 'draft') throw new HTTPException(409, { message: bill.status === 'received' ? `The goods on ${bill.number} are already in stock.` : `${bill.number} is cancelled.` });
  const lines = await tx`
    select product_id, option_label, qty::float8 as qty, unit, rate::float8 as rate, discount_pct::float8 as discount, gst_rate::float8 as gst
    from purchase_items where purchase_id = ${id} order by position`;
  // Checked again: the catalogue or the stock unit may have changed since the draft was saved.
  await checkItems(tx, lines.map((line) => ({ productId: line.product_id, option: line.option_label, qty: line.qty, unit: line.unit, rate: line.rate, discountPct: line.discount, gstRate: line.gst })));
  const items = new Map<string, { productId: string; option: string; qty: number; unit: string; price: number; gst: number }>();
  for (const line of lines) {
    const id = key(line.product_id, line.option_label);
    const price = r2(line.rate * (1 - line.discount / 100));
    const current = items.get(id);
    items.set(id, { productId: line.product_id, option: line.option_label, qty: (current?.qty ?? 0) + line.qty, unit: line.unit, price, gst: line.gst });
  }
  // Same order every time, so two bills received at once lock rows in turn instead of deadlocking.
  for (const item of [...items.values()].sort((a, b) => key(a.productId, a.option).localeCompare(key(b.productId, b.option)))) {
    await tx`
      insert into stock_items (product_id, option_label, unit, purchase_price, gst_rate) values (${item.productId}, ${item.option}, ${item.unit}, ${item.price}, ${item.gst})
      on conflict (product_id, option_label) do update set purchase_price = excluded.purchase_price, gst_rate = coalesce(stock_items.gst_rate, excluded.gst_rate), updated_at = now()`;
    await move(tx, item, Math.round(item.qty * 1000) / 1000, { kind: 'purchase', purchaseId: id, reason: bill.number, by });
  }
  await tx`update purchases set status = 'received', received_by = ${by}, received_at = now(), updated_at = now() where id = ${id}`;
  return [...items.values()];
}

const itemsWhere = (sql: Sql, items: { productId: string; option: string }[]) =>
  sql`exists (select 1 from jsonb_to_recordset(${sql.json(items.map(({ productId, option }) => ({ productId, option })))}) as k("productId" text, option text)
    where k."productId" = s.product_id and k.option = s.option_label)`;

/** /v1/admin/purchases. */
export function purchaseRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner'));

  // shortcut: every bill at once, which the admin searches and filters itself; page it on the server past a few thousand.
  routes.get('/', async (c) => c.json(await purchases(sql)));

  routes.get('/:id', async (c) => {
    const [bill] = await purchases(sql, sql`p.id = ${parse(Id, c.req.param('id'))}`);
    if (!bill) throw new HTTPException(404, { message: 'That purchase does not exist.' });
    return c.json(bill);
  });

  // A new bill, as a draft; with `receive` its goods go into stock straight away.
  routes.post('/', jsonBody(PurchaseInput.extend({ receive: z.boolean().default(false) })), async (c) => {
    const input = c.req.valid('json');
    const by = c.get('staff').name;
    const { id, moved } = await sql.begin(async (tx) => {
      const id = await saveBill(tx, input, by);
      return { id, moved: input.receive ? await receive(tx, id, by) : [] };
    });
    return c.json({ purchases: await purchases(sql, sql`p.id = ${id}`), stock: moved.length ? await stockItems(sql, true, itemsWhere(sql, moved)) : [] }, 201);
  });

  // Only a draft can change; a received bill is cancelled instead, so stock and money keep their record.
  routes.put('/:id', jsonBody(PurchaseInput.extend({ receive: z.boolean().default(false) })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const input = c.req.valid('json');
    const by = c.get('staff').name;
    const moved = await sql.begin(async (tx) => {
      const [bill] = await tx`select number, status from purchases where id = ${id} for update`;
      if (!bill) throw new HTTPException(404, { message: 'That purchase does not exist.' });
      if (bill.status !== 'draft') throw new HTTPException(409, { message: `${bill.number} is ${bill.status}, so it can’t be changed.` });
      await saveBill(tx, input, by, id);
      return input.receive ? await receive(tx, id, by) : [];
    });
    return c.json({ purchases: await purchases(sql, sql`p.id = ${id}`), stock: moved.length ? await stockItems(sql, true, itemsWhere(sql, moved)) : [] });
  });

  routes.post('/:id/receive', async (c) => {
    const id = parse(Id, c.req.param('id'));
    const moved = await sql.begin((tx) => receive(tx, id, c.get('staff').name));
    return c.json({ purchases: await purchases(sql, sql`p.id = ${id}`), stock: await stockItems(sql, true, itemsWhere(sql, moved)) });
  });

  // A draft entered by mistake. Bills with goods received or money paid are cancelled instead.
  routes.delete('/:id', async (c) => {
    const id = parse(Id, c.req.param('id'));
    await sql.begin(async (tx) => {
      const [bill] = await tx`select number, status, (select count(*)::int from supplier_payments where purchase_id = ${id}) as payments from purchases where id = ${id} for update`;
      if (!bill) throw new HTTPException(404, { message: 'That purchase does not exist.' });
      if (bill.status !== 'draft') throw new HTTPException(409, { message: `${bill.number} isn’t a draft. Cancel it instead.` });
      if (bill.payments) throw new HTTPException(409, { message: `${bill.number} has payments. Remove them first, or cancel the bill.` });
      await tx`delete from purchases where id = ${id}`;
    });
    return c.json({ removedPurchases: [String(id)] });
  });

  // Cancelling a received bill takes back out exactly the stock it brought in. The bill and its payments stay on record.
  routes.post('/:id/cancel', async (c) => {
    const id = parse(Id, c.req.param('id'));
    const by = c.get('staff').name;
    const moved = await sql.begin(async (tx) => {
      const [bill] = await tx`select number, status from purchases where id = ${id} for update`;
      if (!bill) throw new HTTPException(404, { message: 'That purchase does not exist.' });
      if (bill.status === 'cancelled') throw new HTTPException(409, { message: `${bill.number} is already cancelled.` });
      const added = await tx`
        select product_id, option_label, sum(change)::float8 as net from stock_moves where purchase_id = ${id}
        group by 1, 2 having sum(change) <> 0 order by 1, 2`;
      for (const row of added) await move(tx, { productId: row.product_id, option: row.option_label }, -row.net, { kind: 'purchase_cancelled', purchaseId: id, reason: bill.number, by });
      await tx`update purchases set status = 'cancelled', cancelled_by = ${by}, cancelled_at = now(), updated_at = now() where id = ${id}`;
      return added.map((row) => ({ productId: row.product_id as string, option: row.option_label as string }));
    });
    return c.json({ purchases: await purchases(sql, sql`p.id = ${id}`), stock: moved.length ? await stockItems(sql, true, itemsWhere(sql, moved)) : [] });
  });

  return routes;
}

/** /v1/admin/suppliers. */
export function supplierRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner'));

  routes.get('/', async (c) => c.json(await suppliers(sql)));

  const unique = async (work: () => Promise<number>) =>
    work().catch((error: { constraint_name?: string }) => {
      if (error.constraint_name === 'suppliers_gstin') throw new HTTPException(409, { message: 'Another supplier has this GSTIN.', cause: { field: 'gstin' } });
      throw error;
    });

  routes.post('/', jsonBody(Supplier), async (c) => {
    const input = c.req.valid('json');
    const id = await unique(async () => {
      const [row] = await sql`
        insert into suppliers ${sql({ name: input.name, company: input.company, contact_person: input.contactPerson, phone: input.phone, email: input.email, gstin: input.gstin, address: input.address, state: input.state, opening_balance: input.openingBalance, payment_days: input.paymentDays, bank_details: input.bankDetails, notes: input.notes, archived: input.archived })}
        returning id`;
      return row!.id as number;
    });
    return c.json((await suppliers(sql, sql`s.id = ${id}`))[0], 201);
  });

  routes.put('/:id', jsonBody(Supplier), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const input = c.req.valid('json');
    await unique(async () => {
      const [row] = await sql`
        update suppliers set ${sql({ name: input.name, company: input.company, contact_person: input.contactPerson, phone: input.phone, email: input.email, gstin: input.gstin, address: input.address, state: input.state, opening_balance: input.openingBalance, payment_days: input.paymentDays, bank_details: input.bankDetails, notes: input.notes, archived: input.archived })}
        where id = ${id} returning id`;
      if (!row) throw new HTTPException(404, { message: 'That supplier does not exist.' });
      return id;
    });
    return c.json((await suppliers(sql, sql`s.id = ${id}`))[0]);
  });

  // Only a supplier with no bills or payments; the others are archived, so their records stay.
  routes.delete('/:id', async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [used] = await sql`select (select count(*) from purchases where supplier_id = ${id}) + (select count(*) from supplier_payments where supplier_id = ${id}) as uses`;
    if (Number(used!.uses) > 0) throw new HTTPException(409, { message: 'This supplier has bills or payments. Archive it instead.' });
    const [row] = await sql`delete from suppliers where id = ${id} returning id`;
    if (!row) throw new HTTPException(404, { message: 'That supplier does not exist.' });
    return c.body(null, 204);
  });

  // Every payment to a supplier, newest first, with the bill it paid.
  routes.get('/:id/payments', async (c) => {
    const id = parse(Id, c.req.param('id'));
    return c.json(
      await sql`
        select sp.id::text as id, sp.amount::float8 as amount, sp.method, to_char(sp.paid_on, 'YYYY-MM-DD') as "paidOn", sp.note, sp.by, sp.created_at as at,
          sp.purchase_id::text as "purchaseId", p.number as "purchaseNumber"
        from supplier_payments sp left join purchases p on p.id = sp.purchase_id
        where sp.supplier_id = ${id} order by sp.paid_on desc, sp.id desc`,
    );
  });

  // Money paid to a supplier: against one of their bills (never more than it still owes), or on account.
  routes.post('/:id/payments', jsonBody(Payment), async (c) => {
    const supplierId = parse(Id, c.req.param('id'));
    const payment = c.req.valid('json');
    const by = c.get('staff').name;
    await sql.begin(async (tx) => {
      const [supplier] = await tx`select id from suppliers where id = ${supplierId} for update`;
      if (!supplier) throw new HTTPException(404, { message: 'That supplier does not exist.' });
      if (payment.purchaseId !== null) {
        const [bill] = await tx`
          select number, status, total::float8 as total, (select coalesce(sum(amount), 0)::float8 from supplier_payments where purchase_id = p.id) as paid
          from purchases p where id = ${payment.purchaseId} and supplier_id = ${supplierId} for update`;
        if (!bill) throw new HTTPException(400, { message: 'That bill isn’t from this supplier.', cause: { field: 'purchaseId' } });
        if (bill.status === 'cancelled') throw new HTTPException(400, { message: `${bill.number} is cancelled, so it takes no payments.`, cause: { field: 'purchaseId' } });
        if (r2(bill.paid + payment.amount) > bill.total) throw new HTTPException(400, { message: `That is more than ${bill.number} still owes (${rupees(r2(bill.total - bill.paid))}).`, cause: { field: 'amount' } });
      }
      await tx`insert into supplier_payments ${tx({ supplier_id: supplierId, purchase_id: payment.purchaseId, amount: payment.amount, method: payment.method, paid_on: payment.paidOn, note: payment.note, by })}`;
    });
    return c.json({ supplier: (await suppliers(sql, sql`s.id = ${supplierId}`))[0], purchases: payment.purchaseId === null ? [] : await purchases(sql, sql`p.id = ${payment.purchaseId}`) }, 201);
  });

  routes.delete('/:id/payments/:paymentId', async (c) => {
    const supplierId = parse(Id, c.req.param('id'));
    const paymentId = parse(Id, c.req.param('paymentId'));
    const [row] = await sql`delete from supplier_payments where id = ${paymentId} and supplier_id = ${supplierId} returning purchase_id`;
    if (!row) throw new HTTPException(404, { message: 'That payment has already been removed.' });
    return c.json({ supplier: (await suppliers(sql, sql`s.id = ${supplierId}`))[0], purchases: row.purchase_id ? await purchases(sql, sql`p.id = ${row.purchase_id}`) : [] });
  });

  return routes;
}
