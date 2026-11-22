import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { r2 } from './gst.ts';
import { returnSettings } from './returns.ts';
import { only, type Env } from './staff.ts';
import { move, stockItems, type Bucket } from './stock.ts';
import { jsonBody, parse } from './validate.ts';

/**
 * Phase 4, supplier returns (docs/ERP-ROADMAP.md): goods sent back against a received purchase bill. Draft → approved →
 * dispatched (the goods leave stock here) → the supplier receives them → their credit note (lowering what the shop owes
 * them, and the input tax credit) → settled against the account or refunded → closed. Owners only, like purchases.
 */

const REASONS = ['wrong_product', 'damaged', 'defective', 'wrong_size', 'excess', 'quality', 'other'] as const;
const METHODS = ['cash', 'upi', 'bank', 'cheque'] as const;
const DAY = 86_400_000;
const MAX_RUPEES = 100_000_000;
const MEDIA = /^\/v1\/media\/[a-f0-9]{24}\.(webp|pdf)$/;
const Id = z.coerce.number().int().positive().max(2147483647);
const Text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const Day = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Pick the ${label}.`)
    .refine((day) => !Number.isNaN(Date.parse(day)) && isoDay(new Date(day)) === day, `Pick the ${label}.`)
    .refine((day) => day >= '2000-01-01', 'Pick a day from 2000 on.')
    .refine((day) => day <= isoDay(new Date(Date.now() + DAY)), 'The day can’t be in the future.');
const Rupees = (label: string) =>
  z
    .number(`Enter the ${label} in rupees.`)
    .min(0, `Enter ₹0 or more for the ${label}.`)
    .max(MAX_RUPEES, `Enter a ${label} of ₹10 crore or less.`)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, `Use rupees and paise for the ${label}.`);
const Version = z.number('Reload the page and try again.').int().positive();
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const round4 = (value: number) => Math.round(value * 10000) / 10000;
const key = (productId: string, option: string) => `${productId}\u0000${option}`;
const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;
const LABEL: Record<string, string> = {
  draft: 'a draft',
  approved: 'approved',
  dispatched: 'dispatched',
  supplier_received: 'received by the supplier',
  credited: 'credited',
  settled: 'settled',
  closed: 'closed',
  cancelled: 'cancelled',
};

const Input = z
  .object({
    purchaseId: Id,
    returnDate: Day('return date'),
    reason: z.enum(REASONS, 'Choose the reason.'),
    reasonNote: Text(500).default(''),
    items: z
      .array(
        z.object({
          purchasePosition: z.number().int().min(0),
          qty: z
            .number('Enter the quantity.')
            .positive('Enter a quantity above 0.')
            .max(10_000_000)
            .refine((qty) => Math.abs(qty * 1000 - Math.round(qty * 1000)) < 1e-6, 'Use up to 3 decimal places.'),
          bucket: z.enum(['available', 'damaged', 'defective']).default('available'),
        }),
      )
      .min(1, 'Choose what goes back.')
      .max(500),
    challan: Text(60).default(''),
    transport: Text(100).default(''),
    attachments: z.array(z.string().regex(MEDIA, 'Upload photos or PDFs.')).max(20).default([]),
    notes: Text(2000).default(''),
  })
  .refine((input) => input.reason !== 'other' || input.reasonNote, { message: 'Say what the reason is.', path: ['reasonNote'] });
type Input = z.output<typeof Input>;

/** Supplier returns in the admin's SupplierReturn shape (admin/src/data/types.ts). */
export const supplierReturns = (sql: Sql | TransactionSql, where = sql`true`) =>
  sql`
    select json_strip_nulls(json_build_object(
      'id', r.id::text, 'number', r.number, 'supplier', json_build_object('id', s.id, 'name', s.name, 'gstin', nullif(s.gstin, '')),
      'purchaseId', r.purchase_id::text, 'purchaseNumber', p.number, 'supplierInvoice', nullif(p.supplier_invoice, ''), 'billDate', p.bill_date,
      'returnDate', r.return_date, 'reason', r.reason, 'reasonNote', nullif(r.reason_note, ''), 'status', r.status,
      'challan', nullif(r.challan, ''), 'transport', nullif(r.transport, ''), 'interstate', r.interstate,
      'taxable', r.taxable::float8, 'tax', r.tax::float8, 'total', r.total::float8,
      'creditNoteNumber', nullif(r.credit_note_number, ''), 'creditNoteDate', r.credit_note_date, 'creditNoteAmount', r.credit_note_amount::float8,
      'creditNoteTax', r.credit_note_tax::float8, 'settlement', r.settlement, 'refundAmount', r.refund_amount::float8, 'refundMethod', r.refund_method,
      'refundReference', nullif(r.refund_reference, ''), 'refundedOn', r.refunded_on, 'attachments', r.attachments, 'notes', nullif(r.notes, ''),
      'version', r.version, 'createdBy', r.created_by, 'createdAt', r.created_at, 'updatedAt', r.updated_at,
      'items', (select json_agg(json_build_object('position', i.position, 'purchasePosition', i.purchase_position, 'productId', i.product_id,
          'option', i.option_label, 'name', i.name, 'code', i.code, 'qty', i.qty::float8, 'unit', i.unit, 'rate', i.rate::float8,
          'gstRate', i.gst_rate::float8, 'taxable', i.taxable::float8, 'tax', i.tax::float8, 'bucket', i.bucket) order by i.position)
        from supplier_return_items i where i.supplier_return_id = r.id),
      'events', (select json_agg(json_build_object('id', e.id::text, 'kind', e.kind, 'from', e.from_status, 'to', e.to_status,
          'note', nullif(e.note, ''), 'by', e.by, 'at', e.at) order by e.id)
        from supplier_return_events e where e.supplier_return_id = r.id)
    )) as "return"
    from supplier_returns r join suppliers s on s.id = r.supplier_id join purchases p on p.id = r.purchase_id
    where ${where}
    order by r.return_date desc, r.id desc`.then((rows) => rows.map((row) => row.return));

/** A received bill's lines with how much can still go back (bought, less other returns not cancelled). */
async function billForReturn(tx: Sql | TransactionSql, purchaseId: number, exclude = 0) {
  const [bill] = await tx`select id, number, status, supplier_id, interstate from purchases where id = ${purchaseId}`;
  if (!bill) throw new HTTPException(404, { message: 'That purchase does not exist.', cause: { field: 'purchaseId' } });
  const lines = await tx<{ position: number; product_id: string; option_label: string; name: string; code: string; qty: number; unit: string; rate: number; discount: number; gst_rate: number; returned: number }[]>`
    select i.position, i.product_id, i.option_label, i.name, i.code, i.qty::float8 as qty, i.unit, i.rate::float8 as rate, i.discount_pct::float8 as discount,
      i.gst_rate::float8 as gst_rate,
      coalesce((select sum(ri.qty) from supplier_return_items ri join supplier_returns r on r.id = ri.supplier_return_id
        where r.purchase_id = ${purchaseId} and r.status <> 'cancelled' and r.id <> ${exclude} and ri.purchase_position = i.position), 0)::float8 as returned
    from purchase_items i where i.purchase_id = ${purchaseId} order by i.position`;
  return { bill, lines: lines.map((line) => ({ ...line, returnable: round3(line.qty - line.returned) })) };
}

async function save(tx: TransactionSql, input: Input, by: string, id?: number) {
  const { bill, lines } = await billForReturn(tx, input.purchaseId, id ?? 0);
  if (bill.status !== 'received') throw new HTTPException(400, { message: `${bill.number} is ${bill.status === 'draft' ? 'a draft' : 'cancelled'}: only goods received can go back.`, cause: { field: 'purchaseId' } });
  const seen = new Set<number>();
  const items = input.items.map((pick, position) => {
    const line = lines.find((one) => one.position === pick.purchasePosition);
    if (!line) throw new HTTPException(400, { message: 'A line isn’t on that bill.', cause: { field: `items.${position}` } });
    if (seen.has(line.position)) throw new HTTPException(400, { message: `${line.name} is listed twice.`, cause: { field: `items.${position}` } });
    seen.add(line.position);
    if (pick.qty > line.returnable + 1e-9)
      throw new HTTPException(400, { message: line.returnable > 0 ? `Only ${line.returnable} ${line.unit} of ${line.name} can go back.` : `${line.name} has already gone back in full.`, cause: { field: `items.${position}.qty` } });
    const rate = round4(line.rate * (1 - line.discount / 100));
    const taxable = r2(rate * pick.qty);
    return {
      position,
      purchase_position: line.position,
      product_id: line.product_id,
      option_label: line.option_label,
      name: line.name,
      code: line.code,
      qty: pick.qty,
      unit: line.unit,
      rate,
      gst_rate: line.gst_rate,
      taxable,
      tax: r2((taxable * line.gst_rate) / 100),
      bucket: pick.bucket,
    };
  });
  const taxable = r2(items.reduce((total, item) => total + item.taxable, 0));
  const tax = r2(items.reduce((total, item) => total + item.tax, 0));
  const row = {
    supplier_id: bill.supplier_id,
    purchase_id: bill.id,
    return_date: input.returnDate,
    reason: input.reason,
    reason_note: input.reasonNote,
    challan: input.challan,
    transport: input.transport,
    interstate: bill.interstate,
    taxable,
    tax,
    total: r2(taxable + tax),
    attachments: input.attachments,
    notes: input.notes,
  };
  if (id === undefined) {
    const settings = await returnSettings(tx);
    const [{ next }] = (await tx`select nextval('supplier_return_numbers')::int as next`) as unknown as [{ next: number }];
    const [saved] = await tx`insert into supplier_returns ${tx({ ...row, number: `${settings.supplierReturnPrefix}-${String(next).padStart(4, '0')}`, created_by: by })} returning id`;
    id = saved!.id as number;
  } else {
    await tx`update supplier_returns set ${tx(row)}, version = version + 1, updated_at = now() where id = ${id}`;
    await tx`delete from supplier_return_items where supplier_return_id = ${id}`;
  }
  await tx`insert into supplier_return_items ${tx(items.map((item) => ({ supplier_return_id: id!, ...item })))}`;
  return id;
}

async function lock(tx: TransactionSql, id: number, version?: number) {
  const [row] = await tx`select id, number, status, version, supplier_id, purchase_id, total::float8 as total, tax::float8 as tax from supplier_returns where id = ${id} for update`;
  if (!row) throw new HTTPException(404, { message: 'That supplier return does not exist.' });
  if (version !== undefined && row.version !== version) throw new HTTPException(409, { message: `${row.number} was just changed. Reload to see what changed, then try again.` });
  return row;
}
const event = (tx: TransactionSql, id: number, kind: string, by: string, details: { from?: string; to?: string; note?: string } = {}) =>
  tx`insert into supplier_return_events ${tx({ supplier_return_id: id, kind, from_status: details.from ?? null, to_status: details.to ?? null, note: details.note ?? '', by })}`;

/** /v1/admin/supplier-returns. */
export function supplierReturnRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner'));

  const answer = async (id: number, moved: { product_id: string; option_label: string }[] = []) => ({
    supplierReturns: await supplierReturns(sql, sql`r.id = ${id}`),
    stock: moved.length
      ? await stockItems(
          sql,
          true,
          sql`exists (select 1 from jsonb_to_recordset(${sql.json(moved.map((row) => ({ productId: row.product_id, option: row.option_label })))}) as k("productId" text, option text) where k."productId" = s.product_id and k.option = s.option_label)`,
        )
      : [],
  });

  routes.get('/', async (c) => c.json(await supplierReturns(sql)));

  // A received bill's lines with what can still go back, for the form.
  routes.get('/bills/:purchaseId', async (c) => {
    const { bill, lines } = await billForReturn(sql, parse(Id, c.req.param('purchaseId')), c.req.query('returnId') ? parse(Id, c.req.query('returnId')) : 0);
    return c.json({
      purchase: { id: String(bill.id), number: bill.number, status: bill.status, interstate: bill.interstate },
      lines: lines.map((line) => ({
        position: line.position,
        productId: line.product_id,
        option: line.option_label,
        name: line.name,
        code: line.code,
        qty: line.qty,
        unit: line.unit,
        rate: round4(line.rate * (1 - line.discount / 100)),
        gstRate: line.gst_rate,
        returned: line.returned,
        returnable: line.returnable,
      })),
    });
  });

  routes.post('/', jsonBody(Input), async (c) => {
    const by = c.get('staff').name;
    const id = await sql.begin(async (tx) => {
      const id = await save(tx, c.req.valid('json'), by);
      await event(tx, id, 'created', by, { to: 'draft' });
      return id;
    });
    return c.json(await answer(id), 201);
  });

  routes.put('/:id', jsonBody(Input.and(z.object({ version: Version }))), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const input = c.req.valid('json');
    const by = c.get('staff').name;
    await sql.begin(async (tx) => {
      const row = await lock(tx, id, input.version);
      if (row.status !== 'draft') throw new HTTPException(409, { message: `${row.number} is ${LABEL[row.status]}, so its goods can’t change.` });
      if (row.purchase_id !== input.purchaseId) throw new HTTPException(400, { message: 'A supplier return stays with its bill.', cause: { field: 'purchaseId' } });
      await save(tx, input, by, id);
      await event(tx, id, 'edited', by);
    });
    return c.json(await answer(id));
  });

  // A draft made by mistake. Anything further along is cancelled instead, so its record stays.
  routes.delete('/:id', async (c) => {
    const id = parse(Id, c.req.param('id'));
    await sql.begin(async (tx) => {
      const row = await lock(tx, id);
      if (row.status !== 'draft') throw new HTTPException(409, { message: `${row.number} isn’t a draft. Cancel it instead.` });
      await tx`delete from supplier_returns where id = ${id}`;
    });
    return c.json({ removedSupplierReturns: [String(id)] });
  });

  // The steps. Dispatching takes the goods out of the stock they were chosen from (never below what's there); cancelling
  // after that puts them back, unless the supplier has already credited it.
  const NEXT: Record<string, string[]> = {
    draft: ['approved', 'cancelled'],
    approved: ['dispatched', 'cancelled'],
    dispatched: ['supplier_received', 'cancelled'],
    supplier_received: ['cancelled'],
    credited: [],
    settled: ['closed'],
  };
  routes.post(
    '/:id/status',
    jsonBody(z.object({ to: z.enum(['approved', 'dispatched', 'supplier_received', 'closed', 'cancelled']), version: Version, note: Text(500).default(''), challan: Text(60).optional(), transport: Text(100).optional() })),
    async (c) => {
      const id = parse(Id, c.req.param('id'));
      const { to, version, note, challan, transport } = c.req.valid('json');
      const by = c.get('staff').name;
      const moved = await sql.begin(async (tx) => {
        const row = await lock(tx, id, version);
        const from = row.status as string;
        if (from === to) throw new HTTPException(409, { message: `${row.number} is already ${LABEL[to]}.` });
        if (!NEXT[from]?.includes(to)) throw new HTTPException(409, { message: `${row.number} is ${LABEL[from]}, so it can’t be ${LABEL[to]} now.` });
        if (to === 'cancelled' && !note) throw new HTTPException(400, { message: 'Say why it’s cancelled.', cause: { field: 'note' } });
        let moved: { product_id: string; option_label: string }[] = [];
        if (to === 'dispatched') {
          if (challan !== undefined || transport !== undefined)
            await tx`update supplier_returns set challan = coalesce(${challan ?? null}, challan), transport = coalesce(${transport ?? null}, transport) where id = ${id}`;
          const items = await tx`
            select product_id, option_label, name, unit, bucket, sum(qty)::float8 as qty from supplier_return_items where supplier_return_id = ${id}
            group by 1, 2, 3, 4, 5 order by 1, 2, 5`;
          const counted = await tx`
            select s.product_id, s.option_label, s.quantity::float8 as available, s.damaged::float8 as damaged, s.defective::float8 as defective from stock_items s
            where exists (select 1 from supplier_return_items i where i.supplier_return_id = ${id} and i.product_id = s.product_id and i.option_label = s.option_label)
            order by 1, 2 for update`;
          const stock = new Map(counted.map((item) => [key(item.product_id, item.option_label), item]));
          for (const item of items) {
            const have = stock.get(key(item.product_id, item.option_label));
            if (have && have[item.bucket] < item.qty)
              throw new HTTPException(409, { message: `Only ${have[item.bucket]} ${item.unit} of ${item.name} in ${item.bucket === 'available' ? 'stock' : `${item.bucket} stock`}.` });
            await move(tx, { productId: item.product_id, option: item.option_label }, -item.qty, { kind: 'supplier_return', bucket: item.bucket as Bucket, supplierReturnId: id, reason: row.number, by });
          }
          moved = items as never;
        }
        if (to === 'cancelled' && from !== 'draft' && from !== 'approved') {
          const net = await tx`
            select product_id, option_label, bucket, sum(change)::float8 as net from stock_moves where supplier_return_id = ${id}
            group by 1, 2, 3 having sum(change) <> 0 order by 1, 2, 3`;
          for (const item of net) await move(tx, { productId: item.product_id, option: item.option_label }, -item.net, { kind: 'supplier_return_reversed', bucket: item.bucket as Bucket, supplierReturnId: id, reason: row.number, by });
          moved = net as never;
        }
        await tx`update supplier_returns set status = ${to}, version = version + 1, updated_at = now() where id = ${id}`;
        await event(tx, id, 'status', by, { from, to, note });
        return moved;
      });
      return c.json(await answer(id, moved));
    },
  );

  // The supplier's credit note: what they credit (with its GST), which lowers what the shop owes them and its input tax.
  routes.post(
    '/:id/credit-note',
    jsonBody(z.object({ version: Version, number: Text(50).min(1, 'Enter the credit note number.'), date: Day('credit note date'), amount: Rupees('amount'), tax: Rupees('GST') })),
    async (c) => {
      const id = parse(Id, c.req.param('id'));
      const input = c.req.valid('json');
      const by = c.get('staff').name;
      await sql.begin(async (tx) => {
        const row = await lock(tx, id, input.version);
        if (!['dispatched', 'supplier_received'].includes(row.status)) throw new HTTPException(409, { message: `${row.number} is ${LABEL[row.status]}; the credit note comes after the goods are sent.` });
        if (input.amount <= 0) throw new HTTPException(400, { message: 'Enter the amount credited.', cause: { field: 'amount' } });
        if (input.tax > input.amount) throw new HTTPException(400, { message: 'The GST can’t be more than the amount.', cause: { field: 'tax' } });
        if (input.amount > row.total + 1) throw new HTTPException(400, { message: `That’s more than the goods sent back (${rupees(row.total)}).`, cause: { field: 'amount' } });
        await tx`
          update supplier_returns set credit_note_number = ${input.number}, credit_note_date = ${input.date}, credit_note_amount = ${input.amount}, credit_note_tax = ${input.tax},
            status = 'credited', version = version + 1, updated_at = now() where id = ${id}`;
        await event(tx, id, 'credit_note', by, { from: row.status, to: 'credited', note: `Credit note ${input.number} for ${rupees(input.amount)} (GST ${rupees(input.tax)})` });
      });
      return c.json(await answer(id));
    },
  );

  // Settled: against what the shop owes the supplier (it already counts, from the credit note), or money back.
  routes.post(
    '/:id/settle',
    jsonBody(
      z
        .object({
          version: Version,
          settlement: z.enum(['adjust', 'refund']),
          amount: Rupees('amount').optional(),
          method: z.enum(METHODS).optional(),
          reference: Text(100).default(''),
          date: Day('day it came in').optional(),
        })
        .refine((input) => input.settlement === 'adjust' || (input.amount && input.method && input.date), { message: 'Enter the refund: amount, how and when.', path: ['amount'] }),
    ),
    async (c) => {
      const id = parse(Id, c.req.param('id'));
      const input = c.req.valid('json');
      const by = c.get('staff').name;
      await sql.begin(async (tx) => {
        const row = await lock(tx, id, input.version);
        if (row.status !== 'credited') throw new HTTPException(409, { message: `${row.number} is ${LABEL[row.status]}; it’s settled once the supplier’s credit note is in.` });
        const [credit] = await tx`select credit_note_amount::float8 as amount from supplier_returns where id = ${id}`;
        if (input.settlement === 'refund' && input.amount! > credit!.amount) throw new HTTPException(400, { message: `That’s more than the credit note (${rupees(credit!.amount)}).`, cause: { field: 'amount' } });
        await tx`
          update supplier_returns set settlement = ${input.settlement}, refund_amount = ${input.settlement === 'refund' ? input.amount! : null},
            refund_method = ${input.settlement === 'refund' ? input.method! : null}, refund_reference = ${input.reference},
            refunded_on = ${input.settlement === 'refund' ? input.date! : null}, status = 'settled', version = version + 1, updated_at = now()
          where id = ${id}`;
        await event(tx, id, 'settled', by, {
          from: 'credited',
          to: 'settled',
          note: input.settlement === 'adjust' ? 'Adjusted against what the shop owes the supplier' : `Refund of ${rupees(input.amount!)} received by ${input.method}`,
        });
      });
      return c.json(await answer(id));
    },
  );

  routes.post('/:id/notes', jsonBody(z.object({ note: Text(1000).min(1, 'Write a note.') })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    await sql.begin(async (tx) => {
      await lock(tx, id);
      await event(tx, id, 'note', c.get('staff').name, { note: c.req.valid('json').note });
      await tx`update supplier_returns set version = version + 1, updated_at = now() where id = ${id}`;
    });
    return c.json(await answer(id));
  });

  return routes;
}
