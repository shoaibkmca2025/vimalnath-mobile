import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { Day, GSTIN, Id, MEDIA, METHODS, Rupees, Text } from './purchases.ts';
import { only, type Env } from './staff.ts';
import { jsonBody, parse } from './validate.ts';

/**
 * Phase 4 (docs/ERP-ROADMAP.md): the shop's running costs. The Owner's count at once; the Accountant's wait for the
 * Owner. Pending and rejected ones can be changed or deleted; approved ones only cancelled, with a reason.
 */

export const EXPENSE_CATEGORIES = ['rent', 'electricity', 'salary', 'transport', 'maintenance', 'office', 'marketing', 'other'] as const;

const ExpenseInput = z
  .object({
    spentOn: Day('day it was paid'),
    category: z.enum(EXPENSE_CATEGORIES, 'Choose a category.'),
    description: Text(300).min(1, 'Say what it was for.'),
    paidTo: Text(150).default(''),
    amount: Rupees('amount').refine((amount) => amount > 0, 'Enter an amount above ₹0.'),
    gst: Rupees('GST').default(0),
    gstin: Text(15)
      .default('')
      .transform((gstin) => gstin.toUpperCase())
      .refine((gstin) => !gstin || GSTIN.test(gstin), 'Enter the 15-character GSTIN, e.g. 27AAPFU0939F1ZV.'),
    method: z.enum(METHODS, 'Choose how it was paid.'),
    reference: Text(60).default(''),
    attachment: z.string().regex(MEDIA, 'Upload the bill as a PDF or photo.').nullable().default(null),
  })
  .refine((expense) => expense.gst < expense.amount, { message: 'The GST is part of the amount, so it must be less.', path: ['gst'] });

const Reason = z.object({ reason: Text(300).min(1, 'Give a reason.') });

export function expenseRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner', 'accountant'));
  const owner = only('owner');

  const list = (where = sql`true`) => sql`
    select id::text, number, to_char(spent_on, 'YYYY-MM-DD') as "spentOn", category, description, paid_to as "paidTo",
      amount::float8 as amount, gst::float8 as gst, gstin, method, reference, attachment, status,
      created_by as "createdBy", created_at as "createdAt", decided_by as "decidedBy", decided_at as "decidedAt", reason
    from expenses where ${where} order by spent_on desc, id desc`;
  const one = async (id: number) => (await list(sql`id = ${id}`))[0];
  const columns = (input: z.infer<typeof ExpenseInput>) => ({
    spent_on: input.spentOn,
    category: input.category,
    description: input.description,
    paid_to: input.paidTo,
    amount: input.amount,
    gst: input.gst,
    gstin: input.gstin,
    method: input.method,
    reference: input.reference,
    attachment: input.attachment,
  });
  /** The Owner's own entries need no approval. */
  const decided = (c: { get: (key: 'staff') => { name: string; role: string } }) =>
    c.get('staff').role === 'owner' ? { status: 'approved', decided_by: c.get('staff').name, decided_at: new Date(), reason: '' } : { status: 'pending', decided_by: null, decided_at: null, reason: '' };

  // shortcut: every expense at once, which the admin filters itself; page it on the server past a few thousand.
  routes.get('/', async (c) => c.json(await list()));

  routes.post('/', jsonBody(ExpenseInput), async (c) => {
    const input = c.req.valid('json');
    const [{ next }] = (await sql`select nextval('expense_numbers')::int as next`) as unknown as [{ next: number }];
    const [row] = await sql`insert into expenses ${sql({ number: `EXP-${String(next).padStart(4, '0')}`, ...columns(input), ...decided(c), created_by: c.get('staff').name })} returning id`;
    return c.json(await one(row!.id), 201);
  });

  /** Pending or rejected only: an approved expense is in the books, so it's cancelled instead. Saving asks again. */
  routes.put('/:id', jsonBody(ExpenseInput), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [row] = await sql`update expenses set ${sql({ ...columns(c.req.valid('json')), ...decided(c) })} where id = ${id} and status in ('pending', 'rejected') returning id`;
    if (!row) await refuse(id, 'changed');
    return c.json(await one(id));
  });

  routes.delete('/:id', async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [row] = await sql`delete from expenses where id = ${id} and status in ('pending', 'rejected') returning id`;
    if (!row) await refuse(id, 'deleted');
    return c.body(null, 204);
  });

  routes.post('/:id/approve', owner, async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [row] = await sql`update expenses set status = 'approved', decided_by = ${c.get('staff').name}, decided_at = now(), reason = '' where id = ${id} and status = 'pending' returning id`;
    if (!row) await refuse(id, 'approved');
    return c.json(await one(id));
  });

  routes.post('/:id/reject', owner, jsonBody(Reason), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [row] = await sql`update expenses set status = 'rejected', decided_by = ${c.get('staff').name}, decided_at = now(), reason = ${c.req.valid('json').reason} where id = ${id} and status = 'pending' returning id`;
    if (!row) await refuse(id, 'rejected');
    return c.json(await one(id));
  });

  routes.post('/:id/cancel', owner, jsonBody(Reason), async (c) => {
    const id = parse(Id, c.req.param('id'));
    const [row] = await sql`update expenses set status = 'cancelled', decided_by = ${c.get('staff').name}, decided_at = now(), reason = ${c.req.valid('json').reason} where id = ${id} and status = 'approved' returning id`;
    if (!row) await refuse(id, 'cancelled');
    return c.json(await one(id));
  });

  /** Why a change found nothing to change: gone, or in a state that doesn't allow it (someone else got there first). */
  async function refuse(id: number, action: string): Promise<never> {
    const [row] = await sql`select number, status from expenses where id = ${id}`;
    if (!row) throw new HTTPException(404, { message: 'That expense does not exist.' });
    throw new HTTPException(409, { message: `${row.number} is ${row.status}, so it can’t be ${action}.` });
  }

  return routes;
}
