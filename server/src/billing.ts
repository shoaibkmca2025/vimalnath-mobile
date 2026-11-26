import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  GST_STATES,
  InvoiceDraftSchema,
  cancelInvoice,
  computeInvoice,
  customerBalance,
  financialYear,
  gstSettings,
  indiaDay,
  invoiceNumber,
  invoices,
  postInvoice,
  r2,
  saveDraft,
  stateCode,
  type InvoiceDraftInput,
} from './gst.ts';
import { actorOf, assessDiscounts, type Actor } from './discounts.ts';
import { only, type Env, type Role } from './staff.ts';
import { stockItems } from './stock.ts';
import { jsonBody, parse } from './validate.ts';

/**
 * Custom billing (docs/ERP-ROADMAP.md): counter bills made in the admin without an app order. Each is a tax invoice in
 * the shop's one series (server/src/gst.ts saves, posts and cancels them, so the registers, GSTR-1, credit notes and
 * reports count them like any other); here are the steps around them: customers, payments against the bill, the audit
 * log, duplicating, reopening a posted bill to correct it, quotations, units, and how bills look.
 */

const METHODS = ['cash', 'upi', 'bank', 'cheque', 'card'] as const;
const DAY = 86_400_000;
const MEDIA = /^\/v1\/media\/[a-f0-9]{24}\.webp$/;
const Id = z.coerce.number().int().positive().max(2147483647);
const Text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer.`);
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const Day = (label: string, future = false) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Pick the ${label}.`)
    .refine((day) => !Number.isNaN(Date.parse(day)) && isoDay(new Date(day)) === day, `Pick the ${label}.`)
    .refine((day) => day >= '2000-01-01', 'Pick a day from 2000 on.')
    .refine((day) => future || day <= isoDay(new Date(Date.now() + DAY)), 'The day can’t be in the future.');
const Version = z.number('Reload the page and try again.').int().positive();
const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;
const MAKERS: Role[] = ['owner', 'sales'];

// ---------- Settings and units ----------

const BillingSettings = z.object({
  legalName: Text(150).min(1, 'Enter the business name.'),
  tradeName: Text(150).default(''),
  address: Text(500).default(''),
  pincode: Text(6).regex(/^(\d{6})?$/, 'Enter the 6-digit PIN code.').default(''),
  phone: Text(60).default(''),
  email: Text(120).default(''),
  bankName: Text(100).default(''),
  bankAccount: Text(40).default(''),
  bankBranchIfsc: Text(120).default(''),
  terms: Text(1000).default(''),
  declaration: Text(500).default(''),
  jurisdiction: Text(100).default(''),
  heading: Text(40).default(''),
  footer: Text(300).default(''),
  logo: z.string().regex(MEDIA, 'Upload the logo as a photo.').nullable().default(null),
  signature: z.string().regex(MEDIA, 'Upload the signature as a photo.').nullable().default(null),
  themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a colour.'),
  paperSize: z.enum(['A4', 'A5', 'thermal'], 'Choose a paper size.'),
  template: z.enum(['classic', 'modern', 'compact'], 'Choose a design.'),
  dueDays: z.number('Enter the days as a number.').int('Enter whole days.').min(0).max(365, 'Use 365 days or fewer.'),
  pricesIncludeGst: z.boolean(),
  allowNegativeStock: z.boolean(),
  quotationDays: z.number().int('Enter whole days.').min(1, 'Enter 1 day or more.').max(365, 'Use 365 days or fewer.'),
});

/** How bills look and behave, with the shop's details they print. Everyone who bills reads it. */
export async function billingSettings(sql: Sql | TransactionSql) {
  const [row] = await sql`
    select legal_name as "legalName", trade_name as "tradeName", gstin, address, pincode, phone, email, registration_type as "registrationType",
      invoice_prefix as "invoicePrefix", bank_name as "bankName", bank_account as "bankAccount", bank_branch_ifsc as "bankBranchIfsc",
      terms, declaration, jurisdiction, invoice_heading as heading, invoice_footer as footer, invoice_logo as logo, signature,
      theme_color as "themeColor", paper_size as "paperSize", invoice_template as template, bill_due_days as "dueDays",
      prices_include_gst as "pricesIncludeGst", allow_negative_stock as "allowNegativeStock", quotation_days as "quotationDays",
      updated_by as "updatedBy", updated_at as "updatedAt"
    from gst_settings`;
  return row!;
}
const unitsOf = (sql: Sql | TransactionSql) =>
  sql`select code, label, print, built_in as "builtIn" from measurement_units order by sort_order, label`;

// ---------- Bills ----------

/** A counter bill as the editor sends it: an invoice draft, with its version once it exists. */
const Bill = InvoiceDraftSchema;
const BillChange = InvoiceDraftSchema.extend({ version: Version });

/**
 * A walk-in buyer without a GSTIN or a state is in the shop's own state (CGST + SGST), so a counter bill always has a
 * place of supply.
 */
async function withPlace(tx: TransactionSql, input: z.output<typeof Bill>): Promise<InvoiceDraftInput> {
  if (input.customerGstin || input.placeOfSupply) return input;
  const own = stateCode((await gstSettings(tx)).gstin);
  return { ...input, placeOfSupply: own ? GST_STATES[own]! : '' };
}

const event = (tx: TransactionSql, id: number, kind: string, by: string, details: { note?: string; before?: unknown; after?: unknown } = {}) =>
  tx`insert into invoice_events ${tx({
    invoice_id: id,
    kind,
    note: details.note ?? '',
    before: details.before === undefined ? null : (tx.json(details.before as never) as never),
    after: details.after === undefined ? null : (tx.json(details.after as never) as never),
    by,
  })}`;

/** What an edit is recorded as: the parts staff check when they look back. */
async function snapshot(tx: TransactionSql, id: number) {
  const [row] = await tx`
    select i.invoice_date::text as date, i.customer_name as customer, i.total::float8 as total, i.bill_discount::float8 as discount,
      (select json_agg(json_build_object('item', l.description, 'qty', l.qty::float8, 'unit', l.unit, 'rate', l.rate::float8, 'gst', l.gst_rate::float8) order by l.position)
        from sales_invoice_items l where l.invoice_id = i.id) as lines
    from sales_invoices i where i.id = ${id}`;
  return row;
}

/** Locks a counter bill for a change, refusing one decided on an out-of-date screen or one that isn't a counter bill. */
async function lockBill(tx: TransactionSql, id: number, version?: number) {
  type Locked = { id: number; number: string | null; status: string; version: number; order_id: number | null; return_id: number | null; customer_id: number | null; total: number; financial_year: string | null };
  const [row] = await tx<Locked[]>`select id, number, status, version, order_id, return_id, customer_id, total::float8 as total, financial_year from sales_invoices where id = ${id} for update`;
  if (!row) throw new HTTPException(404, { message: 'That bill does not exist.' });
  if (version !== undefined && row.version !== version) {
    const [last] = await tx`select by from invoice_events where invoice_id = ${id} order by id desc limit 1`;
    throw new HTTPException(409, { message: `${row.number ?? 'This bill'} was just changed${last ? ` by ${last.by}` : ''}. Reload to see what changed, then try again.` });
  }
  return row;
}
const counterOnly = (row: { order_id: number | null; return_id: number | null; number: string | null }) => {
  if (row.order_id !== null || row.return_id !== null)
    throw new HTTPException(409, { message: `${row.number ?? 'This invoice'} belongs to an order: change it from the Sales Register, and record its payments on the order.` });
};

/** A new counter bill draft, with its lines; returns its id. */
async function createBill(tx: TransactionSql, input: InvoiceDraftInput, by: string, actor: Actor, extra: { duplicateOf?: number; quotationId?: number } = {}) {
  const [row] = await tx`
    insert into sales_invoices ${tx({
      order_id: null,
      invoice_date: input.invoiceDate,
      customer_name: input.customerName,
      created_by: by,
      duplicate_of: extra.duplicateOf ?? null,
      quotation_id: extra.quotationId ?? null,
    })} returning id`;
  await saveDraft(tx, row!.id as number, input, actor);
  return row!.id as number;
}

/** A bill's lines as a draft takes them, for duplicating one or converting a quotation. */
const linesOf = (rows: Record<string, unknown>[]) =>
  rows.map((line) => ({
    productId: line.product_id as string,
    option: line.option_label as string,
    description: line.description as string,
    detail: line.detail as string,
    sku: line.sku as string,
    hsn: line.hsn as string,
    qty: Number(line.qty),
    unit: line.unit as string,
    rate: Number(line.rate),
    discountPct: Number(line.discount_pct),
    discountAmount: Number(line.discount_amount),
    lineType: line.line_type as 'goods' | 'charge',
    gstRate: Number(line.gst_rate),
  }));

// ---------- Quotations ----------

const Quotation = InvoiceDraftSchema.extend({ validUntil: Day('valid-until date', true).nullable().default(null) });

/** Quotations in the admin's shape, with their lines. */
export const quotations = (sql: Sql | TransactionSql, where = sql`true`) =>
  sql`
    select json_strip_nulls(json_build_object(
      'id', q.id::text, 'number', q.number, 'quoteDate', q.quote_date, 'validUntil', q.valid_until, 'status', q.status,
      'customerId', q.customer_id, 'customerName', q.customer_name, 'customerPhone', nullif(q.customer_phone, ''),
      'customerGstin', nullif(q.customer_gstin, ''), 'billingAddress', nullif(q.billing_address, ''), 'placeOfSupply', q.place_of_supply,
      'posCode', q.pos_code, 'interstate', q.interstate, 'pricesIncludeGst', q.prices_include_gst, 'billDiscount', q.bill_discount::float8,
      'billDiscountPct', q.bill_discount_pct::float8, 'taxable', q.taxable::float8, 'cgst', q.cgst::float8, 'sgst', q.sgst::float8,
      'igst', q.igst::float8, 'roundOff', q.round_off::float8, 'total', q.total::float8, 'notes', nullif(q.notes, ''),
      'invoiceId', q.invoice_id::text, 'invoiceNumber', (select i.number from sales_invoices i where i.id = q.invoice_id),
      'version', q.version, 'createdBy', q.created_by, 'createdAt', q.created_at, 'updatedAt', q.updated_at,
      'items', (select json_agg(json_build_object('productId', l.product_id, 'option', l.option_label, 'description', l.description,
          'detail', l.detail, 'sku', l.sku, 'hsn', l.hsn, 'qty', l.qty::float8, 'unit', l.unit, 'rate', l.rate::float8,
          'discountPct', l.discount_pct::float8, 'discountAmount', l.discount_amount::float8, 'lineType', l.line_type,
          'amount', l.amount::float8, 'billDiscount', l.bill_discount::float8, 'gstRate', l.gst_rate::float8, 'taxable', l.taxable::float8,
          'cgst', l.cgst::float8, 'sgst', l.sgst::float8, 'igst', l.igst::float8) order by l.position)
        from quotation_items l where l.quotation_id = q.id)
    )) as quotation
    from quotations q where ${where}
    order by q.quote_date desc, q.id desc`.then((rows) => rows.map((row) => row.quotation));

/** Saves a quotation's header, lines and figures, worked out as an invoice's are. */
async function saveQuotation(tx: TransactionSql, id: number, input: z.output<typeof Quotation>) {
  const settings = await gstSettings(tx);
  const own = stateCode(settings.gstin);
  const pos = stateCode(input.customerGstin, input.placeOfSupply) || own;
  const interstate = Boolean(own && pos && own !== pos);
  const units = new Set((await tx`select code from measurement_units`).map((row) => row.code as string));
  input.items.forEach((item, index) => {
    if (!units.has(item.unit)) throw new HTTPException(400, { message: `“${item.unit}” isn’t one of the shop’s units.`, cause: { field: `items.${index}.unit` } });
  });
  const composition = settings.registrationType === 'composition';
  const figures = computeInvoice(composition ? input.items.map((item) => ({ ...item, gstRate: 0 })) : input.items, interstate, {
    inclusive: input.pricesIncludeGst ?? false,
    billDiscount: input.billDiscount ?? 0,
  });
  // The same discount limits as a bill; approval waits until it becomes one.
  const discounts = await assessDiscounts(tx, figures.lines, { day: input.invoiceDate, inclusive: input.pricesIncludeGst ?? false });
  const refused = discounts.findIndex((line) => line.problem);
  if (refused >= 0) throw new HTTPException(400, { message: discounts[refused]!.problem!, cause: { field: `items.${refused}.discountPct` } });
  await tx`
    update quotations set ${tx({
      quote_date: input.invoiceDate,
      valid_until: input.validUntil,
      customer_id: input.customerId ?? null,
      customer_name: input.customerName,
      customer_phone: input.customerPhone ?? '',
      customer_gstin: input.customerGstin,
      billing_address: input.billingAddress,
      place_of_supply: pos ? GST_STATES[pos]! : input.placeOfSupply,
      pos_code: pos,
      interstate,
      prices_include_gst: input.pricesIncludeGst ?? false,
      bill_discount: figures.billDiscount,
      bill_discount_pct: input.billDiscountPct ?? null,
      taxable: figures.taxable,
      cgst: figures.cgst,
      sgst: figures.sgst,
      igst: figures.igst,
      round_off: figures.roundOff,
      total: figures.total,
      notes: input.notes,
    })}, version = version + 1, updated_at = now() where id = ${id}`;
  await tx`delete from quotation_items where quotation_id = ${id}`;
  await tx`
    insert into quotation_items ${tx(
      figures.lines.map((line, position) => ({
        quotation_id: id,
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
        category_id: discounts[position]!.categoryId,
        discount_rule_id: discounts[position]!.ruleId,
        discount_source: discounts[position]!.source,
        rule_type: discounts[position]!.ruleType,
        rule_min: discounts[position]!.ruleMin,
        rule_max: discounts[position]!.ruleMax,
        discount_value: discounts[position]!.value,
        effective_pct: discounts[position]!.effectivePct,
      })),
    )}`;
}

// ---------- Routes ----------

/** /v1/admin/billing. Owners and Sales make bills; the Accountant reads them and voids payments. */
export function billingRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner', 'sales', 'accountant'));
  const makers = only(...MAKERS);
  const owners = only('owner');

  // Purchase prices only for Owners, as everywhere.
  const answer = async (id: number, moved: { productId: string; option: string }[] = [], owner = false) => ({
    invoices: await invoices(sql, sql`i.id = ${id}`),
    stock: moved.length
      ? await stockItems(
          sql,
          owner,
          sql`exists (select 1 from jsonb_to_recordset(${sql.json(moved.map(({ productId, option }) => ({ productId, option })))}) as k("productId" text, option text) where k."productId" = s.product_id and k.option = s.option_label)`,
        )
      : [],
  });

  routes.get('/settings', async (c) => {
    const year = financialYear(indiaDay());
    const [counter] = await sql`select last_number from invoice_counters where series = 'invoice' and financial_year = ${year}`;
    return c.json({ settings: await billingSettings(sql), units: await unitsOf(sql), financialYear: year, lastInvoiceNumber: counter?.last_number ?? 0 });
  });

  routes.put('/settings', owners, jsonBody(BillingSettings), async (c) => {
    const input = c.req.valid('json');
    await sql`
      update gst_settings set ${sql({
        legal_name: input.legalName,
        trade_name: input.tradeName,
        address: input.address,
        pincode: input.pincode,
        phone: input.phone,
        email: input.email,
        bank_name: input.bankName,
        bank_account: input.bankAccount,
        bank_branch_ifsc: input.bankBranchIfsc,
        terms: input.terms,
        declaration: input.declaration,
        jurisdiction: input.jurisdiction,
        invoice_heading: input.heading,
        invoice_footer: input.footer,
        invoice_logo: input.logo,
        signature: input.signature,
        theme_color: input.themeColor,
        paper_size: input.paperSize,
        invoice_template: input.template,
        bill_due_days: input.dueDays,
        prices_include_gst: input.pricesIncludeGst,
        allow_negative_stock: input.allowNegativeStock,
        quotation_days: input.quotationDays,
        updated_by: c.get('staff').name,
      })}, updated_at = now()`;
    return c.json({ settings: await billingSettings(sql), units: await unitsOf(sql) });
  });

  // The shop's own units: a name staff pick, and what the bill prints.
  routes.post('/units', owners, jsonBody(z.object({ label: Text(20).min(1, 'Name the unit.'), print: Text(12).default('') })), async (c) => {
    const { label, print } = c.req.valid('json');
    const code = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20);
    if (!code) throw new HTTPException(400, { message: 'Use letters or numbers in the unit’s name.', cause: { field: 'label' } });
    const [clash] = await sql`select label from measurement_units where code = ${code} or upper(label) = upper(${label})`;
    if (clash) throw new HTTPException(409, { message: `${clash.label} is already a unit.`, cause: { field: 'label' } });
    await sql`insert into measurement_units ${sql({ code, label: label.toUpperCase(), print: (print || label).toUpperCase().slice(0, 12), created_by: c.get('staff').name })}`;
    return c.json({ units: await unitsOf(sql) }, 201);
  });

  routes.delete('/units/:code', owners, async (c) => {
    const code = c.req.param('code');
    const [unit] = await sql`select built_in from measurement_units where code = ${code}`;
    if (!unit) throw new HTTPException(404, { message: 'That unit has already been removed.' });
    if (unit.built_in) throw new HTTPException(409, { message: 'Built-in units stay: stock is counted in them.' });
    const [used] = await sql`
      select (select count(*) from sales_invoice_items where unit = ${code}) + (select count(*) from quotation_items where unit = ${code}) as uses`;
    if (Number(used!.uses) > 0) throw new HTTPException(409, { message: 'Bills or quotations use this unit, so it stays.' });
    await sql`delete from measurement_units where code = ${code}`;
    return c.json({ units: await unitsOf(sql) });
  });

  // Customers to bill: by name, business name, phone (last 10 digits) or GSTIN.
  routes.get('/customers', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    const like = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const digits = query.replace(/\D/g, '');
    return c.json(
      await sql`
        select c.id, c.name, c.legal_name as "legalName", c.gstin, c.billing_address as "billingAddress", c.state, c.pincode,
          coalesce(nullif(c.phone, ''), (select d.phone from app_devices d where d.customer_id = c.id and d.phone <> '' order by d.id desc limit 1), '') as phone
        from customers c
        where c.merged_into is null and (${query}::text = '' or c.name ilike ${like} or c.legal_name ilike ${like} or upper(c.gstin) = upper(${query})
          or (${digits.length >= 4} and (regexp_replace(c.phone, '\\D', '', 'g') like ${`%${digits}%`}
            or exists (select 1 from app_devices d where d.customer_id = c.id and regexp_replace(d.phone, '\\D', '', 'g') like ${`%${digits}%`}))))
        order by c.name limit 25`,
    );
  });

  // What a customer still owes across their orders and bills, for the bill editor.
  routes.get('/customers/:id/balance', async (c) => {
    return c.json({ owed: await customerBalance(sql, parse(Id, c.req.param('id'))) });
  });

  // A new customer, without duplicates: a record with the same phone (last 10 digits) or GSTIN is returned instead.
  const NewCustomer = z.object({
    name: Text(100).min(1, 'Enter the customer’s name.'),
    phone: Text(30)
      .default('')
      .refine((phone) => !phone || phone.replace(/\D/g, '').length >= 10, 'Enter a 10-digit mobile number.'),
    gstin: Text(15)
      .default('')
      .transform((gstin) => gstin.toUpperCase())
      .refine((gstin) => !gstin || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin), 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.'),
    legalName: Text(150).default(''),
    billingAddress: Text(500).default(''),
    state: Text(60).default(''),
    pincode: Text(6).regex(/^(\d{6})?$/, 'Enter the 6-digit PIN code.').default(''),
  });
  routes.post('/customers', makers, jsonBody(NewCustomer), async (c) => {
    const input = c.req.valid('json');
    const last10 = input.phone.replace(/\D/g, '').slice(-10);
    const [existing] = await sql`
      select c.id, c.name from customers c
      where c.merged_into is null and ((${input.gstin} <> '' and upper(c.gstin) = ${input.gstin})
        or (${last10.length === 10} and (right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = ${last10}
          or exists (select 1 from app_devices d where d.customer_id = c.id and right(regexp_replace(d.phone, '\\D', '', 'g'), 10) = ${last10}))))
      order by c.id limit 1`;
    if (existing) return c.json({ customer: existing, existing: true });
    const state = input.state || (input.gstin ? (GST_STATES[input.gstin.slice(0, 2)] ?? '') : '');
    const [row] = await sql`
      insert into customers ${sql({ name: input.name, phone: input.phone, gstin: input.gstin, legal_name: input.legalName, billing_address: input.billingAddress, state, pincode: input.pincode })}
      returning id, name`;
    return c.json({ customer: row, existing: false }, 201);
  });

  // shortcut: every invoice at once (order invoices too), which the billing pages filter; page it on the server past a few thousand.
  routes.get('/invoices', async (c) => c.json(await invoices(sql)));

  // One bill with its payments, history and the stock it moved.
  routes.get('/invoices/:id', async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [invoice] = await invoices(sql, sql`i.id = ${id}`);
    if (!invoice) throw new HTTPException(404, { message: 'That bill does not exist.' });
    const [payments, events, moves] = await Promise.all([
      sql`
        select id::text as id, amount::float8 as amount, method, to_char(paid_on, 'YYYY-MM-DD') as "paidOn", nullif(reference, '') as reference,
          nullif(note, '') as note, by, created_at as at, voided_by as "voidedBy", voided_at as "voidedAt", nullif(void_reason, '') as "voidReason"
        from invoice_payments where invoice_id = ${id} order by paid_on, id`,
      sql`select id::text as id, kind, nullif(note, '') as note, before, after, by, at from invoice_events where invoice_id = ${id} order by id`,
      sql`
        select m.id::text as id, m.product_id as "productId", m.option_label as option, m.change::float8 as change, m.balance::float8 as balance, m.kind, m.by, m.at
        from stock_moves m where m.invoice_id = ${id} order by m.id`,
    ]);
    return c.json({ invoice, payments, events, moves });
  });

  routes.post('/invoices', makers, jsonBody(Bill), async (c) => {
    const by = c.get('staff').name;
    const id = await sql.begin(async (tx) => {
      const id = await createBill(tx, await withPlace(tx, c.req.valid('json')), by, await actorOf(tx, c.get('staff')));
      await event(tx, id, 'created', by);
      return id;
    });
    return c.json(await answer(id), 201);
  });

  // A draft (or a bill reopened to correct) changes; the edit is logged with what it was before and after.
  routes.put('/invoices/:id', makers, jsonBody(BillChange), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const { version, ...input } = c.req.valid('json');
    const by = c.get('staff').name;
    await sql.begin(async (tx) => {
      const row = await lockBill(tx, id, version);
      counterOnly(row);
      if (row.status !== 'draft') throw new HTTPException(409, { message: `${row.number} is ${row.status}. ${row.status === 'posted' ? 'An Owner can reopen it to correct it.' : 'Duplicate it to bill again.'}` });
      // A bill that kept its number stays in that number's financial year.
      if (row.number && financialYear(input.invoiceDate) !== row.financial_year)
        throw new HTTPException(400, { message: `${row.number} is numbered in 20${row.financial_year}: its date stays in that financial year.`, cause: { field: 'invoiceDate' } });
      const before = await snapshot(tx, id);
      await saveDraft(tx, id, await withPlace(tx, input), await actorOf(tx, c.get('staff')));
      await event(tx, id, 'edited', by, { before, after: await snapshot(tx, id) });
    });
    return c.json(await answer(id));
  });

  // A draft made by mistake. One that was posted before keeps its number: it's posted again or cancelled.
  routes.delete('/invoices/:id', makers, async (c) => {
    const id = parse(Id, c.req.param('id'));
    await sql.begin(async (tx) => {
      const row = await lockBill(tx, id);
      counterOnly(row);
      if (row.status !== 'draft' || row.number) throw new HTTPException(409, { message: `${row.number ?? 'This bill'} isn’t a new draft. Cancel it instead.` });
      const [paid] = await tx`select count(*)::int as count from invoice_payments where invoice_id = ${id} and voided_at is null`;
      if (paid!.count) throw new HTTPException(409, { message: 'This draft has an advance against it. Void the payment first.' });
      await tx`update quotations set status = 'accepted', invoice_id = null where invoice_id = ${id}`;
      await tx`delete from invoice_payments where invoice_id = ${id}`;
      await tx`delete from sales_invoices where id = ${id}`;
    });
    return c.json({ removedInvoices: [String(id)] });
  });

  // Finalizing: the next number in the series (or the one it had), and the goods out of stock (postInvoice).
  routes.post('/invoices/:id/finalize', makers, jsonBody(z.object({ version: Version })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const by = c.get('staff').name;
    const moved = await sql.begin(async (tx) => {
      const row = await lockBill(tx, id, c.req.valid('json').version);
      counterOnly(row);
      const reopened = Boolean(row.number);
      const { number, moved } = await postInvoice(tx, id, by);
      await event(tx, id, 'finalized', by, { note: reopened ? `${number} posted again after correcting` : `Numbered ${number}` });
      return moved;
    });
    return c.json(await answer(id, moved, c.get('staff').role === 'owner'));
  });

  // An Owner opens a posted bill again to correct it: it keeps its number, the reason is recorded, and finalizing it
  // again moves only the stock that changed. After the month's GSTR-1 is filed, a credit note is the way instead.
  routes.post('/invoices/:id/reopen', owners, jsonBody(z.object({ version: Version, reason: z.string('Say why it’s being corrected.').trim().min(1, 'Say why it’s being corrected.').max(300) })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const { version, reason } = c.req.valid('json');
    const by = c.get('staff').name;
    await sql.begin(async (tx) => {
      const row = await lockBill(tx, id, version);
      counterOnly(row);
      if (row.status !== 'posted') throw new HTTPException(409, { message: `${row.number ?? 'This bill'} isn’t posted, so there’s nothing to reopen.` });
      const [note] = await tx`select number from sales_credit_notes where invoice_id = ${id} and status = 'posted' limit 1`;
      if (note) throw new HTTPException(409, { message: `Credit note ${note.number} stands against ${row.number}, so it can’t be reopened.` });
      await tx`update sales_invoices set status = 'draft', reopened_by = ${by}, reopened_at = now(), reopen_reason = ${reason}, version = version + 1 where id = ${id}`;
      await event(tx, id, 'reopened', by, { note: reason });
    });
    return c.json(await answer(id));
  });

  routes.post('/invoices/:id/cancel', only('owner', 'accountant'), jsonBody(z.object({ version: Version, reason: z.string('Give the reason for cancelling.').trim().min(1, 'Give the reason for cancelling.').max(300) })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const { version, reason } = c.req.valid('json');
    const by = c.get('staff').name;
    const moved = await sql.begin(async (tx) => {
      const row = await lockBill(tx, id, version);
      counterOnly(row);
      const moved = await cancelInvoice(tx, id, by, reason);
      await event(tx, id, 'cancelled', by, { note: reason });
      return moved;
    });
    return c.json(await answer(id, moved, c.get('staff').role === 'owner'));
  });

  // A new draft with the same buyer and lines, dated today: a repeat order, or a cancelled bill made again.
  routes.post('/invoices/:id/duplicate', makers, async (c) => {
    const id = parse(Id, c.req.param('id'));
    const by = c.get('staff').name;
    const copy = await sql.begin(async (tx) => {
      const [source] = await tx`select * from sales_invoices where id = ${id}`;
      if (!source) throw new HTTPException(404, { message: 'That bill does not exist.' });
      const lines = await tx`select * from sales_invoice_items where invoice_id = ${id} order by position`;
      const settings = await billingSettings(tx);
      const today = indiaDay();
      const copy = await createBill(
        tx,
        {
          invoiceDate: today,
          customerName: source.customer_name,
          customerGstin: source.customer_gstin,
          billingAddress: source.billing_address,
          placeOfSupply: source.place_of_supply,
          notes: source.notes,
          details: source.details ?? {},
          items: linesOf(lines),
          customerId: source.customer_id ?? (source.order_id ? ((await tx`select d.customer_id from orders o join app_devices d on d.id = o.device_id where o.id = ${source.order_id}`)[0]?.customer_id ?? null) : null),
          customerPhone: source.customer_phone,
          dueDate: settings.dueDays ? isoDay(new Date(Date.parse(today) + settings.dueDays * DAY)) : null,
          pricesIncludeGst: source.prices_include_gst,
          billDiscount: Number(source.bill_discount),
          billDiscountPct: source.bill_discount_pct === null ? null : Number(source.bill_discount_pct),
        },
        by,
        await actorOf(tx, c.get('staff')),
        { duplicateOf: id },
      );
      await event(tx, copy, 'duplicated', by, { note: `Copied from ${source.number ?? 'a draft'}` });
      if (source.order_id === null && source.return_id === null) await event(tx, id, 'duplicated', by, { note: 'Copied to a new draft' });
      return copy;
    });
    return c.json(await answer(copy), 201);
  });

  // Money against a counter bill: in full, in part, or in advance on a draft. Never more than the bill.
  const Payment = z.object({
    amount: z
      .number('Enter the amount in rupees.')
      .positive('Enter an amount above ₹0.')
      .max(1_000_000_000)
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'Use rupees and paise.'),
    method: z.enum(METHODS, 'Choose how they paid.'),
    paidOn: Day('day it was paid'),
    reference: Text(100).default(''),
    note: Text(300).default(''),
  });
  routes.post('/invoices/:id/payments', makers, jsonBody(Payment), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const payment = c.req.valid('json');
    const by = c.get('staff').name;
    await sql.begin(async (tx) => {
      const row = await lockBill(tx, id);
      counterOnly(row);
      if (row.status === 'cancelled') throw new HTTPException(409, { message: `${row.number} is cancelled, so it takes no payments.` });
      const [{ paid }] = (await tx`select coalesce(sum(amount), 0)::float8 as paid from invoice_payments where invoice_id = ${id} and voided_at is null`) as unknown as [{ paid: number }];
      if (r2(paid + payment.amount) > row.total)
        throw new HTTPException(400, { message: `That’s more than the bill still owes (${rupees(r2(row.total - paid))}).`, cause: { field: 'amount' } });
      await tx`insert into invoice_payments ${tx({ invoice_id: id, amount: payment.amount, method: payment.method, paid_on: payment.paidOn, reference: payment.reference, note: payment.note, by })}`;
      await tx`update sales_invoices set version = version + 1 where id = ${id}`;
      await event(tx, id, 'payment', by, { note: `${rupees(payment.amount)} by ${payment.method}${payment.reference ? ` · ${payment.reference}` : ''}${row.status === 'draft' ? ' (advance)' : ''}` });
    });
    return c.json(await answer(id), 201);
  });

  // A payment entered by mistake, or refunded, is voided with a reason; it stays on record.
  routes.post('/payments/:paymentId/void', only('owner', 'accountant'), jsonBody(z.object({ reason: z.string('Say why it’s voided.').trim().min(1, 'Say why it’s voided.').max(300) })), async (c) => {
    const paymentId = parse(Id, c.req.param('paymentId'));
    const by = c.get('staff').name;
    const id = await sql.begin(async (tx) => {
      const [payment] = await tx`select invoice_id, amount::float8 as amount, voided_at from invoice_payments where id = ${paymentId}`;
      if (!payment) throw new HTTPException(404, { message: 'That payment does not exist.' });
      await lockBill(tx, payment.invoice_id);
      if (payment.voided_at) throw new HTTPException(409, { message: 'That payment is already voided.' });
      await tx`update invoice_payments set voided_by = ${by}, voided_at = now(), void_reason = ${c.req.valid('json').reason} where id = ${paymentId}`;
      await tx`update sales_invoices set version = version + 1 where id = ${payment.invoice_id}`;
      await event(tx, payment.invoice_id, 'payment_voided', by, { note: `${rupees(payment.amount)} voided: ${c.req.valid('json').reason}` });
      return payment.invoice_id as number;
    });
    return c.json(await answer(id));
  });

  // ---------- Quotations ----------

  routes.get('/quotations', async (c) => c.json(await quotations(sql)));

  routes.post('/quotations', makers, jsonBody(Quotation), async (c) => {
    const input = c.req.valid('json');
    const by = c.get('staff').name;
    const id = await sql.begin(async (tx) => {
      const year = financialYear(input.invoiceDate);
      const [counter] = await tx`
        insert into invoice_counters (series, financial_year, last_number) values ('quotation', ${year}, 1)
        on conflict (series, financial_year) do update set last_number = invoice_counters.last_number + 1 returning last_number`;
      const [row] = await tx`
        insert into quotations ${tx({ number: invoiceNumber('QTN', year, counter!.last_number as number), financial_year: year, quote_date: input.invoiceDate, customer_name: input.customerName, created_by: by })}
        returning id`;
      await saveQuotation(tx, row!.id as number, input);
      return row!.id as number;
    });
    return c.json({ quotations: await quotations(sql, sql`q.id = ${id}`) }, 201);
  });

  const lockQuotation = async (tx: TransactionSql, id: number, version?: number) => {
    const [row] = await tx`select id, number, status, version, invoice_id from quotations where id = ${id} for update`;
    if (!row) throw new HTTPException(404, { message: 'That quotation does not exist.' });
    if (version !== undefined && row.version !== version) throw new HTTPException(409, { message: `${row.number} was just changed. Reload to see what changed, then try again.` });
    return row;
  };

  routes.put('/quotations/:id', makers, jsonBody(Quotation.extend({ version: Version })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const { version, ...input } = c.req.valid('json');
    await sql.begin(async (tx) => {
      const row = await lockQuotation(tx, id, version);
      if (!['draft', 'sent'].includes(row.status)) throw new HTTPException(409, { message: `${row.number} is ${row.status}, so it can’t change. Duplicate it as a new quotation.` });
      await saveQuotation(tx, id, input);
    });
    return c.json({ quotations: await quotations(sql, sql`q.id = ${id}`) });
  });

  const QUOTE_MOVES: Record<string, string[]> = { draft: ['sent', 'accepted', 'cancelled'], sent: ['accepted', 'expired', 'cancelled'], accepted: ['cancelled'], expired: ['sent', 'cancelled'] };
  routes.post('/quotations/:id/status', makers, jsonBody(z.object({ to: z.enum(['sent', 'accepted', 'expired', 'cancelled']), version: Version })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const { to, version } = c.req.valid('json');
    await sql.begin(async (tx) => {
      const row = await lockQuotation(tx, id, version);
      if (!QUOTE_MOVES[row.status]?.includes(to)) throw new HTTPException(409, { message: `${row.number} is ${row.status}, so it can’t be marked ${to}.` });
      await tx`update quotations set status = ${to}, version = version + 1, updated_at = now() where id = ${id}`;
    });
    return c.json({ quotations: await quotations(sql, sql`q.id = ${id}`) });
  });

  // The customer agreed: a counter bill draft with the quotation's buyer and lines, dated today, to check and finalize.
  routes.post('/quotations/:id/convert', makers, jsonBody(z.object({ version: Version })), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const by = c.get('staff').name;
    const invoiceId = await sql.begin(async (tx) => {
      const row = await lockQuotation(tx, id, c.req.valid('json').version);
      if (row.invoice_id) throw new HTTPException(409, { message: `${row.number} is already an invoice.` });
      if (!['draft', 'sent', 'accepted', 'expired'].includes(row.status)) throw new HTTPException(409, { message: `${row.number} is ${row.status}, so it can’t become an invoice.` });
      const [quote] = await tx`select * from quotations where id = ${id}`;
      const lines = await tx`select * from quotation_items where quotation_id = ${id} order by position`;
      const settings = await billingSettings(tx);
      const today = indiaDay();
      const invoiceId = await createBill(
        tx,
        {
          invoiceDate: today,
          customerName: quote!.customer_name,
          customerGstin: quote!.customer_gstin,
          billingAddress: quote!.billing_address,
          placeOfSupply: quote!.place_of_supply,
          notes: quote!.notes,
          items: linesOf(lines),
          customerId: quote!.customer_id,
          customerPhone: quote!.customer_phone,
          dueDate: settings.dueDays ? isoDay(new Date(Date.parse(today) + settings.dueDays * DAY)) : null,
          pricesIncludeGst: quote!.prices_include_gst,
          billDiscount: Number(quote!.bill_discount),
          billDiscountPct: quote!.bill_discount_pct === null ? null : Number(quote!.bill_discount_pct),
        },
        by,
        await actorOf(tx, c.get('staff')),
        { quotationId: id },
      );
      await tx`update quotations set status = 'converted', invoice_id = ${invoiceId}, version = version + 1, updated_at = now() where id = ${id}`;
      await event(tx, invoiceId, 'converted', by, { note: `From quotation ${row.number}` });
      return invoiceId;
    });
    return c.json({ ...(await answer(invoiceId)), quotations: await quotations(sql, sql`q.id = ${id}`) }, 201);
  });

  return routes;
}
