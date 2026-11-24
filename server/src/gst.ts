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

/**
 * To the paisa, half away from zero. The nudge catches values like 2,184.345, which binary floating point holds as
 * 2,184.34499…, so they round as the shop's invoices do (2,184.35).
 */
export const r2 = (value: number) => Math.round(value * 100 * (1 + 4 * Number.EPSILON)) / 100;
const sum = (values: number[]) => r2(values.reduce((total, value) => total + value, 0));

type Head = 'cgst' | 'sgst' | 'igst';

/**
 * An invoice the way the shop bills: each line is qty × rate (before GST) less its discount; GST is worked out on each
 * rate's total, CGST and SGST at half the rate each within the state, IGST at the rate between states; then the total is
 * rounded to the rupee. Each rate's tax is shared over its lines by amount (the last line takes the rounding), so the
 * lines add up to the heads exactly, for the registers.
 */
export function computeInvoice<T extends { qty: number; rate: number; discountPct: number; gstRate: number }>(items: T[], interstate: boolean) {
  const lines = items.map((item) => ({ ...item, amount: r2(item.qty * item.rate * (1 - item.discountPct / 100)), cgst: 0, sgst: 0, igst: 0 }));
  const heads: Record<Head, number> = { cgst: 0, sgst: 0, igst: 0 };
  for (const rate of [...new Set(lines.map((line) => line.gstRate))]) {
    const group = lines.filter((line) => line.gstRate === rate);
    const taxable = sum(group.map((line) => line.amount));
    const parts: [Head, number][] = interstate ? [['igst', r2((taxable * rate) / 100)]] : [['cgst', r2((taxable * rate) / 200)], ['sgst', r2((taxable * rate) / 200)]];
    for (const [head, total] of parts) {
      heads[head] = r2(heads[head] + total);
      let left = total;
      group.forEach((line, index) => {
        const share = index === group.length - 1 ? left : r2(taxable ? (total * line.amount) / taxable : 0);
        line[head] = share;
        left = r2(left - share);
      });
    }
  }
  const taxable = sum(lines.map((line) => line.amount));
  const exact = r2(taxable + heads.cgst + heads.sgst + heads.igst);
  const roundOff = r2(Math.round(exact) - exact);
  return { lines: lines.map((line) => ({ ...line, taxable: line.amount })), taxable, ...heads, roundOff, total: r2(exact + roundOff) };
}

export type GstSettings = {
  legalName: string;
  tradeName: string;
  gstin: string;
  address: string;
  pincode: string;
  registrationType: 'regular' | 'composition';
  invoicePrefix: string;
  terms: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccount: string;
  bankBranchIfsc: string;
  declaration: string;
  jurisdiction: string;
};

export async function gstSettings(sql: Sql | TransactionSql) {
  const [row] = await sql`
    select legal_name as "legalName", trade_name as "tradeName", gstin, address, pincode, registration_type as "registrationType",
      invoice_prefix as "invoicePrefix", terms, phone, email, bank_name as "bankName", bank_account as "bankAccount",
      bank_branch_ifsc as "bankBranchIfsc", declaration, jurisdiction, updated_by as "updatedBy", updated_at as "updatedAt"
    from gst_settings`;
  return row as GstSettings & { updatedBy: string | null; updatedAt: string | null };
}

/** The last invoice number used in a financial year's series (0 before the first). */
async function lastNumber(sql: Sql | TransactionSql, year: string) {
  const [row] = await sql`select last_number from invoice_counters where series = 'invoice' and financial_year = ${year}`;
  return (row?.last_number as number | undefined) ?? 0;
}

/** VSC-26-27-412: the prefix, the financial year and the number, as the shop's series runs. */
export const invoiceNumber = (prefix: string, year: string, number: number) => `${prefix ? `${prefix}-` : ''}${year}-${number}`;

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
/** Today in India, where the shop is: the UTC date is still yesterday until 5:30 am there. */
export const indiaDay = () => isoDay(new Date(Date.now() + 330 * 60_000));
/** "5-Nov-26", as the shop's invoices write a date, in India's time. */
const shortDate = (date: Date) => date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: '2-digit' }).replace(/ /g, '-');
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
  phone: Text(60).default(''),
  email: Text(120).default(''),
  bankName: Text(100).default(''),
  bankAccount: Text(40).default(''),
  bankBranchIfsc: Text(120).default(''),
  declaration: Text(500).default(''),
  jurisdiction: Text(100).default(''),
  /** The last number already used this financial year (in Tally, say), so the admin carries on after it. */
  lastInvoiceNumber: z.number().int('Enter a whole number.').min(0, 'Enter 0 or more.').max(9_999_999).optional(),
});

const InvoiceItem = z.object({
  productId: z.string().min(1).max(200),
  option: z.string().max(200).default(''),
  description: Text(300).min(1, 'Describe every line.'),
  detail: Text(200).default(''),
  hsn: Text(8).regex(/^(\d{4}|\d{6}|\d{8})?$/, 'Enter the HSN code: 4, 6 or 8 digits.'),
  qty: z.number().positive('Enter a quantity above 0.').max(10_000_000),
  unit: z.enum(UNITS, 'Choose a unit.'),
  rate: Money('rate'),
  discountPct: z.number('Enter the discount as a number.').min(0, 'Enter 0% or more.').max(100, 'Enter 100% or less.').default(0),
  gstRate: z.number().refine((rate) => (GST_RATES as readonly number[]).includes(rate), 'Choose a GST rate.'),
});

const field = (max: number) => Text(max).optional();
/** What the invoice prints besides the buyer's GST details: contacts, ship-to, and the delivery and order references. */
const Details = z.object({
  buyerContact: field(100),
  buyerPhone: field(40),
  buyerEmail: field(120),
  shipName: field(150),
  shipAddress: field(500),
  shipGstin: Gstin.optional(),
  shipState: field(60),
  shipContact: field(100),
  shipPhone: field(40),
  shipEmail: field(120),
  deliveryNote: field(60),
  paymentTerms: field(100),
  reference: field(100),
  otherReferences: field(150),
  buyerOrderNo: field(60),
  buyerOrderDate: field(30),
  dispatchDocNo: field(60),
  deliveryNoteDate: field(30),
  dispatchedThrough: field(100),
  destination: field(100),
  deliveryTerms: field(300),
});

const InvoiceDraft = z.object({
  invoiceDate: Day,
  customerName: Text(150).min(1, 'Enter the buyer’s name.'),
  customerGstin: Gstin.default(''),
  billingAddress: Text(500).default(''),
  placeOfSupply: Text(60).default(''),
  items: z.array(InvoiceItem).min(1, 'An invoice needs at least one line.').max(500),
  notes: Text(1000).default(''),
  /** Left out: the saved details stay. */
  details: Details.optional(),
});
export type InvoiceDraft = z.output<typeof InvoiceDraft>;

/** Invoices in the admin's shape (admin/src/data/types.ts SalesInvoice). */
export const invoices = (sql: Sql | TransactionSql, where = sql`true`) =>
  sql`
    select json_strip_nulls(json_build_object(
      'id', i.id::text, 'orderId', i.order_id::text, 'orderNumber', o.number, 'number', i.number, 'financialYear', i.financial_year,
      'invoiceDate', i.invoice_date, 'status', i.status, 'customerName', i.customer_name, 'customerGstin', i.customer_gstin,
      'billingAddress', i.billing_address, 'placeOfSupply', i.place_of_supply, 'posCode', i.pos_code, 'interstate', i.interstate,
      'sellerGstin', i.seller_gstin, 'taxable', i.taxable::float8, 'cgst', i.cgst::float8, 'sgst', i.sgst::float8, 'igst', i.igst::float8,
      'roundOff', i.round_off::float8, 'total', i.total::float8, 'notes', nullif(i.notes, ''), 'details', i.details,
      'previousBalance', i.previous_balance::float8,
      'returnId', i.return_id::text, 'returnNumber', (select r.number from sales_returns r where r.id = i.return_id),
      'createdBy', i.created_by, 'createdAt', i.created_at, 'postedBy', i.posted_by, 'postedAt', i.posted_at,
      'cancelledBy', i.cancelled_by, 'cancelledAt', i.cancelled_at, 'cancelReason', nullif(i.cancel_reason, ''),
      'customerId', (select d.customer_id from app_devices d where d.id = o.device_id),
      'items', (select json_agg(json_build_object('productId', l.product_id, 'option', l.option_label, 'description', l.description,
          'detail', l.detail, 'hsn', l.hsn, 'qty', l.qty::float8, 'unit', l.unit, 'rate', l.rate::float8, 'discountPct', l.discount_pct::float8,
          'amount', l.amount::float8, 'gstRate', l.gst_rate::float8, 'taxable', l.taxable::float8,
          'cgst', l.cgst::float8, 'sgst', l.sgst::float8, 'igst', l.igst::float8) order by l.position)
        from sales_invoice_items l where l.invoice_id = i.id)
    )) as invoice
    from sales_invoices i join orders o on o.id = i.order_id
    where ${where}
    order by i.invoice_date desc, i.id desc`.then((rows) => rows.map((row) => row.invoice));

/** Saves a draft's header, lines and figures, worked out here from the lines. */
export async function saveDraft(tx: TransactionSql, id: number, draft: InvoiceDraft) {
  const own = stateCode((await gstSettings(tx)).gstin);
  const pos = stateCode(draft.customerGstin, draft.placeOfSupply);
  const interstate = Boolean(own && pos && own !== pos);
  const figures = computeInvoice(draft.items, interstate);
  await tx`
    update sales_invoices set ${tx({
      invoice_date: draft.invoiceDate,
      customer_name: draft.customerName,
      customer_gstin: draft.customerGstin,
      billing_address: draft.billingAddress,
      place_of_supply: pos ? GST_STATES[pos]! : draft.placeOfSupply,
      pos_code: pos,
      interstate,
      taxable: figures.taxable,
      cgst: figures.cgst,
      sgst: figures.sgst,
      igst: figures.igst,
      round_off: figures.roundOff,
      total: figures.total,
      notes: draft.notes,
    })}${draft.details ? tx`, details = ${tx.json(draft.details)}` : tx``} where id = ${id}`;
  await tx`delete from sales_invoice_items where invoice_id = ${id}`;
  await tx`
    insert into sales_invoice_items ${tx(
      figures.lines.map((line, position) => ({
        invoice_id: id,
        position,
        product_id: line.productId,
        option_label: line.option,
        description: line.description,
        detail: line.detail,
        hsn: line.hsn,
        qty: line.qty,
        unit: line.unit,
        rate: line.rate,
        discount_pct: line.discountPct,
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
  routes.use(only('owner', 'accountant'));

  const settingsWithNumber = async () => {
    const year = financialYear(indiaDay());
    return { ...(await gstSettings(sql)), financialYear: year, lastInvoiceNumber: await lastNumber(sql, year) };
  };
  routes.get('/settings', async (c) => c.json(await settingsWithNumber()));
  routes.put('/settings', only('owner'), jsonBody(Settings), async (c) => {
    const input = c.req.valid('json');
    const year = financialYear(indiaDay());
    await sql.begin(async (tx) => {
      await tx`
        update gst_settings set ${tx({ legal_name: input.legalName, trade_name: input.tradeName, gstin: input.gstin, address: input.address, pincode: input.pincode, registration_type: input.registrationType, invoice_prefix: input.invoicePrefix, terms: input.terms, phone: input.phone, email: input.email, bank_name: input.bankName, bank_account: input.bankAccount, bank_branch_ifsc: input.bankBranchIfsc, declaration: input.declaration, jurisdiction: input.jurisdiction, updated_by: c.get('staff').name })},
          updated_at = now()`;
      if (input.lastInvoiceNumber === undefined) return;
      // Carrying on after the last number used elsewhere; never back below a number this admin has already issued.
      const [counter] = await tx`select last_number from invoice_counters where series = 'invoice' and financial_year = ${year} for update`;
      const [issued] = await tx`select count(*)::int as count from sales_invoices where financial_year = ${year} and number is not null`;
      if (issued!.count > 0 && input.lastInvoiceNumber < (counter?.last_number ?? 0))
        throw new HTTPException(400, { message: `Invoice numbers up to ${counter!.last_number} are already used this year.`, cause: { field: 'lastInvoiceNumber' } });
      await tx`
        insert into invoice_counters (series, financial_year, last_number) values ('invoice', ${year}, ${input.lastInvoiceNumber})
        on conflict (series, financial_year) do update set last_number = excluded.last_number`;
    });
    return c.json(await settingsWithNumber());
  });

  // shortcut: every invoice at once, which the registers filter themselves; page it on the server past a few thousand.
  // One order's invoices with ?orderId=, for its page.
  routes.get('/invoices', async (c) => {
    const orderId = c.req.query('orderId');
    return c.json(await invoices(sql, orderId ? sql`i.order_id = ${parse(Id, orderId)}` : sql`true`));
  });

  // A draft from an order: the buyer's GST details and contact, and each line at its MRP (or Stock's selling price) as
  // the rate before GST, with HSN and GST rate from Stock. Staff set the discounts and check it before posting.
  routes.post('/invoices', jsonBody(z.object({ orderId: Id })), async (c) => {
    const { orderId } = c.req.valid('json');
    const by = c.get('staff').name;
    const id = await sql.begin(async (tx) => {
      const [order] = await tx`
        select o.id, o.number, o.status, o.customer, o.phone as order_phone, o.placed_at, o.payment_terms,
          cu.name as customer_name, cu.legal_name, cu.gstin, cu.billing_address, cu.state, cu.pincode,
          d.name as person, d.phone, d.email, d.city
        from orders o join app_devices d on d.id = o.device_id left join customers cu on cu.id = coalesce((select merged_into from customers where id = d.customer_id), d.customer_id)
        where o.id = ${orderId} for update of o`;
      if (!order) throw new HTTPException(404, { message: 'That order does not exist.' });
      if (!['confirmed', 'packed', 'dispatched', 'delivered'].includes(order.status)) throw new HTTPException(400, { message: 'Only a confirmed order can be invoiced.' });
      const [existing] = await tx`select number, status from sales_invoices where order_id = ${orderId} and status <> 'cancelled' and return_id is null`;
      if (existing) throw new HTTPException(409, { message: existing.number ? `This order already has invoice ${existing.number}.` : 'This order already has a draft invoice.' });
      const lines = await tx`
        select l.product_id, coalesce(l.option, '') as option, l.code, l.option_code, l.name, l.option as option_label, l.qty, l.mrp,
          s.hsn, s.gst_rate::float8 as gst_rate, s.selling_price::float8 as selling_price, coalesce(s.unit, 'pcs') as unit
        from order_lines l left join stock_items s on s.product_id = l.product_id and s.option_label = coalesce(l.option, '')
        where l.order_id = ${orderId} order by l.position`;
      const buyer = order.legal_name || order.customer_name || order.customer;
      const address = [order.billing_address, order.pincode].filter(Boolean).join(' ');
      const today = indiaDay();
      const [row] = await tx`insert into sales_invoices ${tx({ order_id: orderId, invoice_date: today, customer_name: buyer, created_by: by })} returning id`;
      await saveDraft(tx, row!.id, {
        invoiceDate: today,
        customerName: buyer,
        customerGstin: order.gstin ?? '',
        billingAddress: address,
        placeOfSupply: order.state ?? '',
        notes: '',
        details: {
          buyerContact: order.person ?? '',
          buyerPhone: order.phone || order.order_phone || '',
          buyerEmail: order.email ?? '',
          shipName: buyer,
          shipAddress: address,
          shipGstin: order.gstin ?? '',
          shipState: order.state ?? '',
          shipContact: order.person ?? '',
          shipPhone: order.phone || order.order_phone || '',
          shipEmail: order.email ?? '',
          reference: `${order.number} dt. ${shortDate(new Date(order.placed_at))}`,
          paymentTerms: order.payment_terms === 'cash' ? 'Cash' : 'Credit',
          destination: order.city ?? '',
        },
        items: lines.map((line) => ({
          productId: line.product_id,
          option: line.option,
          // As the shop's invoices read: the item's code, its name in the smaller line under it.
          description: line.option_code || line.code,
          detail: line.option_label ? `${line.name} · ${line.option_label}` : line.name,
          hsn: line.hsn ?? '',
          qty: Number(line.qty),
          unit: line.unit,
          rate: line.mrp !== null ? Number(line.mrp) : (line.selling_price ?? 0),
          discountPct: 0,
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

  // Posting gives the next number in the financial year's series, fixes the seller's GSTIN and the buyer's balance before
  // it, and makes the order's bill the invoice total, so payments follow the invoice.
  routes.post('/invoices/:id/post', async (c) => {
    const id = parse(Id, c.req.param('id'));
    const by = c.get('staff').name;
    await sql.begin(async (tx) => {
      await draftOnly(tx, id);
      const settings = await gstSettings(tx);
      if (!GSTIN.test(settings.gstin) || !settings.legalName) throw new HTTPException(400, { message: 'Fill in the shop’s GSTIN and legal name under GST Settings first.' });
      if (settings.registrationType === 'composition') throw new HTTPException(400, { message: 'A composition dealer issues a bill of supply, not a tax invoice. Change the registration type under GST Settings if that’s wrong.' });
      const [invoice] = await tx`select order_id, invoice_date, total::float8 as total, pos_code, return_id from sales_invoices where id = ${id}`;
      const lines = await tx`select description, amount::float8 as amount from sales_invoice_items where invoice_id = ${id}`;
      const unpriced = lines.find((line) => line.amount <= 0);
      if (unpriced) throw new HTTPException(400, { message: `Enter the rate for ${unpriced.description}.` });
      if (!invoice!.pos_code) throw new HTTPException(400, { message: 'Choose the place of supply: the buyer’s state.' });
      // A replacement's invoice is settled through its return, not the order's payments.
      const replacement = invoice!.return_id !== null;
      const [{ paid }] = (await tx`select coalesce(sum(amount), 0)::float8 as paid from order_payments where order_id = ${invoice!.order_id}`) as unknown as [{ paid: number }];
      if (!replacement && paid > invoice!.total) throw new HTTPException(400, { message: `₹${paid} has been paid on this order, more than the invoice. Remove a payment or change the invoice.` });
      // What the buyer owed on their other orders just before this invoice, as the invoice prints it.
      const [{ owed }] = (await tx`
        select coalesce(sum(greatest(0, coalesce(o.bill_amount, o.total) - coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0))), 0)::float8 as owed
        from orders o join app_devices d on d.id = o.device_id
        where coalesce((select merged_into from customers where id = d.customer_id), d.customer_id) =
            (select coalesce((select merged_into from customers where id = d2.customer_id), d2.customer_id) from orders o2 join app_devices d2 on d2.id = o2.device_id where o2.id = ${invoice!.order_id})
          and o.id <> ${invoice!.order_id} and o.status in ('placed', 'confirmed', 'packed', 'dispatched', 'delivered')`) as unknown as [{ owed: number }];
      const year = financialYear(isoDay(new Date(invoice!.invoice_date)));
      const [counter] = await tx`
        insert into invoice_counters (series, financial_year, last_number) values ('invoice', ${year}, 1)
        on conflict (series, financial_year) do update set last_number = invoice_counters.last_number + 1
        returning last_number`;
      const number = invoiceNumber(settings.invoicePrefix, year, counter!.last_number as number);
      await tx`
        update sales_invoices set status = 'posted', number = ${number}, financial_year = ${year}, seller_gstin = ${settings.gstin},
          previous_balance = ${r2(owed)}, posted_by = ${by}, posted_at = now()
        where id = ${id}`;
      if (!replacement) await tx`update orders set bill_amount = ${Math.round(invoice!.total)} where id = ${invoice!.order_id}`;
    });
    return c.json({ invoices: await invoices(sql, sql`i.id = ${id}`) });
  });

  // A posted invoice is cancelled with a reason and keeps its number, so the series has no gaps.
  routes.post('/invoices/:id/cancel', jsonBody(z.object({ reason: Text(300).min(1, 'Give the reason for cancelling.') })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [note] = await sql`select number from sales_credit_notes where invoice_id = ${id} and status = 'posted' limit 1`;
    if (note) throw new HTTPException(409, { message: `Credit note ${note.number} is issued against this invoice. Cancel the credit note first.` });
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
