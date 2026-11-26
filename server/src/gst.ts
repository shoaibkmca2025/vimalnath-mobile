import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { GST_RATES, move } from './stock.ts';
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
export type Priced = { qty: number; rate: number; discountPct: number; gstRate: number; discountAmount?: number; lineType?: 'goods' | 'charge' };
export type PriceOptions = {
  /** Rates typed with GST in them: each line's value before GST is its amount ÷ (1 + rate). */
  inclusive?: boolean;
  /** A discount on the whole bill, before GST, shared over the goods lines by value. */
  billDiscount?: number;
};

/**
 * Counter bills add to that: a fixed discount on a line after its %, rates typed GST included, a discount on the whole
 * bill (before GST, shared over the goods lines; the last line takes what rounding leaves), and charges such as transport,
 * taxed like a line but never discounted. Without options it is exactly the invoice above.
 */
export function computeInvoice<T extends Priced>(items: T[], interstate: boolean, options: PriceOptions = {}) {
  const lines = items.map((item) => {
    const gross = Math.max(0, r2(r2(item.qty * item.rate * (1 - item.discountPct / 100)) - (item.discountAmount ?? 0)));
    const amount = options.inclusive ? r2(gross / (1 + item.gstRate / 100)) : gross;
    return { ...item, amount, billDiscount: 0, taxable: amount, cgst: 0, sgst: 0, igst: 0 };
  });
  const goods = lines.filter((line) => line.lineType !== 'charge');
  const base = sum(goods.map((line) => line.amount));
  const billDiscount = Math.min(r2(options.billDiscount ?? 0), base);
  let unshared = billDiscount;
  goods.forEach((line, index) => {
    const share = index === goods.length - 1 ? unshared : r2(base ? (billDiscount * line.amount) / base : 0);
    line.billDiscount = share;
    line.taxable = r2(line.amount - share);
    unshared = r2(unshared - share);
  });
  const heads: Record<Head, number> = { cgst: 0, sgst: 0, igst: 0 };
  for (const rate of [...new Set(lines.map((line) => line.gstRate))]) {
    const group = lines.filter((line) => line.gstRate === rate);
    const taxable = sum(group.map((line) => line.taxable));
    const parts: [Head, number][] = interstate ? [['igst', r2((taxable * rate) / 100)]] : [['cgst', r2((taxable * rate) / 200)], ['sgst', r2((taxable * rate) / 200)]];
    for (const [head, total] of parts) {
      heads[head] = r2(heads[head] + total);
      let left = total;
      group.forEach((line, index) => {
        const share = index === group.length - 1 ? left : r2(taxable ? (total * line.taxable) / taxable : 0);
        line[head] = share;
        left = r2(left - share);
      });
    }
  }
  const taxable = sum(lines.map((line) => line.taxable));
  const exact = r2(taxable + heads.cgst + heads.sgst + heads.igst);
  const roundOff = r2(Math.round(exact) - exact);
  return { lines, taxable, billDiscount, ...heads, roundOff, total: r2(exact + roundOff) };
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
  /** Empty for an item typed in by hand, not from the catalogue (never taken from stock). */
  productId: z.string().max(200).default(''),
  option: z.string().max(200).default(''),
  description: Text(300).min(1, 'Describe every line.'),
  detail: Text(200).default(''),
  sku: Text(60).default(''),
  hsn: Text(8).regex(/^(\d{4}|\d{6}|\d{8})?$/, 'Enter the HSN code: 4, 6 or 8 digits.'),
  qty: z.number().positive('Enter a quantity above 0.').max(10_000_000),
  /** A unit from measurement_units: the stock units, PAIR, and the shop's own. */
  unit: Text(20).min(1, 'Choose a unit.'),
  rate: Money('rate'),
  discountPct: z.number('Enter the discount as a number.').min(0, 'Enter 0% or more.').max(100, 'Enter 100% or less.').default(0),
  discountAmount: Money('discount').default(0),
  lineType: z.enum(['goods', 'charge']).default('goods'),
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
  // Counter bills (billing.ts). Each left out keeps what's saved, so an order invoice's editor never touches them.
  customerId: Id.nullable().optional(),
  customerPhone: Text(40).optional(),
  // A due date is usually ahead, so not capped at today.
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the due date.').refine((day) => !Number.isNaN(Date.parse(day)) && isoDay(new Date(day)) === day, 'Pick the due date.').nullable().optional(),
  pricesIncludeGst: z.boolean().optional(),
  billDiscount: Money('bill discount').optional(),
  billDiscountPct: z.number().min(0, 'Enter 0% or more.').max(100, 'Enter 100% or less.').nullable().optional(),
  allowNegativeStock: z.boolean().optional(),
});
export type InvoiceDraft = z.output<typeof InvoiceDraft>;
export const InvoiceDraftSchema = InvoiceDraft;

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
      'source', case when i.return_id is not null then 'replacement' when i.order_id is not null then 'order' else 'counter' end,
      'customerPhone', nullif(i.customer_phone, ''), 'dueDate', i.due_date, 'pricesIncludeGst', i.prices_include_gst,
      'billDiscount', i.bill_discount::float8, 'billDiscountPct', i.bill_discount_pct::float8, 'allowNegativeStock', i.allow_negative_stock,
      'quotationId', i.quotation_id::text, 'quotationNumber', (select q.number from quotations q where q.id = i.quotation_id),
      'duplicateOf', i.duplicate_of::text, 'version', i.version,
      'reopenedBy', i.reopened_by, 'reopenedAt', i.reopened_at, 'reopenReason', nullif(i.reopen_reason, ''),
      -- What's been paid: through the order for an order's invoice, on the bill itself for a counter bill.
      'paid', case when i.return_id is not null then null
        when i.order_id is not null then (select coalesce(sum(p.amount), 0) from order_payments p where p.order_id = i.order_id)::float8
        else (select coalesce(sum(p.amount), 0) from invoice_payments p where p.invoice_id = i.id and p.voided_at is null)::float8 end,
      'returnId', i.return_id::text, 'returnNumber', (select r.number from sales_returns r where r.id = i.return_id),
      'createdBy', i.created_by, 'createdAt', i.created_at, 'postedBy', i.posted_by, 'postedAt', i.posted_at,
      'cancelledBy', i.cancelled_by, 'cancelledAt', i.cancelled_at, 'cancelReason', nullif(i.cancel_reason, ''),
      'customerId', coalesce(i.customer_id, (select d.customer_id from app_devices d where d.id = o.device_id)),
      'items', (select json_agg(json_build_object('productId', l.product_id, 'option', l.option_label, 'description', l.description,
          'detail', l.detail, 'sku', l.sku, 'hsn', l.hsn, 'qty', l.qty::float8, 'unit', l.unit, 'rate', l.rate::float8, 'discountPct', l.discount_pct::float8,
          'discountAmount', l.discount_amount::float8, 'lineType', l.line_type, 'billDiscount', l.bill_discount::float8,
          'amount', l.amount::float8, 'gstRate', l.gst_rate::float8, 'taxable', l.taxable::float8,
          'cgst', l.cgst::float8, 'sgst', l.sgst::float8, 'igst', l.igst::float8) order by l.position)
        from sales_invoice_items l where l.invoice_id = i.id)
    )) as invoice
    from sales_invoices i left join orders o on o.id = i.order_id
    where ${where}
    order by i.invoice_date desc, i.id desc`.then((rows) => rows.map((row) => row.invoice));

/** A draft as callers give it: optional fields left out take their defaults. */
export type InvoiceDraftInput = z.input<typeof InvoiceDraft>;

/**
 * Saves a draft's header, lines and figures, worked out here from the lines. Every unit must be one the shop bills in,
 * and an item counted in stock is billed in its stock unit. A composition dealer's bills carry no GST (bills of supply).
 */
export async function saveDraft(tx: TransactionSql, id: number, input: InvoiceDraftInput) {
  const draft = parse(InvoiceDraft, input);
  const settings = await gstSettings(tx);
  const own = stateCode(settings.gstin);
  const pos = stateCode(draft.customerGstin, draft.placeOfSupply);
  const interstate = Boolean(own && pos && own !== pos);
  const composition = settings.registrationType === 'composition';
  const units = await tx`select code, label from measurement_units`;
  const unitLabel = new Map(units.map((row) => [row.code as string, row.label as string]));
  draft.items.forEach((item, index) => {
    if (!unitLabel.has(item.unit)) throw new HTTPException(400, { message: `“${item.unit}” isn’t one of the shop’s units. Add it under Invoice Settings.`, cause: { field: `items.${index}.unit` } });
  });
  const ids = [...new Set(draft.items.filter((item) => item.productId && item.lineType === 'goods').map((item) => item.productId))];
  if (ids.length) {
    const counted = await tx`select product_id, option_label, unit from stock_items where product_id in ${tx(ids)}`;
    const stockUnit = new Map(counted.map((row) => [`${row.product_id}\u0000${row.option_label}`, row.unit as string]));
    draft.items.forEach((item, index) => {
      const unit = item.lineType === 'goods' && item.productId ? stockUnit.get(`${item.productId}\u0000${item.option}`) : undefined;
      if (unit && unit !== item.unit)
        throw new HTTPException(400, { message: `${item.description} is counted in ${unitLabel.get(unit) ?? unit}: bill it in ${unitLabel.get(unit) ?? unit}.`, cause: { field: `items.${index}.unit` } });
    });
  }
  const [saved] = await tx`select prices_include_gst, bill_discount::float8 as bill_discount from sales_invoices where id = ${id}`;
  const inclusive = draft.pricesIncludeGst ?? Boolean(saved?.prices_include_gst);
  const billDiscount = draft.billDiscount ?? Number(saved?.bill_discount ?? 0);
  const figures = computeInvoice(composition ? draft.items.map((item) => ({ ...item, gstRate: 0 })) : draft.items, interstate, { inclusive, billDiscount });
  if (billDiscount > figures.billDiscount + 0.001) throw new HTTPException(400, { message: `The bill discount is more than the goods (₹${figures.billDiscount + 0}).`, cause: { field: 'billDiscount' } });
  const counter = {
    ...(draft.customerId !== undefined ? { customer_id: draft.customerId } : {}),
    ...(draft.customerPhone !== undefined ? { customer_phone: draft.customerPhone } : {}),
    ...(draft.dueDate !== undefined ? { due_date: draft.dueDate } : {}),
    ...(draft.pricesIncludeGst !== undefined ? { prices_include_gst: draft.pricesIncludeGst } : {}),
    ...(draft.billDiscount !== undefined ? { bill_discount: figures.billDiscount } : {}),
    ...(draft.billDiscountPct !== undefined ? { bill_discount_pct: draft.billDiscountPct } : {}),
    ...(draft.allowNegativeStock !== undefined ? { allow_negative_stock: draft.allowNegativeStock } : {}),
  };
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
      ...counter,
    })}${draft.details ? tx`, details = ${tx.json(draft.details)}` : tx``}, version = version + 1 where id = ${id}`;
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
        sku: line.sku,
        hsn: line.hsn,
        qty: line.qty,
        unit: line.unit,
        rate: line.rate,
        discount_pct: line.discountPct,
        discount_amount: line.discountAmount,
        line_type: line.lineType,
        amount: line.amount,
        bill_discount: line.billDiscount,
        gst_rate: line.gstRate,
        taxable: line.taxable,
        cgst: line.cgst,
        sgst: line.sgst,
        igst: line.igst,
      })),
    )}`;
}

/**
 * A counter bill's stock: each goods line from the catalogue that is counted takes its quantity from stock, once. It works
 * out what the bill should have taken now (nothing once it's cancelled) less what it has taken, and moves only the
 * difference, so finalizing it again after a correction never takes stock twice. Below zero only if `allowNegative`.
 */
export async function syncBillStock(tx: TransactionSql, id: number, by: string, options: { cancelled?: boolean; allowNegative?: boolean; reason: string }) {
  const wanted = options.cancelled
    ? []
    : await tx`
        select l.product_id, l.option_label, sum(l.qty)::float8 as qty from sales_invoice_items l
        join stock_items s on s.product_id = l.product_id and s.option_label = l.option_label
        where l.invoice_id = ${id} and l.line_type = 'goods' and l.product_id <> '' group by 1, 2`;
  const taken = await tx`select product_id, option_label, sum(change)::float8 as net from stock_moves where invoice_id = ${id} and bucket = 'available' group by 1, 2`;
  const key = (productId: string, option: string) => `${productId}\u0000${option}`;
  const steps = new Map<string, { productId: string; option: string; change: number }>();
  for (const row of wanted) steps.set(key(row.product_id, row.option_label), { productId: row.product_id, option: row.option_label, change: -row.qty });
  for (const row of taken) {
    const step = steps.get(key(row.product_id, row.option_label)) ?? { productId: row.product_id, option: row.option_label, change: 0 };
    step.change = Math.round((step.change - row.net) * 1000) / 1000;
    steps.set(key(row.product_id, row.option_label), step);
  }
  const moves = [...steps.values()].filter((step) => step.change !== 0).sort((a, b) => key(a.productId, a.option).localeCompare(key(b.productId, b.option)));
  if (!moves.length) return [];
  // The counted items locked first, in the same order everywhere, so two bills at once can't both take the last one.
  const counted = await tx`
    select s.product_id, s.option_label, s.quantity::float8 as quantity, s.unit, coalesce(nullif(p.name, ''), p.section, s.product_id) as name
    from stock_items s left join products p on p.id = s.product_id
    where exists (select 1 from jsonb_to_recordset(${tx.json(moves.map((step) => ({ p: step.productId, o: step.option })))}) as k(p text, o text) where k.p = s.product_id and k.o = s.option_label)
    order by s.product_id, s.option_label for update of s`;
  const have = new Map(counted.map((row) => [key(row.product_id, row.option_label), row]));
  for (const step of moves) {
    const row = have.get(key(step.productId, step.option));
    if (step.change < 0 && row && row.quantity + step.change < 0 && !options.allowNegative)
      throw new HTTPException(409, {
        message: `Only ${Math.max(0, row.quantity)} ${row.unit} of ${row.name}${step.option ? ` · ${step.option}` : ''} in stock. Restock it, or allow negative stock for this bill.`,
      });
    await move(tx, { productId: step.productId, option: step.option }, step.change, { kind: step.change < 0 ? 'billed' : 'bill_reversed', invoiceId: id, reason: options.reason, by });
  }
  return moves;
}

/** What a customer still owes: their orders' bills and their counter bills, less what's paid on each. */
export async function customerBalance(tx: Sql | TransactionSql, customerId: number, exceptInvoice = 0) {
  const [row] = await tx`
    with who as (select coalesce((select merged_into from customers where id = ${customerId}), ${customerId}) as id)
    select (
      coalesce((select sum(greatest(0, coalesce(o.bill_amount, o.total) - coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0)))
        from orders o join app_devices d on d.id = o.device_id
        where coalesce((select merged_into from customers where id = d.customer_id), d.customer_id) = (select id from who)
          and o.status in ('placed', 'confirmed', 'packed', 'dispatched', 'delivered')), 0)
      + coalesce((select sum(greatest(0, i.total - coalesce((select sum(p.amount) from invoice_payments p where p.invoice_id = i.id and p.voided_at is null), 0)))
        from sales_invoices i
        where i.order_id is null and i.return_id is null and i.status = 'posted' and i.id <> ${exceptInvoice}
          and coalesce((select merged_into from customers where id = i.customer_id), i.customer_id) = (select id from who)), 0)
    )::float8 as owed`;
  return r2(row!.owed as number);
}

/**
 * Posting: the next number in the financial year's series (a bill reopened to correct keeps the number it had), the
 * seller's GSTIN and the buyer's balance before it. An order's invoice becomes the order's bill, so payments follow it; a
 * counter bill takes its goods from stock.
 */
export async function postInvoice(tx: TransactionSql, id: number, by: string) {
  const [invoice] = await tx`
    select status, number, financial_year, order_id, return_id, customer_id, invoice_date, total::float8 as total, pos_code, allow_negative_stock
    from sales_invoices where id = ${id} for update`;
  if (!invoice) throw new HTTPException(404, { message: 'That invoice does not exist.' });
  if (invoice.status !== 'draft') throw new HTTPException(409, { message: `Invoice ${invoice.number} is ${invoice.status}, so it can’t be posted again.` });
  const settings = await gstSettings(tx);
  const [billing] = await tx`select allow_negative_stock from gst_settings`;
  if (!GSTIN.test(settings.gstin) || !settings.legalName) throw new HTTPException(400, { message: 'Fill in the shop’s GSTIN and legal name under GST Settings first.' });
  const lines = await tx`select description, amount::float8 as amount, gst_rate::float8 as gst_rate, line_type from sales_invoice_items where invoice_id = ${id}`;
  if (!lines.length) throw new HTTPException(400, { message: 'An invoice needs at least one line.' });
  const unpriced = lines.find((line) => line.line_type === 'goods' && line.amount <= 0);
  if (unpriced) throw new HTTPException(400, { message: `Enter the rate for ${unpriced.description}.` });
  if (settings.registrationType === 'composition' && lines.some((line) => line.gst_rate > 0))
    throw new HTTPException(400, { message: 'A composition dealer charges no GST: save the bill again to make it a bill of supply.' });
  if (!invoice.pos_code) throw new HTTPException(400, { message: 'Choose the place of supply: the buyer’s state.' });
  const counter = invoice.order_id === null && invoice.return_id === null;
  let owed: number | null = null;
  if (counter) {
    const [{ paid }] = (await tx`select coalesce(sum(amount), 0)::float8 as paid from invoice_payments where invoice_id = ${id} and voided_at is null`) as unknown as [{ paid: number }];
    if (paid > invoice.total) throw new HTTPException(400, { message: `₹${paid} has been received against this bill, more than its total. Void a payment or change the bill.` });
    owed = invoice.customer_id ? await customerBalance(tx, invoice.customer_id, id) : null;
  } else if (invoice.return_id === null) {
    const [{ paid }] = (await tx`select coalesce(sum(amount), 0)::float8 as paid from order_payments where order_id = ${invoice.order_id}`) as unknown as [{ paid: number }];
    if (paid > invoice.total) throw new HTTPException(400, { message: `₹${paid} has been paid on this order, more than the invoice. Remove a payment or change the invoice.` });
    // What the buyer owed on their other orders just before this invoice, as the invoice prints it.
    const [row] = await tx`
      select coalesce(sum(greatest(0, coalesce(o.bill_amount, o.total) - coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0))), 0)::float8 as owed
      from orders o join app_devices d on d.id = o.device_id
      where coalesce((select merged_into from customers where id = d.customer_id), d.customer_id) =
          (select coalesce((select merged_into from customers where id = d2.customer_id), d2.customer_id) from orders o2 join app_devices d2 on d2.id = o2.device_id where o2.id = ${invoice.order_id})
        and o.id <> ${invoice.order_id} and o.status in ('placed', 'confirmed', 'packed', 'dispatched', 'delivered')`;
    owed = r2(row!.owed as number);
  }
  let number = invoice.number as string | null;
  let year = invoice.financial_year as string | null;
  if (!number) {
    year = financialYear(isoDay(new Date(invoice.invoice_date)));
    const [next] = await tx`
      insert into invoice_counters (series, financial_year, last_number) values ('invoice', ${year}, 1)
      on conflict (series, financial_year) do update set last_number = invoice_counters.last_number + 1
      returning last_number`;
    number = invoiceNumber(settings.invoicePrefix, year, next!.last_number as number);
  }
  await tx`
    update sales_invoices set status = 'posted', number = ${number}, financial_year = ${year}, seller_gstin = ${settings.gstin},
      previous_balance = ${owed}, posted_by = ${by}, posted_at = now(), version = version + 1
    where id = ${id}`;
  if (invoice.order_id !== null && invoice.return_id === null) await tx`update orders set bill_amount = ${Math.round(invoice.total)} where id = ${invoice.order_id}`;
  const moved = counter ? await syncBillStock(tx, id, by, { allowNegative: Boolean(invoice.allow_negative_stock || billing?.allow_negative_stock), reason: number }) : [];
  return { number, moved };
}

/**
 * A posted invoice is cancelled with a reason and keeps its number, so the series has no gaps. Not while a credit note
 * stands against it; a counter bill gives its goods back to stock, and needs its payments voided (or refunded) first.
 */
export async function cancelInvoice(tx: TransactionSql, id: number, by: string, reason: string) {
  const [invoice] = await tx`select status, number, order_id, return_id from sales_invoices where id = ${id} for update`;
  if (!invoice) throw new HTTPException(404, { message: 'That invoice does not exist.' });
  if (invoice.status !== 'posted') throw new HTTPException(409, { message: 'Only a posted invoice can be cancelled; a draft is deleted instead.' });
  const [note] = await tx`select number from sales_credit_notes where invoice_id = ${id} and status = 'posted' limit 1`;
  if (note) throw new HTTPException(409, { message: `Credit note ${note.number} is issued against this invoice. Cancel the credit note first.` });
  const counter = invoice.order_id === null && invoice.return_id === null;
  if (counter) {
    const [paid] = await tx`select count(*)::int as count from invoice_payments where invoice_id = ${id} and voided_at is null`;
    if (paid!.count) throw new HTTPException(409, { message: `${invoice.number} has payments. Void them (refund the customer) before cancelling it.` });
  }
  await tx`
    update sales_invoices set status = 'cancelled', cancelled_by = ${by}, cancelled_at = now(), cancel_reason = ${reason}, version = version + 1
    where id = ${id}`;
  return counter ? await syncBillStock(tx, id, by, { cancelled: true, reason: invoice.number }) : [];
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
      const [numbered] = await tx`select number from sales_invoices where id = ${id} and number is not null`;
      if (numbered) throw new HTTPException(409, { message: `${numbered.number} was posted before and keeps its number. Post it again, or cancel it.` });
      await tx`delete from sales_invoices where id = ${id}`;
    });
    return c.json({ removedInvoices: [String(id)] });
  });

  // Posting: the next number, the seller's GSTIN and the buyer's balance; the order's bill follows (postInvoice).
  routes.post('/invoices/:id/post', async (c) => {
    const id = parse(Id, c.req.param('id'));
    await sql.begin((tx) => postInvoice(tx, id, c.get('staff').name));
    return c.json({ invoices: await invoices(sql, sql`i.id = ${id}`) });
  });

  // A posted invoice is cancelled with a reason and keeps its number (cancelInvoice).
  routes.post('/invoices/:id/cancel', jsonBody(z.object({ reason: Text(300).min(1, 'Give the reason for cancelling.') })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    await sql.begin((tx) => cancelInvoice(tx, id, c.get('staff').name, c.req.valid('json').reason));
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
