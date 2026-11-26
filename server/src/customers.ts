import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { only, type Env } from './staff.ts';
import { GSTIN } from './gst.ts';
import { jsonBody, parse } from './validate.ts';

const CustomerId = z.coerce.number().int().positive().max(2147483647);
const Name = z.string().trim().min(1, 'Enter the customer’s name.').max(100, 'Use 100 characters or fewer.');
const Tags = z
  .array(z.string().trim().min(1).max(30, 'Keep each tag under 30 characters.'))
  .max(20, 'Use 20 tags or fewer.')
  .transform((tags) => distinctTags(tags));
/** "Dealer" and "dealer" are the same tag; the first spelling is kept. */
const distinctTags = (tags: string[]) => tags.filter((tag, index) => tags.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === index);
const Note = z.string().trim().max(2000, 'Use 2,000 characters or fewer.');

/**
 * /v1/admin/customers, for Owners and Sales, and for the Accountant to see balances. Money figures leave out cancelled
 * orders, as the dashboard does.
 */
export function customerRoutes(sql: Sql) {
  const admin = new Hono<Env>();
  admin.use(only('owner', 'sales', 'accountant'));

  const customers = (where = sql`true`) => sql`
    select c.id, c.name, c.tags, c.note, c.created_at as "createdAt",
      c.gstin, c.legal_name as "legalName", c.billing_address as "billingAddress", c.state, c.pincode, c.credit_limit as "creditLimit",
      -- Contact details come from the customer's apps: each one from the newest profile that gives it, so a second
      -- phone that left the business name blank doesn't hide the one the first phone sent.
      -- A customer billed at the counter has their phone on the record itself; otherwise their app's.
      coalesce(nullif(c.phone, ''), (select d.phone from app_devices d where d.customer_id = c.id and d.phone <> '' order by d.profile_updated_at desc nulls last limit 1), '') as phone,
      coalesce((select d.business from app_devices d where d.customer_id = c.id and d.business <> '' order by d.profile_updated_at desc nulls last limit 1), '') as business,
      coalesce((select d.email from app_devices d where d.customer_id = c.id and d.email <> '' order by d.profile_updated_at desc nulls last limit 1), '') as email,
      coalesce((select d.city from app_devices d where d.customer_id = c.id and d.city <> '' order by d.profile_updated_at desc nulls last limit 1), '') as city,
      coalesce((select json_agg(json_build_object('id', d.id, 'label', d.label, 'phone', d.phone, 'lastSeenAt', d.last_seen_at, 'blocked', d.blocked) order by d.id)
        from app_devices d where d.customer_id = c.id), '[]') as "appUsers",
      s.orders, s.spent, s.open, s."firstOrder", s."lastOrder"
    from customers c
    left join lateral (
      select count(*)::int as orders,
        -- float8, not int: a big dealer's lifetime total can pass 2^31 rupees.
        coalesce(sum(o.total) filter (where o.status not in ('cancelled', 'declined', 'requested')), 0)::float8 as spent,
        (count(*) filter (where o.status in ('requested', 'placed', 'confirmed', 'packed', 'dispatched')))::int as open,
        min(o.placed_at) as "firstOrder", max(o.placed_at) as "lastOrder"
      from orders o join app_devices d on d.id = o.device_id where d.customer_id = c.id
    ) s on true
    where c.merged_into is null and ${where}
    order by c.name`;

  // A merged customer's old address still works: it shows the customer it was merged into.
  const one = async (id: number) => (await customers(sql`c.id = coalesce((select merged_into from customers where id = ${id}), ${id})`))[0];

  // shortcut: every customer at once, which the admin searches itself; page it on the server past a few thousand.
  admin.get('/', async (c) => c.json(await customers()));

  admin.get('/:id', async (c) => {
    const customer = await one(parse(CustomerId, c.req.param('id')));
    if (!customer) throw new HTTPException(404, { message: 'That customer does not exist.' });
    return c.json(customer);
  });

  // GST details for tax invoices: an empty GSTIN is an unregistered buyer.
  const Change = z
    .object({
      name: Name.optional(),
      tags: Tags.optional(),
      note: Note.optional(),
      gstin: z
        .string()
        .trim()
        .max(15)
        .transform((gstin) => gstin.toUpperCase())
        .refine((gstin) => !gstin || GSTIN.test(gstin), 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.')
        .optional(),
      legalName: z.string().trim().max(150, 'Use 150 characters or fewer.').optional(),
      billingAddress: z.string().trim().max(500, 'Use 500 characters or fewer.').optional(),
      state: z.string().trim().max(60).optional(),
      pincode: z.string().trim().regex(/^(\d{6})?$/, 'Enter the 6-digit PIN code.').optional(),
      creditLimit: z.number('Enter the limit in whole rupees.').int('Enter the limit in whole rupees.').min(0, 'Enter ₹0 or more.').max(1_000_000_000, 'Enter ₹100 crore or less.').nullable().optional(),
    })
    .refine((change) => Object.keys(change).length > 0, 'Nothing to change.');

  admin.patch('/:id', jsonBody(Change), async (c) => {
    const id = parse(CustomerId, c.req.param('id'));
    const { legalName, billingAddress, creditLimit, ...rest } = c.req.valid('json');
    const role = c.get('staff').role;
    // The credit limit is a money decision (the Owner's and the Accountant's); the rest of the profile is for Owners and Sales.
    if (creditLimit !== undefined && role !== 'owner' && role !== 'accountant') throw new HTTPException(403, { message: 'Only the Owner or the Accountant sets a credit limit.' });
    if (role === 'accountant' && (Object.keys(rest).length || legalName !== undefined || billingAddress !== undefined)) throw new HTTPException(403, { message: 'The Accountant sets the credit limit; the rest of the profile is for the Owner and Sales.' });
    const change = { ...rest, ...(legalName === undefined ? {} : { legal_name: legalName }), ...(billingAddress === undefined ? {} : { billing_address: billingAddress }), ...(creditLimit === undefined ? {} : { credit_limit: creditLimit }) };
    const [row] = await sql`update customers set ${sql(change)} where id = ${id} and merged_into is null returning id`;
    if (!row) throw new HTTPException(404, { message: 'That customer does not exist.' });
    return c.json(await one(id));
  });

  // Moves the other customer's phones, and with them their orders, here. Their tags and note are kept on this one.
  admin.post('/:id/merge', only('owner'), jsonBody(z.object({ from: CustomerId })), async (c) => {
    const id = parse(CustomerId, c.req.param('id'));
    const { from } = c.req.valid('json');
    if (from === id) throw new HTTPException(400, { message: 'Choose a different customer to merge.', cause: { field: 'from' } });
    await sql.begin(async (tx) => {
      // Locked in id order, so two merges of the same pair at once take turns instead of deadlocking.
      const pair = await tx`select id, tags, note from customers where id in (${id}, ${from}) and merged_into is null order by id for update`;
      const keep = pair.find((row) => row.id === id);
      const gone = pair.find((row) => row.id === from);
      if (!keep || !gone) throw new HTTPException(404, { message: 'One of these customers no longer exists. It may have been merged already.' });
      const tags = distinctTags([...keep.tags, ...gone.tags]).slice(0, 20);
      const note = [keep.note, gone.note].filter(Boolean).join('\n\n').slice(0, 2000);
      await tx`update app_devices set customer_id = ${id} where customer_id = ${from}`;
      // Records merged into the other one earlier now point here too, so old addresses still land somewhere.
      await tx`update customers set merged_into = ${id} where id = ${from} or merged_into = ${from}`;
      await tx`update customers set tags = ${tags}, note = ${note} where id = ${id}`;
    });
    return c.json(await one(id));
  });

  return admin;
}
