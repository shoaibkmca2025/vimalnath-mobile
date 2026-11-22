import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { GSTIN, computeInvoice, financialYear, gstSettings, invoiceNumber, r2, saveDraft } from './gst.ts';
import { adminOrders } from './orders.ts';
import { only, type Env, type Role } from './staff.ts';
import { GST_RATES, move, stockItems, type Bucket } from './stock.ts';
import { jsonBody, parse } from './validate.ts';

/**
 * Phase 4, Returns & Replacements (docs/ERP-ROADMAP.md). A customer brings goods back from a delivered order for money
 * (refund) or other goods (replacement). Every step is a status change made by someone allowed to make it, recorded in
 * return_events; stock moves only through stock_moves, money only through refund_transactions (and order_payments for
 * a refund set against an order). An action sent from an out-of-date screen (an older `version`) is refused, so two
 * people can't act on the same return at once, and the same approval sent twice moves nothing twice.
 */

export const RETURN_REASONS = ['wrong_product', 'damaged', 'defective', 'wrong_size', 'changed_mind', 'duplicate_order', 'quality', 'other'] as const;
export const CONDITIONS = ['unopened', 'good', 'opened', 'damaged', 'defective', 'used', 'incomplete'] as const;
const OUTCOMES = ['restock', 'damaged', 'defective', 'write_off'] as const;
export const REFUND_METHODS = ['cash', 'upi', 'bank', 'cheque', 'original', 'store_credit', 'adjustment'] as const;
const MONEY_METHODS = ['cash', 'upi', 'bank', 'cheque'] as const;
const ACTIONS = ['create', 'approve', 'receive', 'inspect', 'refund'] as const;
type Action = (typeof ACTIONS)[number];
const STAFF_ROLES = ['sales', 'catalogue', 'inventory'] as const;
/** From received on, the goods are back with the shop. */
const GOODS_BACK = ['received', 'inspected', 'refunded', 'replaced', 'closed'];
const OPEN_REFUND = ['pending', 'approved', 'processing'];
const LABEL: Record<string, string> = {
  pending: 'pending',
  under_review: 'under review',
  approved: 'approved',
  rejected: 'rejected',
  received: 'received',
  inspected: 'checked',
  refunded: 'refunded',
  replaced: 'replaced',
  closed: 'closed',
  cancelled: 'cancelled',
};

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
    // Not after tomorrow in UTC: in India it is already tomorrow for the first 5½ hours of the UTC day.
    .refine((day) => day <= isoDay(new Date(Date.now() + DAY)), 'The day can’t be in the future.');
const Quantity = z
  .number('Enter the quantity.')
  .positive('Enter a quantity above 0.')
  .max(10_000_000, 'Enter 1 crore or less.')
  .refine((qty) => Math.abs(qty * 1000 - Math.round(qty * 1000)) < 1e-6, 'Use up to 3 decimal places.');
const Rupees = (label: string) =>
  z
    .number(`Enter the ${label} in rupees.`)
    .min(0, `Enter ₹0 or more for the ${label}.`)
    .max(MAX_RUPEES, `Enter a ${label} of ₹10 crore or less.`)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, `Use rupees and paise for the ${label}.`);
const WholeRupees = (label: string) => z.number(`Enter the ${label} in rupees.`).int('Enter whole rupees.').min(0, `Enter ₹0 or more for the ${label}.`).max(MAX_RUPEES, `Enter ₹10 crore or less.`);
const Version = z.number('Reload the page and try again.').int().positive();
const key = (productId: string, option: string) => `${productId}\u0000${option}`;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const round4 = (value: number) => Math.round(value * 10000) / 10000;
const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;

// ---------- Settings and permissions ----------

const Prefix = Text(6)
  .transform((prefix) => prefix.toUpperCase())
  .refine((prefix) => /^[A-Z0-9]{1,6}$/.test(prefix), 'Use 1 to 6 letters and numbers, e.g. RET.');
const RoleList = z.array(z.enum(STAFF_ROLES)).max(STAFF_ROLES.length);
const SettingsInput = z.object({
  eligibilityDays: z.number('Enter the days as a number.').int('Enter whole days.').min(0, 'Enter 0 or more days.').max(3650, 'Use 3650 days or fewer.'),
  requireApproval: z.boolean(),
  allowReplacements: z.boolean(),
  refundApproval: z.boolean(),
  eligibleCategories: z.array(z.string().min(1).max(200)).max(500),
  restockRule: z.enum(['inspect', 'unopened']),
  damagedHandling: z.enum(['keep', 'write_off']),
  allowNegativeStock: z.boolean(),
  replacementTax: z.enum(['invoice', 'none']),
  creditNoteOnReceipt: z.boolean(),
  returnPrefix: Prefix,
  creditNotePrefix: Prefix,
  supplierReturnPrefix: Prefix,
  refundMethods: z.array(z.enum(REFUND_METHODS)).min(1, 'Keep at least one refund method.'),
  terms: Text(2000).default(''),
  permissions: z.object({ create: RoleList, approve: RoleList, receive: RoleList, inspect: RoleList, refund: RoleList }),
});
export type ReturnSettings = z.output<typeof SettingsInput> & { updatedBy?: string | null; updatedAt?: string | null };

export async function returnSettings(sql: Sql | TransactionSql): Promise<ReturnSettings> {
  const [row] = await sql`
    select eligibility_days as "eligibilityDays", require_approval as "requireApproval", allow_replacements as "allowReplacements",
      refund_approval as "refundApproval", eligible_categories as "eligibleCategories", restock_rule as "restockRule",
      damaged_handling as "damagedHandling", allow_negative_stock as "allowNegativeStock", replacement_tax as "replacementTax",
      credit_note_on_receipt as "creditNoteOnReceipt", return_prefix as "returnPrefix", credit_note_prefix as "creditNotePrefix",
      supplier_return_prefix as "supplierReturnPrefix", refund_methods as "refundMethods", terms, permissions,
      updated_by as "updatedBy", updated_at as "updatedAt"
    from return_settings`;
  return row as ReturnSettings;
}

/** Owners may do anything; other roles what Return Settings gives them. */
export const can = (settings: Pick<ReturnSettings, 'permissions'>, role: Role, action: Action) => role === 'owner' || (settings.permissions[action] as string[]).includes(role);
const VERB: Record<Action, string> = { create: 'record returns', approve: 'approve returns', receive: 'receive returned goods', inspect: 'check returned goods', refund: 'pay refunds' };
function need(settings: ReturnSettings, role: Role, action: Action) {
  if (!can(settings, role, action)) throw new HTTPException(403, { message: `Your role can’t ${VERB[action]}. An Owner can change that under Return Settings.` });
}

// ---------- What was sold, and what can still come back ----------

type SoldLine = {
  source: 'invoice' | 'order';
  position: number;
  productId: string;
  option: string;
  description: string;
  name: string;
  hsn: string;
  unit: string;
  qty: number;
  /** Per unit: before GST after the discount (invoiced), or the price billed. */
  rate: number;
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  categoryId: string | null;
  returned: number;
  returnable: number;
};

/**
 * A delivered order as a return starts from it: the customer, the posted tax invoice if there is one, and each line sold
 * with how much is still returnable (sold less what other returns, not rejected or cancelled, already take).
 */
async function orderForReturn(tx: Sql | TransactionSql, orderId: number, excludeReturnId = 0) {
  const [order] = await tx`
    select o.id, o.number, o.status, o.customer, coalesce(nullif(o.phone, ''), d.phone) as phone, o.total, coalesce(o.bill_amount, o.total) as bill,
      coalesce((select merged_into from customers where id = d.customer_id), d.customer_id) as customer_id,
      (select max(e.at) from order_events e where e.order_id = o.id and e.status = 'delivered') as delivered_at
    from orders o join app_devices d on d.id = o.device_id where o.id = ${orderId}`;
  if (!order) throw new HTTPException(404, { message: 'That order does not exist.', cause: { field: 'orderId' } });
  const [invoice] = await tx`
    select id, number, invoice_date, interstate, customer_name, customer_gstin, billing_address, place_of_supply, details
    from sales_invoices where order_id = ${orderId} and status = 'posted' and return_id is null`;
  let lines: SoldLine[];
  if (invoice) {
    const rows = await tx`
      select l.position, l.product_id, l.option_label, l.description, l.detail, l.hsn, l.unit, l.qty::float8 as qty, l.gst_rate::float8 as gst_rate,
        l.taxable::float8 as taxable, l.cgst::float8 as cgst, l.sgst::float8 as sgst, l.igst::float8 as igst, p.category_id
      from sales_invoice_items l left join products p on p.id = l.product_id where l.invoice_id = ${invoice.id} order by l.position`;
    lines = rows.map((row) => ({
      source: 'invoice',
      position: row.position,
      productId: row.product_id,
      option: row.option_label,
      description: row.description,
      name: row.detail,
      hsn: row.hsn,
      unit: row.unit,
      qty: row.qty,
      rate: round4(row.taxable / row.qty),
      gstRate: row.gst_rate,
      taxable: row.taxable,
      cgst: row.cgst,
      sgst: row.sgst,
      igst: row.igst,
      categoryId: row.category_id,
      returned: 0,
      returnable: 0,
    }));
  } else {
    // Not invoiced here: each line at the price billed, its MRP scaled by the bill (a discount on the bill shares out).
    const share = order.total > 0 ? order.bill / order.total : 1;
    const rows = await tx`
      select l.position, l.product_id, coalesce(l.option, '') as option, coalesce(l.option_code, l.code) as description,
        l.name || coalesce(' · ' || l.option, '') as name, coalesce(s.hsn, '') as hsn, coalesce(s.unit, 'pcs') as unit, l.qty::float8 as qty,
        l.mrp::float8 as mrp, coalesce(s.gst_rate, 0)::float8 as gst_rate, p.category_id
      from order_lines l left join stock_items s on s.product_id = l.product_id and s.option_label = coalesce(l.option, '')
        left join products p on p.id = l.product_id
      where l.order_id = ${orderId} order by l.position`;
    lines = rows.map((row) => {
      const rate = row.mrp === null ? 0 : round4(row.mrp * share);
      const amount = r2(rate * row.qty);
      return {
        source: 'order',
        position: row.position,
        productId: row.product_id,
        option: row.option,
        description: row.description,
        name: row.name,
        hsn: row.hsn,
        unit: row.unit,
        qty: row.qty,
        rate,
        gstRate: row.gst_rate,
        taxable: amount,
        cgst: 0,
        sgst: 0,
        igst: 0,
        categoryId: row.category_id,
        returned: 0,
        returnable: 0,
      } satisfies SoldLine;
    });
  }
  // What other returns already take, by item: shared over the order's lines for that item in turn.
  const taken = await tx`
    select i.product_id, i.option_label, sum(i.qty)::float8 as qty from sales_return_items i join sales_returns r on r.id = i.return_id
    where r.order_id = ${orderId} and r.status not in ('rejected', 'cancelled') and r.id <> ${excludeReturnId} group by 1, 2`;
  const left = new Map(taken.map((row) => [key(row.product_id, row.option_label), row.qty as number]));
  for (const line of lines) {
    const id = key(line.productId, line.option);
    const returned = Math.min(line.qty, left.get(id) ?? 0);
    left.set(id, round3((left.get(id) ?? 0) - returned));
    line.returned = round3(returned);
    line.returnable = round3(line.qty - returned);
  }
  return { order, invoice: invoice ?? null, lines };
}

// ---------- Saving a return ----------

const ReturnItem = z.object({
  source: z.enum(['invoice', 'order']),
  sourcePosition: z.number().int().min(0),
  qty: Quantity,
  condition: z.enum(CONDITIONS, 'Choose the condition it came back in.'),
  /** For an order not invoiced here: the price per unit, when the bill's share isn't right (e.g. a catalogue-priced line). */
  rate: Rupees('price').optional(),
});
const ReplacementItem = z.object({
  productId: z.string().min(1).max(200),
  option: z.string().max(200),
  qty: Quantity,
  rate: Rupees('rate'),
  discountPct: z.number('Enter the discount as a number.').min(0, 'Enter 0% or more.').max(100, 'Enter 100% or less.').default(0),
  gstRate: z.number().refine((rate) => (GST_RATES as readonly number[]).includes(rate), 'Choose a GST rate.'),
});
const ReturnInput = z
  .object({
    kind: z.enum(['refund', 'replacement'], 'Choose a refund or a replacement.'),
    orderId: Id,
    returnDate: Day('return date'),
    reason: z.enum(RETURN_REASONS, 'Choose the reason.'),
    reasonNote: Text(500).default(''),
    items: z.array(ReturnItem).min(1, 'Choose what is coming back.').max(500),
    replacementItems: z.array(ReplacementItem).max(500).default([]),
    charges: WholeRupees('charges').default(0),
    chargesNote: Text(200).default(''),
    attachments: z.array(z.string().regex(MEDIA, 'Upload photos or PDFs.')).max(20, 'Attach up to 20 files.').default([]),
    notes: Text(2000).default(''),
  })
  .refine((input) => input.kind === 'refund' || input.replacementItems.length > 0, { message: 'Add the goods given in exchange.', path: ['replacementItems'] })
  .refine((input) => input.reason !== 'other' || input.reasonNote, { message: 'Say what the reason is.', path: ['reasonNote'] })
  .refine((input) => !input.charges || input.chargesNote, { message: 'Say what the charges are for.', path: ['chargesNote'] });
type ReturnInput = z.output<typeof ReturnInput>;

/** The returned items, each a copy of the line sold: a whole line gives back exactly its tax, part of one its share. */
function valueReturned(lines: SoldLine[], picks: ReturnInput['items']) {
  const seen = new Set<string>();
  return picks.map((pick, index) => {
    const line = lines.find((one) => one.source === pick.source && one.position === pick.sourcePosition);
    if (!line) throw new HTTPException(400, { message: 'A line on this return isn’t on the order’s bill any more. Start the return again.', cause: { field: `items.${index}` } });
    const id = `${line.source}${line.position}`;
    if (seen.has(id)) throw new HTTPException(400, { message: `${line.description} is listed twice.`, cause: { field: `items.${index}` } });
    seen.add(id);
    if (pick.qty > line.returnable + 1e-9)
      throw new HTTPException(400, {
        message: line.returnable > 0 ? `Only ${line.returnable} ${line.unit} of ${line.description} can come back (${line.qty} sold, ${line.returned} already returned).` : `${line.description} has already been returned in full.`,
        cause: { field: `items.${index}.qty` },
      });
    const whole = Math.abs(pick.qty - line.qty) < 1e-9;
    const share = pick.qty / line.qty;
    let figures: { rate: number; taxable: number; cgst: number; sgst: number; igst: number };
    if (line.source === 'invoice') {
      figures = whole
        ? { rate: line.rate, taxable: line.taxable, cgst: line.cgst, sgst: line.sgst, igst: line.igst }
        : { rate: line.rate, taxable: r2(line.taxable * share), cgst: r2(line.cgst * share), sgst: r2(line.sgst * share), igst: r2(line.igst * share) };
    } else {
      const rate = pick.rate ?? line.rate;
      figures = { rate, taxable: r2(rate * pick.qty), cgst: 0, sgst: 0, igst: 0 };
    }
    return {
      position: index,
      source: line.source,
      source_position: line.position,
      product_id: line.productId,
      option_label: line.option,
      description: line.description,
      name: line.name,
      hsn: line.hsn,
      unit: line.unit,
      qty: pick.qty,
      rate: figures.rate,
      gst_rate: line.gstRate,
      taxable: figures.taxable,
      cgst: figures.cgst,
      sgst: figures.sgst,
      igst: figures.igst,
      amount: r2(figures.taxable + figures.cgst + figures.sgst + figures.igst),
      condition: pick.condition,
      categoryId: line.categoryId,
    };
  });
}

/** The goods given in exchange, from the catalogue, priced the way the order was billed: with GST on top when invoiced. */
async function valueReplacements(tx: TransactionSql, items: ReturnInput['replacementItems'], invoiced: boolean, interstate: boolean) {
  if (!items.length) return { rows: [], value: 0 };
  const ids = [...new Set(items.map((item) => item.productId))];
  const products = await tx`
    select p.id, p.code, coalesce(nullif(p.name, ''), p.section) as name,
      coalesce((select json_agg(json_build_object('label', o.label, 'code', o.code)) from product_options o where o.product_id = p.id), '[]') as options
    from products p where p.id in ${tx(ids)}`;
  const byId = new Map(products.map((product) => [product.id as string, product]));
  const counted = await tx`select product_id, option_label, unit, hsn from stock_items where product_id in ${tx(ids)}`;
  const stock = new Map(counted.map((row) => [key(row.product_id, row.option_label), row]));
  const described = items.map((item, index) => {
    const product = byId.get(item.productId);
    const options = (product?.options ?? []) as { label: string; code: string | null }[];
    const option = options.find((one) => one.label === item.option);
    if (!product || (options.length ? !option : item.option !== ''))
      throw new HTTPException(400, { message: 'A replacement item isn’t in the catalogue any more. Remove it and add it again.', cause: { field: `replacementItems.${index}.productId` } });
    const counting = stock.get(key(item.productId, item.option));
    return { ...item, description: option?.code ?? (product.code as string), name: `${product.name}${item.option ? ` · ${item.option}` : ''}`, unit: (counting?.unit as string) ?? 'pcs', hsn: (counting?.hsn as string) ?? '' };
  });
  if (invoiced) {
    const figures = computeInvoice(described, interstate);
    return {
      rows: figures.lines.map((line, position) => ({
        position,
        product_id: line.productId,
        option_label: line.option,
        description: line.description,
        name: line.name,
        hsn: line.hsn,
        unit: line.unit,
        qty: line.qty,
        rate: line.rate,
        discount_pct: line.discountPct,
        gst_rate: line.gstRate,
        taxable: line.taxable,
        cgst: line.cgst,
        sgst: line.sgst,
        igst: line.igst,
        amount: r2(line.taxable + line.cgst + line.sgst + line.igst),
      })),
      value: Math.round(figures.total),
    };
  }
  const rows = described.map((item, position) => {
    const amount = r2(item.qty * item.rate * (1 - item.discountPct / 100));
    return { position, product_id: item.productId, option_label: item.option, description: item.description, name: item.name, hsn: item.hsn, unit: item.unit, qty: item.qty, rate: item.rate, discount_pct: item.discountPct, gst_rate: item.gstRate, taxable: amount, cgst: 0, sgst: 0, igst: 0, amount };
  });
  return { rows, value: Math.round(rows.reduce((total, row) => total + row.amount, 0)) };
}

/** Checks a return against its order and works out its figures and flags; a new one gets the next number. */
async function saveReturn(tx: TransactionSql, input: ReturnInput, staff: { name: string; role: Role }, id?: number) {
  const settings = await returnSettings(tx);
  if (input.kind === 'replacement' && !settings.allowReplacements) throw new HTTPException(400, { message: 'Replacements are turned off under Return Settings.', cause: { field: 'kind' } });
  const { order, invoice, lines } = await orderForReturn(tx, input.orderId, id ?? 0);
  if (order.status !== 'delivered') throw new HTTPException(400, { message: `${order.number} isn’t delivered, so nothing can come back from it yet.`, cause: { field: 'orderId' } });
  const returned = valueReturned(lines, input.items);
  const replacement = await valueReplacements(tx, input.replacementItems, Boolean(invoice), Boolean(invoice?.interstate));
  const returnValue = Math.round(returned.reduce((total, item) => total + item.amount, 0));
  if (input.charges > returnValue) throw new HTTPException(400, { message: `The charges can’t be more than the goods coming back (${rupees(returnValue)}).`, cause: { field: 'charges' } });
  // For whoever approves: later than the return period, or a category not marked returnable. Never refused outright.
  const flags: string[] = [];
  if (settings.eligibilityDays > 0 && order.delivered_at) {
    const last = isoDay(new Date(new Date(order.delivered_at).getTime() + 5.5 * 3_600_000 + settings.eligibilityDays * DAY));
    if (input.returnDate > last) flags.push('late');
  }
  if (settings.eligibleCategories.length && returned.some((item) => !item.categoryId || !settings.eligibleCategories.includes(item.categoryId))) flags.push('category');
  const row = {
    kind: input.kind,
    order_id: order.id,
    invoice_id: invoice?.id ?? null,
    customer_id: order.customer_id,
    customer_name: invoice?.customer_name || order.customer,
    customer_phone: order.phone ?? '',
    return_date: input.returnDate,
    reason: input.reason,
    reason_note: input.reasonNote,
    return_value: returnValue,
    replacement_value: replacement.value,
    charges: input.charges,
    charges_note: input.chargesNote,
    settle_amount: returnValue - input.charges - replacement.value,
    flags,
    attachments: input.attachments,
    notes: input.notes,
  };
  let status: string | null = null;
  if (id === undefined) {
    const [{ next }] = (await tx`select nextval('return_numbers')::int as next`) as unknown as [{ next: number }];
    // Approved straight away only when the shop doesn't ask for approval, nothing is flagged, and this person may approve.
    status = !settings.requireApproval && !flags.length && can(settings, staff.role, 'approve') ? 'approved' : 'pending';
    const [saved] = await tx`insert into sales_returns ${tx({ ...row, number: `${settings.returnPrefix}-${String(next).padStart(4, '0')}`, status, created_by: staff.name })} returning id`;
    id = saved!.id as number;
  } else {
    await tx`update sales_returns set ${tx(row)}, version = version + 1, updated_at = now() where id = ${id}`;
    await tx`delete from sales_return_items where return_id = ${id}`;
    await tx`delete from replacement_items where return_id = ${id}`;
  }
  await tx`insert into sales_return_items ${tx(returned.map(({ categoryId: _category, ...item }) => ({ return_id: id!, ...item })))}`;
  if (replacement.rows.length) await tx`insert into replacement_items ${tx(replacement.rows.map((item) => ({ return_id: id!, ...item })))}`;
  return { id, status };
}

// ---------- Reading returns ----------

/** Returns in the admin's SalesReturn shape (admin/src/data/types.ts). */
export const salesReturns = (sql: Sql | TransactionSql, where = sql`true`) =>
  sql`
    select json_strip_nulls(json_build_object(
      'id', r.id::text, 'number', r.number, 'kind', r.kind, 'orderId', r.order_id::text, 'orderNumber', o.number,
      'invoiceId', r.invoice_id::text, 'invoiceNumber', inv.number, 'invoiceDate', inv.invoice_date, 'interstate', inv.interstate,
      'customerGstin', nullif(inv.customer_gstin, ''), 'billingAddress', nullif(inv.billing_address, ''), 'placeOfSupply', nullif(inv.place_of_supply, ''), 'posCode', nullif(inv.pos_code, ''),
      'customerId', r.customer_id, 'customerName', r.customer_name, 'customerPhone', nullif(r.customer_phone, ''),
      'returnDate', r.return_date, 'reason', r.reason, 'reasonNote', nullif(r.reason_note, ''), 'status', r.status,
      'returnValue', r.return_value, 'replacementValue', r.replacement_value, 'charges', r.charges, 'chargesNote', nullif(r.charges_note, ''),
      'settleAmount', r.settle_amount, 'flags', r.flags, 'attachments', r.attachments, 'notes', nullif(r.notes, ''), 'version', r.version,
      'createdBy', r.created_by, 'createdAt', r.created_at, 'updatedAt', r.updated_at,
      'items', (select json_agg(json_build_object('position', i.position, 'source', i.source, 'sourcePosition', i.source_position,
          'productId', i.product_id, 'option', i.option_label, 'description', i.description, 'name', i.name, 'hsn', i.hsn, 'unit', i.unit,
          'qty', i.qty::float8, 'rate', i.rate::float8, 'gstRate', i.gst_rate::float8, 'taxable', i.taxable::float8, 'cgst', i.cgst::float8,
          'sgst', i.sgst::float8, 'igst', i.igst::float8, 'amount', i.amount::float8, 'condition', i.condition, 'outcome', i.outcome,
          'outcomeNote', nullif(i.outcome_note, ''), 'inspectedBy', i.inspected_by, 'inspectedAt', i.inspected_at) order by i.position)
        from sales_return_items i where i.return_id = r.id),
      'replacementItems', (select json_agg(json_build_object('position', i.position, 'productId', i.product_id, 'option', i.option_label,
          'description', i.description, 'name', i.name, 'hsn', i.hsn, 'unit', i.unit, 'qty', i.qty::float8, 'rate', i.rate::float8,
          'discountPct', i.discount_pct::float8, 'gstRate', i.gst_rate::float8, 'taxable', i.taxable::float8, 'cgst', i.cgst::float8,
          'sgst', i.sgst::float8, 'igst', i.igst::float8, 'amount', i.amount::float8) order by i.position)
        from replacement_items i where i.return_id = r.id),
      'refunds', (select json_agg(json_build_object('id', t.id::text, 'direction', t.direction, 'amount', t.amount, 'method', t.method,
          'orderId', t.order_id::text, 'orderNumber', (select number from orders where id = t.order_id), 'reference', nullif(t.reference, ''),
          'paidOn', t.paid_on, 'status', t.status, 'note', nullif(t.note, ''), 'createdBy', t.created_by, 'createdAt', t.created_at,
          'approvedBy', t.approved_by, 'approvedAt', t.approved_at, 'completedBy', t.completed_by, 'completedAt', t.completed_at) order by t.id)
        from refund_transactions t where t.return_id = r.id),
      'creditNote', (select json_build_object('id', n.id::text, 'number', n.number, 'date', n.note_date, 'status', n.status, 'taxable', n.taxable::float8,
          'cgst', n.cgst::float8, 'sgst', n.sgst::float8, 'igst', n.igst::float8, 'roundOff', n.round_off::float8, 'total', n.total::float8,
          'cancelReason', nullif(n.cancel_reason, ''))
        from sales_credit_notes n where n.return_id = r.id order by (n.status = 'posted') desc, n.id desc limit 1),
      'replacementInvoice', (select json_build_object('id', ri.id::text, 'number', ri.number, 'status', ri.status, 'total', ri.total::float8)
        from sales_invoices ri where ri.return_id = r.id order by (ri.status <> 'cancelled') desc, ri.id desc limit 1)
    )) as "return"
    from sales_returns r join orders o on o.id = r.order_id left join sales_invoices inv on inv.id = r.invoice_id
    where ${where}
    order by r.return_date desc, r.id desc`.then((rows) => rows.map((row) => row.return));

/** GST credit notes in the admin's CreditNote shape, with the returned lines they credit. */
export const creditNotes = (sql: Sql | TransactionSql, where = sql`true`) =>
  sql`
    select json_strip_nulls(json_build_object(
      'id', n.id::text, 'number', n.number, 'noteDate', n.note_date, 'status', n.status, 'returnId', n.return_id::text, 'returnNumber', r.number,
      'invoiceId', n.invoice_id::text, 'invoiceNumber', i.number, 'invoiceDate', i.invoice_date, 'orderId', r.order_id::text,
      'customerName', n.customer_name, 'customerGstin', nullif(n.customer_gstin, ''), 'placeOfSupply', n.place_of_supply, 'posCode', n.pos_code,
      'interstate', n.interstate, 'sellerGstin', n.seller_gstin, 'taxable', n.taxable::float8, 'cgst', n.cgst::float8, 'sgst', n.sgst::float8,
      'igst', n.igst::float8, 'roundOff', n.round_off::float8, 'total', n.total::float8, 'createdBy', n.created_by, 'createdAt', n.created_at,
      'cancelledBy', n.cancelled_by, 'cancelledAt', n.cancelled_at, 'cancelReason', nullif(n.cancel_reason, ''),
      'items', (select json_agg(json_build_object('productId', l.product_id, 'option', l.option_label, 'description', l.description, 'hsn', l.hsn,
          'qty', l.qty::float8, 'unit', l.unit, 'rate', l.rate::float8, 'gstRate', l.gst_rate::float8, 'taxable', l.taxable::float8,
          'cgst', l.cgst::float8, 'sgst', l.sgst::float8, 'igst', l.igst::float8) order by l.position)
        from sales_return_items l where l.return_id = n.return_id)
    )) as note
    from sales_credit_notes n join sales_returns r on r.id = n.return_id join sales_invoices i on i.id = n.invoice_id
    where ${where}
    order by n.note_date desc, n.id desc`.then((rows) => rows.map((row) => row.note));

/** Store credit a customer holds: refunds given as store credit, less what they have spent of it on orders. */
export async function storeCredit(tx: Sql | TransactionSql, given: number) {
  // A customer merged into another holds their credit there.
  const [{ id: customerId }] = (await tx`select coalesce((select merged_into from customers where id = ${given}), ${given})::int as id`) as unknown as [{ id: number }];
  const [row] = await tx`
    select (
      coalesce((select sum(t.amount) from refund_transactions t join sales_returns r on r.id = t.return_id
        where t.status = 'completed' and t.method = 'store_credit' and t.direction = 'out'
          and coalesce((select merged_into from customers where id = r.customer_id), r.customer_id) = ${customerId}), 0)
      - coalesce((select sum(p.amount) from order_payments p join orders o on o.id = p.order_id join app_devices d on d.id = o.device_id
        where p.method = 'store_credit' and coalesce((select merged_into from customers where id = d.customer_id), d.customer_id) = ${customerId}), 0)
    )::int as available`;
  return row!.available as number;
}

// ---------- Steps ----------

/** Locks a return for a change, refusing one decided on an out-of-date screen. */
async function lockReturn(tx: TransactionSql, id: number, version?: number) {
  const [row] = await tx`
    select id, number, kind, status, version, order_id, invoice_id, customer_id, return_value, replacement_value, charges, settle_amount
    from sales_returns where id = ${id} for update`;
  if (!row) throw new HTTPException(404, { message: 'That return does not exist.' });
  if (version !== undefined && row.version !== version) {
    const [last] = await tx`select by from return_events where return_id = ${id} order by id desc limit 1`;
    throw new HTTPException(409, { message: `${row.number} was just changed${last ? ` by ${last.by}` : ''}. Reload to see what changed, then try again.` });
  }
  return row;
}

const event = (tx: TransactionSql, id: number, kind: string, by: string, details: { from?: string; to?: string; note?: string } = {}) =>
  tx`insert into return_events ${tx({ return_id: id, kind, from_status: details.from ?? null, to_status: details.to ?? null, note: details.note ?? '', by })}`;

async function setStatus(tx: TransactionSql, id: number, from: string, to: string, by: string, note = '') {
  await tx`update sales_returns set status = ${to}, version = version + 1, updated_at = now() where id = ${id}`;
  await event(tx, id, 'status', by, { from, to, note });
}
const bump = (tx: TransactionSql, id: number) => tx`update sales_returns set version = version + 1, updated_at = now() where id = ${id}`;

/** Money settled so far: completed out and in, and refunds still open. */
async function money(tx: TransactionSql, id: number) {
  const [row] = await tx`
    select coalesce(sum(amount) filter (where status = 'completed' and direction = 'out'), 0)::int as paid_out,
      coalesce(sum(amount) filter (where status = 'completed' and direction = 'in'), 0)::int as paid_in,
      coalesce(sum(amount) filter (where status not in ('failed', 'cancelled') and direction = 'out'), 0)::int as booked_out,
      coalesce(sum(amount) filter (where status not in ('failed', 'cancelled') and direction = 'in'), 0)::int as booked_in,
      count(*) filter (where status in ('pending', 'approved', 'processing'))::int as open
    from refund_transactions where return_id = ${id}`;
  return row as unknown as { paid_out: number; paid_in: number; booked_out: number; booked_in: number; open: number };
}
const isSettled = (settle: number, sums: Awaited<ReturnType<typeof money>>) =>
  sums.open === 0 && (settle >= 0 ? sums.paid_out === settle && sums.paid_in === 0 : sums.paid_in === -settle && sums.paid_out === 0);

/** A refund return that is checked and fully paid becomes Refunded by itself. */
async function advance(tx: TransactionSql, id: number, by: string) {
  const [row] = await tx`select kind, status, settle_amount from sales_returns where id = ${id}`;
  if (row!.kind === 'refund' && row!.status === 'inspected' && isSettled(row!.settle_amount, await money(tx, id))) await setStatus(tx, id, 'inspected', 'refunded', by, 'Checked and settled in full.');
}

/** The GST credit note for the goods back, numbered in its own series for the financial year. */
async function issueCreditNote(tx: TransactionSql, id: number, by: string) {
  const [ret] = await tx`select number, invoice_id from sales_returns where id = ${id}`;
  if (!ret!.invoice_id) throw new HTTPException(400, { message: 'This order has no posted tax invoice here, so there is no GST to credit.' });
  const [existing] = await tx`select number from sales_credit_notes where return_id = ${id} and status = 'posted'`;
  if (existing) throw new HTTPException(409, { message: `Credit note ${existing.number} is already issued.` });
  const gst = await gstSettings(tx);
  if (!GSTIN.test(gst.gstin)) throw new HTTPException(400, { message: 'Fill in the shop’s GSTIN under GST Settings first.' });
  const settings = await returnSettings(tx);
  const [invoice] = await tx`select customer_name, customer_gstin, place_of_supply, pos_code, interstate from sales_invoices where id = ${ret!.invoice_id}`;
  const [sums] = await tx`
    select coalesce(sum(taxable), 0)::float8 as taxable, coalesce(sum(cgst), 0)::float8 as cgst, coalesce(sum(sgst), 0)::float8 as sgst, coalesce(sum(igst), 0)::float8 as igst
    from sales_return_items where return_id = ${id}`;
  const exact = r2(sums!.taxable + sums!.cgst + sums!.sgst + sums!.igst);
  const total = Math.round(exact);
  const today = isoDay(new Date());
  const year = financialYear(today);
  const [counter] = await tx`
    insert into invoice_counters (series, financial_year, last_number) values ('credit_note', ${year}, 1)
    on conflict (series, financial_year) do update set last_number = invoice_counters.last_number + 1 returning last_number`;
  const number = invoiceNumber(settings.creditNotePrefix, year, counter!.last_number as number);
  await tx`
    insert into sales_credit_notes ${tx({
      return_id: id,
      invoice_id: ret!.invoice_id,
      number,
      financial_year: year,
      note_date: today,
      customer_name: invoice!.customer_name,
      customer_gstin: invoice!.customer_gstin,
      place_of_supply: invoice!.place_of_supply,
      pos_code: invoice!.pos_code,
      interstate: invoice!.interstate,
      seller_gstin: gst.gstin,
      taxable: sums!.taxable,
      cgst: sums!.cgst,
      sgst: sums!.sgst,
      igst: sums!.igst,
      round_off: r2(total - exact),
      total,
      created_by: by,
    })}`;
  await event(tx, id, 'credit_note', by, { note: `Credit note ${number} for ${rupees(total)}` });
  return number;
}

/**
 * A refund completed: money paid out, store credit given, or (adjustment) paid off one of the customer's orders, which
 * records a payment there. The order's limit is checked again, as it may have been paid since the refund was entered.
 */
async function completeRefund(tx: TransactionSql, refund: { id: number; return_id: number; amount: number; method: string; order_id: number | null }, ret: { number: string }, by: string, paidOn: string) {
  let paymentId: number | null = null;
  if (refund.method === 'adjustment') {
    const [order] = await tx`
      select o.number, o.status, coalesce(o.bill_amount, o.total) as bill, coalesce((select sum(amount) from order_payments where order_id = o.id), 0)::int as paid
      from orders o where o.id = ${refund.order_id} for update`;
    if (!order || !['placed', 'confirmed', 'packed', 'dispatched', 'delivered'].includes(order.status)) throw new HTTPException(400, { message: 'That order can’t take a payment any more.', cause: { field: 'orderId' } });
    if (order.paid + refund.amount > order.bill) throw new HTTPException(400, { message: `${order.number} only owes ${rupees(order.bill - order.paid)} now.`, cause: { field: 'amount' } });
    const [payment] = await tx`
      insert into order_payments ${tx({ order_id: refund.order_id!, amount: refund.amount, method: 'return', paid_on: paidOn, note: `Return ${ret.number}`, by, refund_id: refund.id })} returning id`;
    paymentId = payment!.id as number;
  }
  await tx`
    update refund_transactions set status = 'completed', paid_on = ${paidOn}, completed_by = ${by}, completed_at = now(), order_payment_id = ${paymentId}, updated_at = now()
    where id = ${refund.id}`;
}

// ---------- Routes ----------

/** /v1/admin/returns. Who may do what comes from Return Settings; Owners may do everything. */
export function returnRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner', 'sales', 'inventory'));
  const owners = only('owner');

  const answer = async (id: number, orderIds: number[] = [], stockKeys: { productId: string; option: string }[] = []) => {
    const [ret] = await salesReturns(sql, sql`r.id = ${id}`);
    return {
      returns: [ret],
      orders: orderIds.length ? await adminOrders(sql, sql`o.id in ${sql(orderIds)}`) : [],
      stock: stockKeys.length
        ? await stockItems(
            sql,
            true,
            sql`exists (select 1 from jsonb_to_recordset(${sql.json(stockKeys.map(({ productId, option }) => ({ productId, option })))}) as k("productId" text, option text) where k."productId" = s.product_id and k.option = s.option_label)`,
          )
        : [],
    };
  };
  const stockKeysOf = (rows: { product_id: string; option_label: string }[]) => rows.map((row) => ({ productId: row.product_id, option: row.option_label }));

  routes.get('/settings', async (c) => c.json(await returnSettings(sql)));

  // The shop as printed on a return receipt or credit note: anyone who handles returns prints them.
  routes.get('/shop', async (c) => {
    const gst = await gstSettings(sql);
    return c.json({ legalName: gst.legalName, tradeName: gst.tradeName, gstin: gst.gstin, address: gst.address, pincode: gst.pincode, phone: gst.phone, email: gst.email, jurisdiction: gst.jurisdiction });
  });
  routes.put('/settings', owners, jsonBody(SettingsInput), async (c) => {
    const input = c.req.valid('json');
    await sql`
      update return_settings set ${sql({
        eligibility_days: input.eligibilityDays,
        require_approval: input.requireApproval,
        allow_replacements: input.allowReplacements,
        refund_approval: input.refundApproval,
        eligible_categories: input.eligibleCategories,
        restock_rule: input.restockRule,
        damaged_handling: input.damagedHandling,
        allow_negative_stock: input.allowNegativeStock,
        replacement_tax: input.replacementTax,
        credit_note_on_receipt: input.creditNoteOnReceipt,
        return_prefix: input.returnPrefix,
        credit_note_prefix: input.creditNotePrefix,
        supplier_return_prefix: input.supplierReturnPrefix,
        refund_methods: input.refundMethods,
        terms: input.terms,
        permissions: sql.json(input.permissions),
        updated_by: c.get('staff').name,
      })}, updated_at = now()`;
    return c.json(await returnSettings(sql));
  });

  // shortcut: every return at once, which the admin filters itself; page it on the server past a few thousand.
  routes.get('/', async (c) => c.json(await salesReturns(sql)));

  // Delivered orders matching an order or invoice number, a customer's name or phone, for starting a return.
  routes.get('/orders', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    const like = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    return c.json(
      await sql`
        select o.id::text as id, o.number, o.customer, coalesce(nullif(o.phone, ''), d.phone) as phone, o.placed_at as "placedAt",
          coalesce(o.bill_amount, o.total) as bill, i.number as "invoiceNumber",
          (select max(e.at) from order_events e where e.order_id = o.id and e.status = 'delivered') as "deliveredAt"
        from orders o join app_devices d on d.id = o.device_id
          left join sales_invoices i on i.order_id = o.id and i.status = 'posted' and i.return_id is null
          left join customers cu on cu.id = d.customer_id
        where o.status = 'delivered' and (${query}::text = '' or o.number ilike ${like} or i.number ilike ${like} or o.customer ilike ${like}
          or cu.name ilike ${like} or o.phone ilike ${like} or d.phone ilike ${like} or cu.id::text = ${query})
        order by o.placed_at desc limit 25`,
    );
  });

  // One order's lines with what can still come back, for the return form.
  routes.get('/orders/:orderId', async (c) => {
    const orderId = parse(Id, c.req.param('orderId'));
    const exclude = c.req.query('returnId') ? parse(Id, c.req.query('returnId')) : 0;
    const settings = await returnSettings(sql);
    const { order, invoice, lines } = await orderForReturn(sql, orderId, exclude);
    const lastDay =
      settings.eligibilityDays > 0 && order.delivered_at ? isoDay(new Date(new Date(order.delivered_at).getTime() + 5.5 * 3_600_000 + settings.eligibilityDays * DAY)) : null;
    return c.json({
      order: { id: String(order.id), number: order.number, status: order.status, customer: order.customer, phone: order.phone || undefined, customerId: order.customer_id ?? undefined, bill: order.bill, deliveredAt: order.delivered_at ?? undefined, lastDay },
      invoice: invoice ? { id: String(invoice.id), number: invoice.number, date: invoice.invoice_date, interstate: invoice.interstate } : null,
      lines: lines.map(({ categoryId, ...line }) => ({ ...line, eligible: !settings.eligibleCategories.length || (categoryId !== null && settings.eligibleCategories.includes(categoryId)) })),
    });
  });

  // GST credit notes, for the GST registers. Owners only, like the rest of GST.
  routes.get('/credit-notes', owners, async (c) => c.json(await creditNotes(sql)));

  // Every refund and collection, for Refund Management.
  routes.get('/refunds', async (c) =>
    c.json(
      await sql`
        select t.id::text as id, t.return_id::text as "returnId", r.number as "returnNumber", r.kind, r.customer_name as "customerName",
          t.direction, t.amount, t.method, t.order_id::text as "orderId", o.number as "orderNumber", nullif(t.reference, '') as reference,
          t.paid_on as "paidOn", t.status, nullif(t.note, '') as note, t.created_by as "createdBy", t.created_at as "createdAt",
          t.approved_by as "approvedBy", t.approved_at as "approvedAt", t.completed_by as "completedBy", t.completed_at as "completedAt"
        from refund_transactions t join sales_returns r on r.id = t.return_id left join orders o on o.id = t.order_id
        order by t.created_at desc, t.id desc`,
    ),
  );

  // For the sidebar's red counts: returns waiting for a decision, for their goods, for the quality check, and refunds open.
  routes.get('/count', async (c) =>
    c.json(
      (
        await sql`
          select count(*) filter (where status in ('pending', 'under_review'))::int as decide,
            count(*) filter (where status = 'approved')::int as receive,
            count(*) filter (where status in ('received', 'replaced', 'refunded') and exists (select 1 from sales_return_items i where i.return_id = r.id and i.outcome is null))::int as inspect,
            (select count(*) from refund_transactions where status in ('pending', 'approved', 'processing'))::int as refunds
          from sales_returns r`
      )[0],
    ),
  );

  // What a customer holds in store credit.
  routes.get('/store-credit/:customerId', async (c) => c.json({ available: await storeCredit(sql, parse(Id, c.req.param('customerId'))) }));

  // One return with its history and the stock it moved.
  routes.get('/:id', async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [ret] = await salesReturns(sql, sql`r.id = ${id}`);
    if (!ret) throw new HTTPException(404, { message: 'That return does not exist.' });
    const [events, moves] = await Promise.all([
      sql`select id::text as id, kind, from_status as "from", to_status as "to", nullif(note, '') as note, by, at from return_events where return_id = ${id} order by id`,
      sql`
        select m.id::text as id, m.product_id as "productId", m.option_label as option, m.change::float8 as change, m.balance::float8 as balance,
          m.bucket, m.kind, m.by, m.at from stock_moves m where m.return_id = ${id} order by m.id`,
    ]);
    return c.json({ return: ret, events, moves });
  });

  routes.post('/', jsonBody(ReturnInput), async (c) => {
    const input = c.req.valid('json');
    const staff = c.get('staff');
    const id = await sql.begin(async (tx) => {
      need(await returnSettings(tx), staff.role, 'create');
      const saved = await saveReturn(tx, input, staff);
      await event(tx, saved.id, 'created', staff.name, { to: 'pending' });
      if (saved.status === 'approved') await event(tx, saved.id, 'status', staff.name, { from: 'pending', to: 'approved', note: 'Approved as it was recorded.' });
      return saved.id;
    });
    return c.json(await answer(id), 201);
  });

  // Only while it waits for a decision; after that its lines are fixed and changes go through its steps.
  routes.put('/:id', jsonBody(ReturnInput.and(z.object({ version: Version }))), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const input = c.req.valid('json');
    const staff = c.get('staff');
    await sql.begin(async (tx) => {
      need(await returnSettings(tx), staff.role, 'create');
      const ret = await lockReturn(tx, id, input.version);
      if (!['pending', 'under_review'].includes(ret.status)) throw new HTTPException(409, { message: `${ret.number} is ${LABEL[ret.status]}, so its goods can’t change. Cancel it and record a new return.` });
      if (ret.order_id !== input.orderId) throw new HTTPException(400, { message: 'A return stays with its order.', cause: { field: 'orderId' } });
      await saveReturn(tx, input, staff, id);
      await event(tx, id, 'edited', staff.name);
    });
    return c.json(await answer(id));
  });

  // Decisions: review, approve, reject, cancel (with the stock it moved taken back), close.
  const Transition = z.object({ to: z.enum(['under_review', 'approved', 'rejected', 'cancelled', 'closed']), version: Version, note: Text(500).default('') });
  routes.post('/:id/status', jsonBody(Transition), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const { to, version, note } = c.req.valid('json');
    const staff = c.get('staff');
    const touched = await sql.begin(async (tx) => {
      const settings = await returnSettings(tx);
      const ret = await lockReturn(tx, id, version);
      const from = ret.status as string;
      const refuse = (message: string) => {
        throw new HTTPException(409, { message });
      };
      if (to === 'under_review' || to === 'approved' || to === 'rejected') {
        need(settings, staff.role, 'approve');
        if (!['pending', 'under_review'].includes(from) || (to === 'under_review' && from === 'under_review'))
          refuse(from === to ? `${ret.number} is already ${LABEL[to]}.` : `${ret.number} is ${LABEL[from]}, so it can’t be ${LABEL[to]} now.`);
        if (to === 'rejected' && !note) throw new HTTPException(400, { message: 'Say why it’s rejected: the customer will ask.', cause: { field: 'note' } });
        await setStatus(tx, id, from, to, staff.name, note);
        return [];
      }
      if (to === 'closed') {
        need(settings, staff.role, 'approve');
        if (!['inspected', 'refunded', 'replaced'].includes(from)) refuse(`${ret.number} is ${LABEL[from]}; it closes once the goods are checked and it’s settled.`);
        const [open] = await tx`select count(*)::int as count from sales_return_items where return_id = ${id} and outcome is null`;
        if (open!.count) refuse(`Check every returned item before closing ${ret.number}.`);
        if (ret.kind === 'replacement' && from !== 'replaced') refuse(`Give the replacement goods before closing ${ret.number}.`);
        if (!isSettled(ret.settle_amount, await money(tx, id))) refuse(`${ret.number} isn’t settled yet: finish its refunds or collect the difference first.`);
        await setStatus(tx, id, from, 'closed', staff.name, note);
        return [];
      }
      // Cancelling. Before the goods are back, it just stops; after, it is a reversal: the stock it moved goes back where
      // it came from and its credit note is cancelled. Money already paid, or replacement goods given, can't be undone here.
      if (!['pending', 'under_review', 'approved', 'received', 'inspected'].includes(from)) refuse(`${ret.number} is ${LABEL[from]}, so it can’t be cancelled.`);
      need(settings, staff.role, ['pending', 'under_review'].includes(from) ? 'create' : 'approve');
      if (!note) throw new HTTPException(400, { message: 'Say why it’s cancelled.', cause: { field: 'note' } });
      const sums = await money(tx, id);
      if (sums.paid_out || sums.paid_in) refuse(`${ret.number} has completed refunds or payments, so it can’t be cancelled. Close it instead.`);
      await tx`update refund_transactions set status = 'cancelled', updated_at = now() where return_id = ${id} and status in ('pending', 'approved', 'processing', 'failed')`;
      const moved = await tx`
        select product_id, option_label, bucket, sum(change)::float8 as net from stock_moves where return_id = ${id}
        group by 1, 2, 3 having sum(change) <> 0 order by 1, 2, 3`;
      for (const row of moved)
        await move(tx, { productId: row.product_id, option: row.option_label }, -row.net, { kind: 'return_reversed', bucket: row.bucket as Bucket, returnId: id, reason: ret.number, by: staff.name }).catch(
          (error: { constraint_name?: string }) => {
            if (error.constraint_name?.startsWith('stock_items')) refuse(`Some ${row.bucket} stock from ${ret.number} has already gone (sent back or written off), so it can’t be undone.`);
            throw error;
          },
        );
      const [note_] = await tx`
        update sales_credit_notes set status = 'cancelled', cancelled_by = ${staff.name}, cancelled_at = now(), cancel_reason = ${`Return cancelled: ${note}`}
        where return_id = ${id} and status = 'posted' returning number`;
      if (note_) await event(tx, id, 'credit_note', staff.name, { note: `Credit note ${note_.number} cancelled` });
      await setStatus(tx, id, from, 'cancelled', staff.name, note);
      return moved;
    });
    return c.json(await answer(id, [], stockKeysOf(touched as never)));
  });

  // The goods are back: they wait for the quality check (held), or go straight back on sale when the shop restocks
  // unopened goods. The GST credit note follows if the order was invoiced and the shop issues it on receipt.
  routes.post('/:id/receive', jsonBody(z.object({ version: Version, note: Text(500).default('') })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const { version, note } = c.req.valid('json');
    const staff = c.get('staff');
    const items = await sql.begin(async (tx) => {
      const settings = await returnSettings(tx);
      need(settings, staff.role, 'receive');
      const ret = await lockReturn(tx, id, version);
      if (GOODS_BACK.includes(ret.status)) throw new HTTPException(409, { message: `The goods for ${ret.number} are already received.` });
      if (ret.status !== 'approved') throw new HTTPException(409, { message: `${ret.number} is ${LABEL[ret.status]}; it needs approving before the goods come in.` });
      const items = await tx`select position, product_id, option_label, qty::float8 as qty, condition from sales_return_items where return_id = ${id} order by product_id, option_label, position`;
      for (const item of items) {
        const direct = settings.restockRule === 'unopened' && item.condition === 'unopened';
        await move(tx, { productId: item.product_id, option: item.option_label }, item.qty, { kind: 'return_received', bucket: direct ? 'available' : 'held', returnId: id, reason: ret.number, by: staff.name });
        if (direct)
          await tx`update sales_return_items set outcome = 'restock', outcome_note = 'Unopened: back on sale as it came in.', inspected_by = ${staff.name}, inspected_at = now() where return_id = ${id} and position = ${item.position}`;
      }
      const checked = items.every((item) => settings.restockRule === 'unopened' && item.condition === 'unopened');
      await tx`update sales_returns set status = ${checked ? 'inspected' : 'received'}, version = version + 1, updated_at = now() where id = ${id}`;
      await event(tx, id, 'received', staff.name, { from: 'approved', to: checked ? 'inspected' : 'received', note });
      const gstFollows = ret.invoice_id && (ret.kind === 'refund' || settings.replacementTax === 'invoice');
      if (gstFollows && settings.creditNoteOnReceipt) await issueCreditNote(tx, id, staff.name);
      if (checked) await advance(tx, id, staff.name);
      return items;
    });
    return c.json(await answer(id, [], stockKeysOf(items as never)));
  });

  // The quality check, item by item: back on sale, damaged or defective stock, or written off.
  const Inspect = z.object({
    version: Version,
    items: z
      .array(z.object({ position: z.number().int().min(0), outcome: z.enum(OUTCOMES, 'Choose where it goes.'), note: Text(300).default('') }))
      .min(1, 'Choose where each item goes.')
      .max(500),
  });
  routes.post('/:id/inspect', jsonBody(Inspect), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const input = c.req.valid('json');
    const staff = c.get('staff');
    const touched = await sql.begin(async (tx) => {
      const settings = await returnSettings(tx);
      need(settings, staff.role, 'inspect');
      const ret = await lockReturn(tx, id, input.version);
      if (!['received', 'inspected', 'refunded', 'replaced'].includes(ret.status)) throw new HTTPException(409, { message: `${ret.number} is ${LABEL[ret.status]}; its goods are checked once they’re received.` });
      const rows = await tx`select position, product_id, option_label, description, qty::float8 as qty, condition, outcome, inspected_by from sales_return_items where return_id = ${id}`;
      const byPosition = new Map(rows.map((row) => [row.position as number, row]));
      const done: string[] = [];
      for (const [index, pick] of input.items.entries()) {
        const item = byPosition.get(pick.position);
        if (!item) throw new HTTPException(400, { message: 'That item isn’t on this return.', cause: { field: `items.${index}` } });
        if (item.outcome) throw new HTTPException(409, { message: `${item.description} was already checked by ${item.inspected_by}.`, cause: { field: `items.${index}` } });
        // Goods that came back damaged or not whole go back on sale only on someone's word.
        if (pick.outcome === 'restock' && ['damaged', 'defective', 'used', 'incomplete'].includes(item.condition) && !pick.note)
          throw new HTTPException(400, { message: `${item.description} came back ${item.condition}. Say why it can go back on sale.`, cause: { field: `items.${index}.note` } });
      }
      const steps = input.items.map((pick) => ({ pick, item: byPosition.get(pick.position)! })).sort((a, b) => key(a.item.product_id, a.item.option_label).localeCompare(key(b.item.product_id, b.item.option_label)));
      for (const { pick, item } of steps) {
        const target: Bucket | null = pick.outcome === 'restock' ? 'available' : pick.outcome === 'write_off' ? null : pick.outcome === 'damaged' && settings.damagedHandling === 'write_off' ? null : pick.outcome;
        const stockItem = { productId: item.product_id, option: item.option_label };
        await move(tx, stockItem, -item.qty, { kind: target ? 'return_inspected' : 'written_off', bucket: 'held', returnId: id, reason: ret.number, note: pick.note, by: staff.name });
        if (target) await move(tx, stockItem, item.qty, { kind: 'return_inspected', bucket: target, returnId: id, reason: ret.number, note: pick.note, by: staff.name });
        await tx`update sales_return_items set outcome = ${pick.outcome}, outcome_note = ${pick.note}, inspected_by = ${staff.name}, inspected_at = now() where return_id = ${id} and position = ${pick.position}`;
        done.push(`${item.description}: ${pick.outcome.replace('_', ' ')}`);
      }
      const [left] = await tx`select count(*)::int as count from sales_return_items where return_id = ${id} and outcome is null`;
      const to = ret.status === 'received' && !left!.count ? 'inspected' : ret.status;
      await tx`update sales_returns set status = ${to}, version = version + 1, updated_at = now() where id = ${id}`;
      await event(tx, id, 'inspected', staff.name, { from: ret.status, to, note: done.join('; ') });
      if (to === 'inspected') await advance(tx, id, staff.name);
      return steps.map(({ item }) => item);
    });
    return c.json(await answer(id, [], stockKeysOf(touched as never)));
  });

  // The goods given in exchange leave stock (never below zero unless the shop allows it). For an invoiced order the
  // replacement's tax invoice starts as a draft, to post from GST.
  routes.post('/:id/replace', jsonBody(z.object({ version: Version, note: Text(500).default('') })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const { version, note } = c.req.valid('json');
    const staff = c.get('staff');
    const items = await sql.begin(async (tx) => {
      const settings = await returnSettings(tx);
      need(settings, staff.role, 'receive');
      const ret = await lockReturn(tx, id, version);
      if (ret.kind !== 'replacement') throw new HTTPException(400, { message: `${ret.number} is a refund, not a replacement.` });
      if (ret.status === 'replaced' || ret.status === 'closed') throw new HTTPException(409, { message: `The replacement for ${ret.number} has already been given.` });
      if (!['received', 'inspected'].includes(ret.status)) throw new HTTPException(409, { message: `${ret.number} is ${LABEL[ret.status]}; the replacement goes out once the goods are back.` });
      const items = await tx`
        select product_id, option_label, min(description) as description, sum(qty)::float8 as qty, min(unit) as unit
        from replacement_items where return_id = ${id} group by 1, 2 order by 1, 2`;
      // The counted items are locked first, in the same order everywhere, so two replacements at once can't both take the last one.
      const counted = await tx`
        select s.product_id, s.option_label, s.quantity::float8 as stock from stock_items s
        where exists (select 1 from replacement_items i where i.return_id = ${id} and i.product_id = s.product_id and i.option_label = s.option_label)
        order by 1, 2 for update`;
      const inStock = new Map(counted.map((row) => [key(row.product_id, row.option_label), row.stock as number]));
      for (const item of items) {
        const stock = inStock.get(key(item.product_id, item.option_label));
        if (stock !== undefined && stock < item.qty && !settings.allowNegativeStock)
          throw new HTTPException(409, { message: `Only ${stock} ${item.unit} of ${item.description} in stock. Restock it, or allow negative stock under Return Settings.` });
        await move(tx, { productId: item.product_id, option: item.option_label }, -item.qty, { kind: 'replacement', returnId: id, reason: ret.number, by: staff.name });
      }
      await setStatus(tx, id, ret.status, 'replaced', staff.name, note);
      await event(tx, id, 'replaced', staff.name, { note: items.map((item) => `${item.qty} ${item.unit} ${item.description}`).join(', ') });
      if (ret.invoice_id && settings.replacementTax === 'invoice') {
        const [original] = await tx`select customer_name, customer_gstin, billing_address, place_of_supply, details from sales_invoices where id = ${ret.invoice_id}`;
        const lines = await tx`
          select product_id, option_label, description, name, hsn, qty::float8 as qty, unit, rate::float8 as rate, discount_pct::float8 as discount, gst_rate::float8 as gst
          from replacement_items where return_id = ${id} order by position`;
        const today = isoDay(new Date());
        const [draft] = await tx`insert into sales_invoices ${tx({ order_id: ret.order_id, invoice_date: today, customer_name: original!.customer_name, created_by: staff.name, return_id: id })} returning id`;
        await saveDraft(tx, draft!.id as number, {
          invoiceDate: today,
          customerName: original!.customer_name,
          customerGstin: original!.customer_gstin,
          billingAddress: original!.billing_address,
          placeOfSupply: original!.place_of_supply,
          notes: `Replacement against return ${ret.number}.`,
          details: original!.details ?? {},
          items: lines.map((line) => ({ productId: line.product_id, option: line.option_label, description: line.description, detail: line.name, hsn: line.hsn, qty: line.qty, unit: line.unit, rate: line.rate, discountPct: line.discount, gstRate: line.gst })),
        });
        await event(tx, id, 'note', staff.name, { note: 'Replacement tax invoice drafted: post it from the Sales Register.' });
      }
      return items;
    });
    return c.json(await answer(id, [], stockKeysOf(items as never)));
  });

  // The credit note by hand, when the shop doesn't issue it on receipt.
  routes.post('/:id/credit-note', jsonBody(z.object({ version: Version })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const staff = c.get('staff');
    await sql.begin(async (tx) => {
      need(await returnSettings(tx), staff.role, 'approve');
      const ret = await lockReturn(tx, id, c.req.valid('json').version);
      if (!GOODS_BACK.includes(ret.status)) throw new HTTPException(409, { message: `A credit note follows the goods coming back; ${ret.number} is ${LABEL[ret.status]}.` });
      await issueCreditNote(tx, id, staff.name);
      await bump(tx, id);
    });
    return c.json(await answer(id));
  });

  routes.post('/credit-notes/:noteId/cancel', owners, jsonBody(z.object({ reason: Text(300).min(1, 'Give the reason for cancelling.') })), async (c) => {
    const noteId = parse(Id, c.req.param('noteId'));
    const staff = c.get('staff');
    const id = await sql.begin(async (tx) => {
      const [note] = await tx`select return_id, number, status from sales_credit_notes where id = ${noteId} for update`;
      if (!note) throw new HTTPException(404, { message: 'That credit note does not exist.' });
      if (note.status !== 'posted') throw new HTTPException(409, { message: `${note.number} is already cancelled.` });
      await lockReturn(tx, note.return_id);
      await tx`update sales_credit_notes set status = 'cancelled', cancelled_by = ${staff.name}, cancelled_at = now(), cancel_reason = ${c.req.valid('json').reason} where id = ${noteId}`;
      await event(tx, note.return_id, 'credit_note', staff.name, { note: `Credit note ${note.number} cancelled: ${c.req.valid('json').reason}` });
      await bump(tx, note.return_id);
      return note.return_id as number;
    });
    return c.json(await answer(id));
  });

  // Internal notes and attachments can be added at any step; nothing is removed.
  routes.post('/:id/notes', jsonBody(z.object({ note: Text(1000).default(''), attachments: z.array(z.string().regex(MEDIA, 'Upload photos or PDFs.')).max(20).default([]) })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const { note, attachments } = c.req.valid('json');
    if (!note && !attachments.length) throw new HTTPException(400, { message: 'Write a note or attach a file.', cause: { field: 'note' } });
    const staff = c.get('staff');
    await sql.begin(async (tx) => {
      await lockReturn(tx, id);
      if (attachments.length) {
        await tx`update sales_returns set attachments = attachments || ${attachments}::text[] where id = ${id}`;
        await event(tx, id, 'attachment', staff.name, { note: `${attachments.length} file${attachments.length === 1 ? '' : 's'} attached` });
      }
      if (note) await event(tx, id, 'note', staff.name, { note });
      await bump(tx, id);
    });
    return c.json(await answer(id));
  });

  // Money for a return: a refund out (cash, UPI, bank, cheque, the original method, store credit, or set against one of
  // the customer's orders), or the difference collected in for a dearer replacement. Never more than is owed either way.
  const RefundInput = z
    .object({
      version: Version,
      direction: z.enum(['out', 'in']).default('out'),
      amount: z.number('Enter the amount in rupees.').int('Enter whole rupees.').positive('Enter an amount above ₹0.').max(MAX_RUPEES, 'Enter ₹10 crore or less.'),
      method: z.enum(REFUND_METHODS, 'Choose how it’s paid.'),
      orderId: Id.nullable().default(null),
      reference: Text(100).default(''),
      paidOn: Day('day it was paid').nullable().default(null),
      note: Text(300).default(''),
      /** Paid already: recorded as completed rather than pending. */
      complete: z.boolean().default(false),
    })
    .refine((input) => input.direction === 'out' || (MONEY_METHODS as readonly string[]).includes(input.method), { message: 'Choose cash, UPI, bank transfer or cheque.', path: ['method'] })
    .refine((input) => input.method !== 'adjustment' || input.orderId !== null, { message: 'Choose the order it pays.', path: ['orderId'] });
  routes.post('/:id/refunds', jsonBody(RefundInput), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const input = c.req.valid('json');
    const staff = c.get('staff');
    const orderIds = await sql.begin(async (tx) => {
      const settings = await returnSettings(tx);
      need(settings, staff.role, 'refund');
      const ret = await lockReturn(tx, id, input.version);
      if (!['received', 'inspected', 'refunded', 'replaced'].includes(ret.status)) throw new HTTPException(409, { message: `${ret.number} is ${LABEL[ret.status]}. Money is settled once the goods are back.` });
      if (input.direction === 'out' && !settings.refundMethods.includes(input.method)) throw new HTTPException(400, { message: 'That refund method is turned off under Return Settings.', cause: { field: 'method' } });
      const sums = await money(tx, id);
      if (input.direction === 'out') {
        if (ret.settle_amount <= 0) throw new HTTPException(400, { message: `Nothing is owed to the customer on ${ret.number}.`, cause: { field: 'amount' } });
        if (sums.booked_out + input.amount > ret.settle_amount)
          throw new HTTPException(400, { message: `That’s more than is left to refund (${rupees(ret.settle_amount - sums.booked_out)}).`, cause: { field: 'amount' } });
      } else {
        if (ret.settle_amount >= 0) throw new HTTPException(400, { message: `The customer owes nothing on ${ret.number}.`, cause: { field: 'amount' } });
        if (sums.booked_in + input.amount > -ret.settle_amount)
          throw new HTTPException(400, { message: `That’s more than is left to collect (${rupees(-ret.settle_amount - sums.booked_in)}).`, cause: { field: 'amount' } });
      }
      if (input.method === 'store_credit' && !ret.customer_id) throw new HTTPException(400, { message: 'This order has no customer record to hold store credit.', cause: { field: 'method' } });
      if (input.method === 'adjustment') {
        const [order] = await tx`
          select o.id, coalesce((select merged_into from customers where id = d.customer_id), d.customer_id) as customer_id
          from orders o join app_devices d on d.id = o.device_id where o.id = ${input.orderId}`;
        if (!order || order.customer_id !== ret.customer_id) throw new HTTPException(400, { message: 'Choose one of this customer’s orders.', cause: { field: 'orderId' } });
      }
      const complete = input.complete && !(settings.refundApproval && input.direction === 'out' && !can(settings, staff.role, 'approve'));
      if (input.complete && !complete) throw new HTTPException(403, { message: 'Refunds need approval first (Return Settings). Record it as pending for someone who approves.' });
      const [refund] = await tx`
        insert into refund_transactions ${tx({
          return_id: id,
          direction: input.direction,
          amount: input.amount,
          method: input.method,
          order_id: input.method === 'adjustment' ? input.orderId : null,
          reference: input.reference,
          paid_on: input.paidOn,
          note: input.note,
          created_by: staff.name,
          ...(complete && settings.refundApproval && input.direction === 'out' ? { approved_by: staff.name, approved_at: new Date() } : {}),
        })} returning id, return_id, amount, method, order_id`;
      if (complete) await completeRefund(tx, refund as never, ret as never, staff.name, input.paidOn ?? isoDay(new Date()));
      await event(tx, id, 'refund', staff.name, {
        note: `${input.direction === 'out' ? 'Refund' : 'Collected'} ${rupees(input.amount)} · ${input.method.replace('_', ' ')}${input.reference ? ` · ${input.reference}` : ''} · ${complete ? 'completed' : 'pending'}`,
      });
      await bump(tx, id);
      await advance(tx, id, staff.name);
      return input.method === 'adjustment' && complete ? [input.orderId!] : [];
    });
    return c.json(await answer(id, orderIds), 201);
  });

  // A refund's own steps: approve (when refunds need approval), processing, completed, failed, cancelled, or retried.
  const REFUND_MOVES: Record<string, string[]> = {
    pending: ['approved', 'processing', 'completed', 'failed', 'cancelled'],
    approved: ['processing', 'completed', 'failed', 'cancelled'],
    processing: ['completed', 'failed'],
    failed: ['pending', 'cancelled'],
  };
  routes.post(
    '/refunds/:refundId/status',
    jsonBody(z.object({ to: z.enum(['approved', 'processing', 'completed', 'failed', 'cancelled', 'pending']), reference: Text(100).optional(), paidOn: Day('day it was paid').nullable().default(null), note: Text(300).default('') })),
    async (c) => {
      const refundId = parse(Id, c.req.param('refundId'));
      const { to, reference, paidOn, note } = c.req.valid('json');
      const staff = c.get('staff');
      const [found] = await sql`select return_id from refund_transactions where id = ${refundId}`;
      if (!found) throw new HTTPException(404, { message: 'That refund does not exist.' });
      const orderIds = await sql.begin(async (tx) => {
        const settings = await returnSettings(tx);
        // The return first, then its refund: the same order everywhere, so two changes at once wait rather than deadlock.
        const ret = await lockReturn(tx, found.return_id);
        const [refund] = await tx`select id, return_id, direction, amount, method, order_id, status from refund_transactions where id = ${refundId} for update`;
        const from = refund!.status as string;
        if (from === to) throw new HTTPException(409, { message: `That refund is already ${to}.` });
        if (!REFUND_MOVES[from]?.includes(to)) throw new HTTPException(409, { message: `That refund is ${from}, so it can’t be marked ${to}.` });
        need(settings, staff.role, to === 'approved' ? 'approve' : 'refund');
        const needsApproval = settings.refundApproval && refund!.direction === 'out';
        if (needsApproval && from === 'pending' && (to === 'processing' || to === 'completed') && !can(settings, staff.role, 'approve'))
          throw new HTTPException(403, { message: 'This refund needs approving first.' });
        if (to === 'completed') await completeRefund(tx, refund as never, ret as never, staff.name, paidOn ?? isoDay(new Date()));
        else
          await tx`
            update refund_transactions set status = ${to}, updated_at = now(),
              approved_by = ${to === 'approved' ? staff.name : tx`approved_by`}, approved_at = ${to === 'approved' ? tx`now()` : tx`approved_at`}
            where id = ${refundId}`;
        if (needsApproval && from === 'pending' && to === 'completed') await tx`update refund_transactions set approved_by = ${staff.name}, approved_at = now() where id = ${refundId}`;
        if (reference !== undefined) await tx`update refund_transactions set reference = ${reference} where id = ${refundId}`;
        await event(tx, ret.id, 'refund', staff.name, { note: `${refund!.direction === 'out' ? 'Refund' : 'Collection'} of ${rupees(refund!.amount)}: ${from} → ${to}${note ? ` · ${note}` : ''}` });
        await bump(tx, ret.id);
        await advance(tx, ret.id, staff.name);
        return to === 'completed' && refund!.method === 'adjustment' ? [refund!.order_id as number] : [];
      });
      return c.json(await answer(found.return_id, orderIds));
    },
  );

  return routes;
}
