import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { GST_RATES, UNITS } from './stock.ts';
import { jsonBody, parse } from './validate.ts';

/**
 * Phase 3, GST (docs/ERP-ROADMAP.md): the shop's registration, tax invoices made from orders, input tax credit on
 * purchase bills, and GST paid. Owners only until an Accountant role exists. Figures here are a working aid; the
 * accountant reviews them before filing.
 */

/** States and union territories by GST state code (the first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};
const CODE_OF = new Map(Object.entries(GST_STATES).map(([code, name]) => [name.toLowerCase(), code]));
export const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** A state's GST code, from a GSTIN or a state's name; '' when neither tells. */
export const stateCode = (gstin: string, state = '') => (GSTIN.test(gstin) && GST_STATES[gstin.slice(0, 2)] ? gstin.slice(0, 2) : (CODE_OF.get(state.trim().toLowerCase()) ?? ''));

/** The Indian financial year a day falls in, as GST invoice numbers write it: 2026-11-21 → 26-27. */
export function financialYear(day: string) {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

const r2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Each line's taxable value and tax from what the buyer pays for it, GST included: taxable = amount ÷ (1 + rate).
 * Inside the state the tax is split evenly into CGST and SGST (any odd paisa goes to SGST); between states it is IGST.
 */
export function taxLines<T extends { amount: number; gstRate: number }>(items: T[], interstate: boolean) {
  return items.map((item) => {
    const taxable = r2(item.amount / (1 + item.gstRate / 100));
    const tax = r2(item.amount - taxable);
    const cgst = interstate ? 0 : r2(tax / 2);
    return { ...item, taxable, cgst, sgst: interstate ? 0 : r2(tax - cgst), igst: interstate ? tax : 0 };
  });
}

const sum = (values: number[]) => r2(values.reduce((total, value) => total + value, 0));

export async function gstSettings(sql: Sql | TransactionSql) {
  const [row] = await sql`
    select legal_name as "legalName", trade_name as "tradeName", gstin, address, pincode, registration_type as "registrationType",
      invoice_prefix as "invoicePrefix", terms, updated_by as "updatedBy", updated_at as "updatedAt"
    from gst_settings`;
  return row as { legalName: string; tradeName: string; gstin: string; address: string; pincode: string; registrationType: 'regular' | 'composition'; invoicePrefix: string; terms: string };
}

/** Whether a supplier's bill is inter-state: their state against the shop's. Unknown either way: within the state. */
export async function isInterstate(sql: Sql | TransactionSql, gstin: string, state: string) {
  const own = stateCode((await gstSettings(sql)).gstin);
  const theirs = stateCode(gstin, state);
  return Boolean(own && theirs && own !== theirs);
}

const Text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const Gstin = Text(15)
  .transform((gstin) => gstin.toUpperCase())
  .refine((gstin) => !gstin || GSTIN.test(gstin), 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.');
const Id = z.coerce.number().int().positive().max(2147483647);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date.')
  .refine((day) => !Number.isNaN(Date.parse(day)) && isoDay(new Date(day)) === day, 'Pick the date.')
  .refine((day) => day <= isoDay(new Date(Date.now() + 86_400_000)), 'The date can’t be in the future.');
const Money = (label: string) =>
  z
    .number(`Enter the ${label} in rupees.`)
    .min(0, `Enter ₹0 or more for the ${label}.`)
    .max(1_000_000_000, `Enter ₹100 crore or less for the ${label}.`)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, `Use rupees and paise for the ${label}.`);
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick the month.');

const Settings = z.object({
  legalName: Text(150).min(1, 'Enter the legal name, as on the GST certificate.'),
  tradeName: Text(150).default(''),
  gstin: Gstin.refine(Boolean, 'Enter the shop’s GSTIN.'),
  address: Text(500).min(1, 'Enter the address of the principal place of business.'),
  pincode: Text(6).regex(/^(\d{6})?$/, 'Enter the 6-digit PIN code.').default(''),
  registrationType: z.enum(['regular', 'composition'], 'Choose the registration type.'),
  invoicePrefix: Text(6)
    .transform((prefix) => prefix.toUpperCase())
    .refine((prefix) => /^[A-Z0-9]*$/.test(prefix), 'Use up to 6 letters and numbers, e.g. VSC.'),
  terms: Text(1000).default(''),
});

const InvoiceItem = z.object({
  productId: z.string().min(1).max(200),
  option: z.string().max(200).default(''),
  description: Text(300).min(1, 'Describe every line.'),
  hsn: Text(8).regex(/^(\d{4}|\d{6}|\d{8})?$/, 'Enter the HSN code: 4, 6 or 8 digits.'),
  qty: z.number().positive('Enter a quantity above 0.').max(10_000_000),
  unit: z.enum(UNITS, 'Choose a unit.'),
  amount: Money('line amount'),
  gstRate: z.number().refine((rate) => (GST_RATES as readonly number[]).includes(rate), 'Choose a GST rate.'),
});

const InvoiceDraft = z.object({
  invoiceDate: Day,
  customerName: Text(150).min(1, 'Enter the buyer’s name.'),
  customerGstin: Gstin.default(''),
  billingAddress: Text(500).default(''),
  placeOfSupply: Text(60).default(''),
  items: z.array(InvoiceItem).min(1, 'An invoice needs at least one line.').max(500),
  notes: Text(1000).default(''),
});
type InvoiceDraft = z.output<typeof InvoiceDraft>;

/** Invoices in the admin's shape (admin/src/data/types.ts SalesInvoice). */
export const invoices = (sql: Sql | TransactionSql, where = sql`true`) =>
  sql`
    select json_strip_nulls(json_build_object(
      'id', i.id::text, 'orderId', i.order_id::text, 'orderNumber', o.number, 'number', i.number, 'financialYear', i.financial_year,
      'invoiceDate', i.invoice_date, 'status', i.status, 'customerName', i.customer_name, 'customerGstin', i.customer_gstin,
      'billingAddress', i.billing_address, 'placeOfSupply', i.place_of_supply, 'posCode', i.pos_code, 'interstate', i.interstate,
      'sellerGstin', i.seller_gstin, 'taxable', i.taxable::float8, 'cgst', i.cgst::float8, 'sgst', i.sgst::float8, 'igst', i.igst::float8,
      'roundOff', i.round_off::float8, 'total', i.total::float8, 'notes', nullif(i.notes, ''),
      'createdBy', i.created_by, 'createdAt', i.created_at, 'postedBy', i.posted_by, 'postedAt', i.posted_at,
      'cancelledBy', i.cancelled_by, 'cancelledAt', i.cancelled_at, 'cancelReason', nullif(i.cancel_reason, ''),
      'customerId', (select d.customer_id from app_devices d where d.id = o.device_id),
      'items', (select json_agg(json_build_object('productId', l.product_id, 'option', l.option_label, 'description', l.description, 'hsn', l.hsn,
          'qty', l.qty::float8, 'unit', l.unit, 'amount', l.amount::float8, 'gstRate', l.gst_rate::float8, 'taxable', l.taxable::float8,
          'cgst', l.cgst::float8, 'sgst', l.sgst::float8, 'igst', l.igst::float8) order by l.position)
        from sales_invoice_items l where l.invoice_id = i.id)
    )) as invoice
    from sales_invoices i join orders o on o.id = i.order_id
    where ${where}
    order by i.invoice_date desc, i.id desc`.then((rows) => rows.map((row) => row.invoice));

/** Saves a draft's header, lines and figures, worked out here from the lines. */
async function saveDraft(tx: TransactionSql, id: number, draft: InvoiceDraft) {
  const own = stateCode((await gstSettings(tx)).gstin);
  const pos = stateCode(draft.customerGstin, draft.placeOfSupply);
  const interstate = Boolean(own && pos && own !== pos);
  const lines = taxLines(draft.items, interstate);
  // Rounded to the nearest rupee, as the order's bill is kept in whole rupees.
  const exact = sum(lines.map((line) => line.amount));
  const roundOff = r2(Math.round(exact) - exact);
  const total = r2(exact + roundOff);
  await tx`
    update sales_invoices set ${tx({
      invoice_date: draft.invoiceDate,
      customer_name: draft.customerName,
      customer_gstin: draft.customerGstin,
      billing_address: draft.billingAddress,
      place_of_supply: pos ? GST_STATES[pos]! : draft.placeOfSupply,
      pos_code: pos,
      interstate,
      taxable: sum(lines.map((line) => line.taxable)),
      cgst: sum(lines.map((line) => line.cgst)),
      sgst: sum(lines.map((line) => line.sgst)),
      igst: sum(lines.map((line) => line.igst)),
      round_off: roundOff,
      total,
      notes: draft.notes,
    })} where id = ${id}`;
  await tx`delete from sales_invoice_items where invoice_id = ${id}`;
  await tx`
    insert into sales_invoice_items ${tx(
      lines.map((line, position) => ({
        invoice_id: id,
        position,
        product_id: line.productId,
        option_label: line.option,
        description: line.description,
        hsn: line.hsn,
        qty: line.qty,
        unit: line.unit,
        amount: line.amount,
        gst_rate: line.gstRate,
        taxable: line.taxable,
        cgst: line.cgst,
        sgst: line.sgst,
        igst: line.igst,
      })),
    )}`;
}

/** /v1/admin/gst. */
export function gstRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner'));

  routes.get('/settings', async (c) => c.json(await gstSettings(sql)));
  routes.put('/settings', jsonBody(Settings), async (c) => {
    const input = c.req.valid('json');
    await sql`
      update gst_settings set ${sql({ legal_name: input.legalName, trade_name: input.tradeName, gstin: input.gstin, address: input.address, pincode: input.pincode, registration_type: input.registrationType, invoice_prefix: input.invoicePrefix, terms: input.terms, updated_by: c.get('staff').name })},
        updated_at = now()`;
    return c.json(await gstSettings(sql));
  });

  // shortcut: every invoice at once, which the registers filter themselves; page it on the server past a few thousand.
  // One order's invoices with ?orderId=, for its page.
  routes.get('/invoices', async (c) => {
    const orderId = c.req.query('orderId');
    return c.json(await invoices(sql, orderId ? sql`i.order_id = ${parse(Id, orderId)}` : sql`true`));
  });

  // A draft from an order: the buyer's GST details, and each line at what the buyer pays (the bill shared over the lines),
  // with its HSN and rate from Stock. Lines priced from the catalogue start at ₹0 for staff to fill in.
  routes.post('/invoices', jsonBody(z.object({ orderId: Id })), async (c) => {
    const { orderId } = c.req.valid('json');
    const by = c.get('staff').name;
    const id = await sql.begin(async (tx) => {
      const [order] = await tx`
        select o.id, o.status, o.customer, o.total, coalesce(o.bill_amount, o.total) as bill, cu.name as customer_name, cu.legal_name, cu.gstin, cu.billing_address, cu.state, cu.pincode
        from orders o join app_devices d on d.id = o.device_id left join customers cu on cu.id = coalesce((select merged_into from customers where id = d.customer_id), d.customer_id)
        where o.id = ${orderId} for update of o`;
      if (!order) throw new HTTPException(404, { message: 'That order does not exist.' });
      if (!['confirmed', 'packed', 'dispatched', 'delivered'].includes(order.status)) throw new HTTPException(400, { message: 'Only a confirmed order can be invoiced.' });
      const [existing] = await tx`select number, status from sales_invoices where order_id = ${orderId} and status <> 'cancelled'`;
      if (existing) throw new HTTPException(409, { message: existing.number ? `This order already has invoice ${existing.number}.` : 'This order already has a draft invoice.' });
      const lines = await tx`
        select l.product_id, coalesce(l.option, '') as option, l.name, l.option as option_label, l.qty, l.mrp, s.hsn, s.gst_rate::float8 as gst_rate, coalesce(s.unit, 'pcs') as unit
        from order_lines l left join stock_items s on s.product_id = l.product_id and s.option_label = coalesce(l.option, '')
        where l.order_id = ${orderId} order by l.position`;
      // The bill (the MRP total, or what staff set) is shared over the priced lines in proportion to their MRP.
      const factor = order.total > 0 ? Number(order.bill) / Number(order.total) : 1;
      const buyer = order.legal_name || order.customer_name || order.customer;
      const [row] = await tx`
        insert into sales_invoices ${tx({ order_id: orderId, invoice_date: isoDay(new Date()), customer_name: buyer, customer_gstin: order.gstin ?? '', billing_address: [order.billing_address, order.pincode].filter(Boolean).join(' ') || '', place_of_supply: order.state ?? '', created_by: by })}
        returning id`;
      await saveDraft(tx, row!.id, {
        invoiceDate: isoDay(new Date()),
        customerName: buyer,
        customerGstin: order.gstin ?? '',
        billingAddress: [order.billing_address, order.pincode].filter(Boolean).join(' '),
        placeOfSupply: order.state ?? '',
        notes: '',
        items: lines.map((line) => ({
          productId: line.product_id,
          option: line.option,
          description: line.option_label ? `${line.name} · ${line.option_label}` : line.name,
          hsn: line.hsn ?? '',
          qty: Number(line.qty),
          unit: line.unit,
          amount: line.mrp === null ? 0 : r2(Number(line.mrp) * Number(line.qty) * factor),
          gstRate: line.gst_rate ?? 18,
        })),
      });
      return row!.id as number;
    });
    return c.json({ invoices: await invoices(sql, sql`i.id = ${id}`) }, 201);
  });

  const draftOnly = async (tx: TransactionSql, id: number) => {
    const [row] = await tx`select status, number from sales_invoices where id = ${id} for update`;
    if (!row) throw new HTTPException(404, { message: 'That invoice does not exist.' });
    if (row.status !== 'draft') throw new HTTPException(409, { message: `Invoice ${row.number} is ${row.status}, so it can’t change. Cancel it, or issue a credit note.` });
  };

  routes.put('/invoices/:id', jsonBody(InvoiceDraft), async (c) => {
    const id = parse(Id, c.req.param('id'));
    await sql.begin(async (tx) => {
      await draftOnly(tx, id);
      await saveDraft(tx, id, c.req.valid('json'));
    });
    return c.json({ invoices: await invoices(sql, sql`i.id = ${id}`) });
  });

  routes.delete('/invoices/:id', async (c) => {
    const id = parse(Id, c.req.param('id'));
    await sql.begin(async (tx) => {
      await draftOnly(tx, id);
      await tx`delete from sales_invoices where id = ${id}`;
    });
    return c.json({ removedInvoices: [String(id)] });
  });

  // Posting gives the next number in the financial year's series, fixes the seller's GSTIN, and makes the order's bill
  // the invoice total, so payments follow the invoice.
  routes.post('/invoices/:id/post', async (c) => {
    const id = parse(Id, c.req.param('id'));
    const by = c.get('staff').name;
    await sql.begin(async (tx) => {
      await draftOnly(tx, id);
      const settings = await gstSettings(tx);
      if (!GSTIN.test(settings.gstin) || !settings.legalName) throw new HTTPException(400, { message: 'Fill in the shop’s GSTIN and legal name under GST Settings first.' });
      if (settings.registrationType === 'composition') throw new HTTPException(400, { message: 'A composition dealer issues a bill of supply, not a tax invoice. Change the registration type under GST Settings if that’s wrong.' });
      const [invoice] = await tx`select order_id, invoice_date, total::float8 as total, pos_code from sales_invoices where id = ${id}`;
      const lines = await tx`select description, amount::float8 as amount from sales_invoice_items where invoice_id = ${id}`;
      const unpriced = lines.find((line) => line.amount <= 0);
      if (unpriced) throw new HTTPException(400, { message: `Enter the amount for ${unpriced.description}.` });
      if (!invoice!.pos_code) throw new HTTPException(400, { message: 'Choose the place of supply: the buyer’s state.' });
      const [{ paid }] = (await tx`select coalesce(sum(amount), 0)::float8 as paid from order_payments where order_id = ${invoice!.order_id}`) as unknown as [{ paid: number }];
      if (paid > invoice!.total) throw new HTTPException(400, { message: `₹${paid} has been paid on this order, more than the invoice. Remove a payment or change the invoice.` });
      const year = financialYear(isoDay(new Date(invoice!.invoice_date)));
      const [counter] = await tx`
        insert into invoice_counters (series, financial_year, last_number) values ('invoice', ${year}, 1)
        on conflict (series, financial_year) do update set last_number = invoice_counters.last_number + 1
        returning last_number`;
      const number = `${settings.invoicePrefix ? `${settings.invoicePrefix}/` : ''}${year}/${String(counter!.last_number).padStart(4, '0')}`;
      await tx`update sales_invoices set status = 'posted', number = ${number}, financial_year = ${year}, seller_gstin = ${settings.gstin}, posted_by = ${by}, posted_at = now() where id = ${id}`;
      await tx`update orders set bill_amount = ${Math.round(invoice!.total)} where id = ${invoice!.order_id}`;
    });
    return c.json({ invoices: await invoices(sql, sql`i.id = ${id}`) });
  });

  // A posted invoice is cancelled with a reason and keeps its number, so the series has no gaps.
  routes.post('/invoices/:id/cancel', jsonBody(z.object({ reason: Text(300).min(1, 'Give the reason for cancelling.') })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [row] = await sql`
      update sales_invoices set status = 'cancelled', cancelled_by = ${c.get('staff').name}, cancelled_at = now(), cancel_reason = ${c.req.valid('json').reason}
      where id = ${id} and status = 'posted' returning id`;
    if (!row) throw new HTTPException(409, { message: 'Only a posted invoice can be cancelled; a draft is deleted instead.' });
    return c.json({ invoices: await invoices(sql, sql`i.id = ${id}`) });
  });

  // The accountant's view of a purchase bill's input tax credit. Nothing is claimed by itself.
  routes.patch(
    '/purchases/:id/itc',
    jsonBody(
      z
        .object({ status: z.enum(['pending', 'eligible', 'ineligible', 'claimed', 'reversed'], 'Choose a status.'), period: Period.nullable().default(null), note: Text(300).default('') })
        .refine((change) => !['claimed', 'reversed'].includes(change.status) || change.period, { message: 'Pick the return month it’s claimed or reversed in.', path: ['period'] }),
    ),
    async (c) => {
      const id = parse(Id, c.req.param('id'));
      const change = c.req.valid('json');
      const [row] = await sql`
        update purchases set itc_status = ${change.status}, itc_period = ${change.period}, itc_note = ${change.note}, itc_by = ${c.get('staff').name}, itc_at = now()
        where id = ${id} and status = 'received' returning id`;
      if (!row) throw new HTTPException(409, { message: 'Only a received bill has input tax credit to review.' });
      return c.body(null, 204);
    },
  );

  routes.get('/payments', async (c) =>
    c.json(
      await sql`
        select id::text, period, to_char(paid_on, 'YYYY-MM-DD') as "paidOn", challan, cpin, cin, cgst::float8 as cgst, sgst::float8 as sgst, igst::float8 as igst,
          cess::float8 as cess, interest::float8 as interest, penalty::float8 as penalty, note, attachment, by, created_at as at
        from gst_payments order by paid_on desc, id desc`,
    ),
  );

  routes.post(
    '/payments',
    jsonBody(
      z
        .object({
          period: Period,
          paidOn: Day,
          challan: Text(40).default(''),
          cpin: Text(20).default(''),
          cin: Text(30).default(''),
          cgst: Money('CGST').default(0),
          sgst: Money('SGST').default(0),
          igst: Money('IGST').default(0),
          cess: Money('cess').default(0),
          interest: Money('interest').default(0),
          penalty: Money('penalty').default(0),
          note: Text(300).default(''),
          attachment: z.string().regex(/^\/v1\/media\/[a-f0-9]{24}\.(webp|pdf)$/, 'Upload the challan as a PDF or photo.').nullable().default(null),
        })
        .refine((payment) => payment.cgst + payment.sgst + payment.igst + payment.cess + payment.interest + payment.penalty > 0, { message: 'Enter what was paid under at least one head.', path: ['cgst'] }),
    ),
    async (c) => {
      const payment = c.req.valid('json');
      const { paidOn, ...heads } = payment;
      await sql`insert into gst_payments ${sql({ ...heads, paid_on: paidOn, by: c.get('staff').name })}`;
      return c.body(null, 201);
    },
  );

  routes.delete('/payments/:id', async (c) => {
    const [row] = await sql`delete from gst_payments where id = ${parse(Id, c.req.param('id'))} returning id`;
    if (!row) throw new HTTPException(404, { message: 'That payment has already been removed.' });
    return c.body(null, 204);
  });

  return routes;
}
