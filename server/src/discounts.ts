import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { only, type Env, type Role } from './staff.ts';
import { jsonBody, parse } from './validate.ts';

/**
 * Category-wise discounts (docs/ERP-ROADMAP.md). Every goods line's whole discount (its %, its fixed ₹, and its share of
 * a bill discount) must sit within its rule: the product's (or option's) if product rules are on, else its category's,
 * else the shop's default; a rule only counts within its dates. Within the rule, each person may give up to their
 * authority; more waits for an approver. Checked here on the server on every save and before finalizing, so no screen or
 * request can get round it. Each line keeps a copy of the rule and its discount, so later rule changes leave bills alone.
 */

type Db = Sql | TransactionSql;
const r2 = (value: number) => Math.round(value * 100 * (1 + 4 * Number.EPSILON)) / 100;
const EPS = 0.005;
const pct = (value: number) => `${Number(value.toFixed(2))}%`;
const inr = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export type Rule = {
  id: number;
  scope: 'default' | 'category' | 'product';
  categoryId: string | null;
  productId: string | null;
  option: string;
  label: string;
  enabled: boolean;
  type: 'percentage' | 'amount' | 'both';
  minPct: number;
  maxPct: number;
  defaultPct: number;
  minAmount: number;
  maxAmount: number | null;
  defaultAmount: number;
  staffMaxPct: number | null;
  staffMaxAmount: number | null;
  requiresApproval: boolean;
  startsOn: string | null;
  endsOn: string | null;
  note: string;
  updatedBy: string | null;
  updatedAt: string;
};

/** Who is giving the discount: an Owner, or a staff member at their discount level. Empty for drafts the system makes. */
export type Actor = { name: string; level: 'owner' | 'admin' | 'manager' | 'staff'; limitPct: number | null };

export async function actorOf(db: Db, staff: { id: number; name: string; role: Role }): Promise<Actor> {
  if (staff.role === 'owner') return { name: staff.name, level: 'owner', limitPct: null };
  const [row] = await db`select discount_level, discount_limit_pct::float8 as limit from staff_users where id = ${staff.id}`;
  return { name: staff.name, level: (row?.discount_level ?? 'staff') as Actor['level'], limitPct: row?.limit ?? null };
}
export const approves = (actor: Actor) => actor.level === 'owner' || actor.level === 'admin';

const rulesQuery = (db: Db, where = db`true`) => db<Rule[]>`
  select r.id, r.scope, r.category_id as "categoryId", r.product_id as "productId", r.option_label as option,
    case r.scope when 'default' then 'Other goods' when 'category' then coalesce(c.label, r.category_id)
      else coalesce(nullif(p.name, ''), p.section, r.product_id) || coalesce(nullif(' · ' || r.option_label, ' · '), '') end as label,
    r.enabled, r.discount_type as type, r.min_pct::float8 as "minPct", r.max_pct::float8 as "maxPct", r.default_pct::float8 as "defaultPct",
    r.min_amount::float8 as "minAmount", r.max_amount::float8 as "maxAmount", r.default_amount::float8 as "defaultAmount",
    r.staff_max_pct::float8 as "staffMaxPct", r.staff_max_amount::float8 as "staffMaxAmount", r.requires_approval as "requiresApproval",
    to_char(r.starts_on, 'YYYY-MM-DD') as "startsOn", to_char(r.ends_on, 'YYYY-MM-DD') as "endsOn", r.note, r.updated_by as "updatedBy", r.updated_at as "updatedAt"
  from discount_rules r left join categories c on c.id = r.category_id left join products p on p.id = r.product_id
  where ${where}
  order by case r.scope when 'default' then 0 when 'category' then 1 else 2 end, label`;

/** The rules that apply on a day, and whether product rules are on. */
export async function rulesOn(db: Db, day: string) {
  const [rules, [setting]] = await Promise.all([
    rulesQuery(db, db`(r.starts_on is null or r.starts_on <= ${day}::date) and (r.ends_on is null or r.ends_on >= ${day}::date)`),
    db`select discount_product_rules from gst_settings`,
  ]);
  return { rules, productRules: Boolean(setting?.discount_product_rules ?? true) };
}

/** The rule for a line: its option's, its product's, its category's, then the default. */
export function ruleFor(set: { rules: Rule[]; productRules: boolean }, line: { productId: string; option: string; categoryId: string | null }) {
  const { rules, productRules } = set;
  if (productRules && line.productId) {
    const own = rules.find((rule) => rule.scope === 'product' && rule.productId === line.productId && rule.option === line.option) ?? rules.find((rule) => rule.scope === 'product' && rule.productId === line.productId && rule.option === '');
    if (own) return own;
  }
  if (line.categoryId) {
    const category = rules.find((rule) => rule.scope === 'category' && rule.categoryId === line.categoryId);
    if (category) return category;
  }
  return rules.find((rule) => rule.scope === 'default') ?? null;
}

type Priced = { productId: string; option: string; qty: number; rate: number; discountPct: number; discountAmount: number; lineType: 'goods' | 'charge'; gstRate: number; taxable: number };

/** A line's whole discount: rupees off before GST, as a % of its value, and per unit in the bill's prices. */
export function measure(line: Priced, inclusive: boolean) {
  const factor = inclusive ? 1 + line.gstRate / 100 : 1;
  const base = r2((line.qty * line.rate) / factor);
  const value = Math.max(0, r2(base - line.taxable));
  return { base, value, effectivePct: base ? Math.round((value / base) * 10000) / 100 : 0, perUnit: line.qty ? r2((value * factor) / line.qty) : 0 };
}

/**
 * Whether a line keeps to its rule, and whether its giver may give that much. `problem` is a reason it can't be billed;
 * `limit` is set when it needs approval (the giver's limit, as a % or ₹ per unit).
 */
export function judge(rule: Rule | null, line: Priced, measured: ReturnType<typeof measure>, actor?: Actor) {
  if (line.lineType === 'charge' || !rule) return { problem: null, limit: null };
  const name = rule.scope === 'default' ? 'These goods' : rule.label;
  const any = measured.value > EPS;
  if (!rule.enabled) return { problem: any ? `No discount is allowed on ${name}.` : null, limit: null };
  if (rule.type === 'percentage' && line.discountAmount > 0) return { problem: `${name} takes % discounts only.`, limit: null };
  if (rule.type === 'amount' && line.discountPct > 0) return { problem: `${name} takes ₹ discounts (off each unit) only.`, limit: null };
  if (rule.type === 'amount') {
    if (measured.perUnit < rule.minAmount - EPS || (rule.maxAmount !== null && measured.perUnit > rule.maxAmount + EPS))
      return { problem: `${name}: ${inr(rule.minAmount)} to ${rule.maxAmount === null ? 'any amount' : inr(rule.maxAmount)} off each unit (this is ${inr(measured.perUnit)}).`, limit: null };
  } else if (measured.effectivePct < rule.minPct - EPS || measured.effectivePct > rule.maxPct + EPS) {
    return { problem: `${name}: ${pct(rule.minPct)} to ${pct(rule.maxPct)} discount (this is ${pct(measured.effectivePct)}).`, limit: null };
  }
  if (!actor || approves(actor) || !any) return { problem: null, limit: null };
  // Within the rule; within this person's authority?
  if (rule.type === 'amount' && actor.level === 'staff') {
    const limit = rule.requiresApproval ? rule.defaultAmount : (rule.staffMaxAmount ?? rule.maxAmount);
    return { problem: null, limit: limit !== null && measured.perUnit > limit + EPS ? limit : null };
  }
  const limit =
    actor.level === 'manager'
      ? Math.min(actor.limitPct ?? rule.staffMaxPct ?? rule.maxPct, rule.maxPct)
      : rule.requiresApproval
        ? rule.defaultPct
        : (rule.staffMaxPct ?? rule.maxPct);
  return { problem: null, limit: measured.effectivePct > limit + EPS ? limit : null };
}

export type Assessed = {
  categoryId: string | null;
  ruleId: number | null;
  source: Rule['scope'] | null;
  ruleType: Rule['type'] | null;
  ruleMin: number | null;
  ruleMax: number | null;
  value: number;
  effectivePct: number;
  problem: string | null;
  status: 'ok' | 'pending' | 'approved' | 'rejected';
  approvalId: number | null;
  by: string | null;
};

/**
 * Checks a bill's lines on its day. With an actor (someone saving it), a line above their authority asks for approval:
 * an approval already given for the same product and discount carries over, a new one is requested, and requests no line
 * needs any more are withdrawn. Without one (a draft the system makes), lines are only measured.
 */
export async function assessDiscounts(tx: TransactionSql, lines: (Priced & { description: string })[], context: { day: string; inclusive: boolean; actor?: Actor; invoiceId?: number }) {
  const ids = [...new Set(lines.map((line) => line.productId).filter(Boolean))];
  const categories = ids.length ? await tx`select id, category_id from products where id in ${tx(ids)}` : [];
  const categoryOf = new Map(categories.map((row) => [row.id as string, row.category_id as string]));
  const set = await rulesOn(tx, context.day);
  const previous = context.invoiceId
    ? await tx`
        select id, product_id, option_label, discount_pct::float8 as discount_pct, discount_amount::float8 as discount_amount, effective_pct::float8 as effective_pct, status
        from discount_approvals where invoice_id = ${context.invoiceId} and status in ('pending', 'approved', 'rejected') order by id`
    : [];
  const used = new Set<number>();
  const assessed: Assessed[] = [];
  for (const line of lines) {
    const categoryId = line.productId ? (categoryOf.get(line.productId) ?? null) : null;
    const rule = line.lineType === 'goods' ? ruleFor(set, { productId: line.productId, option: line.option, categoryId }) : null;
    const measured = measure(line, context.inclusive);
    const { problem, limit } = judge(rule, line, measured, context.actor);
    const base: Assessed = {
      categoryId,
      ruleId: rule?.id ?? null,
      source: rule?.scope ?? null,
      ruleType: rule?.type ?? null,
      ruleMin: rule ? (rule.type === 'amount' ? rule.minAmount : rule.minPct) : null,
      ruleMax: rule ? (rule.type === 'amount' ? rule.maxAmount : rule.maxPct) : null,
      value: line.lineType === 'goods' ? measured.value : 0,
      effectivePct: line.lineType === 'goods' ? measured.effectivePct : 0,
      problem,
      status: 'ok',
      approvalId: null,
      by: context.actor?.name ?? null,
    };
    if (limit !== null && !problem && context.invoiceId) {
      const same = previous.find(
        (row) =>
          !used.has(row.id) &&
          row.product_id === line.productId &&
          row.option_label === line.option &&
          Math.abs(row.discount_pct - line.discountPct) < EPS &&
          Math.abs(row.discount_amount - line.discountAmount) < EPS &&
          Math.abs(row.effective_pct - measured.effectivePct) < 0.01,
      );
      if (same) {
        used.add(same.id);
        base.status = same.status as Assessed['status'];
        base.approvalId = same.id;
      } else {
        const [row] = await tx`
          insert into discount_approvals ${tx({
            invoice_id: context.invoiceId,
            product_id: line.productId,
            option_label: line.option,
            description: line.description,
            category_id: categoryId,
            discount_pct: line.discountPct,
            discount_amount: line.discountAmount,
            effective_pct: measured.effectivePct,
            qty: line.qty,
            rate: line.rate,
            rule_min: base.ruleMin ?? 0,
            rule_max: base.ruleMax ?? 100,
            authority_pct: limit,
            requested_by: context.actor!.name,
          })} returning id`;
        await tx`
          insert into discount_events ${tx({
            kind: 'requested',
            rule_id: rule?.id ?? null,
            invoice_id: context.invoiceId,
            approval_id: row!.id,
            subject: line.description,
            before: tx.json({ limit, rule: [base.ruleMin, base.ruleMax] } as never) as never,
            after: tx.json({ discountPct: line.discountPct, discountAmount: line.discountAmount, effectivePct: measured.effectivePct, value: measured.value } as never) as never,
            by: context.actor!.name,
          })}`;
        base.status = 'pending';
        base.approvalId = row!.id as number;
        used.add(row!.id as number);
      }
    }
    assessed.push(base);
  }
  // Requests no line needs any more (changed, or now within authority) are withdrawn.
  if (context.actor && context.invoiceId) {
    const stale = previous.filter((row) => !used.has(row.id) && row.status === 'pending').map((row) => row.id as number);
    if (stale.length) await tx`update discount_approvals set status = 'withdrawn', decided_at = now(), decided_by = ${context.actor.name} where id in ${tx(stale)}`;
  }
  return assessed;
}

/**
 * Before a bill is finalized: every goods line, as saved, against the rules on its day, and no discount still waiting for
 * approval (or refused). Updates each line's copy of its rule to the one it's finalized under.
 */
export async function checkBeforePosting(tx: TransactionSql, invoiceId: number) {
  const [invoice] = await tx`select invoice_date::text as day, prices_include_gst from sales_invoices where id = ${invoiceId}`;
  const lines = await tx`
    select position, product_id, option_label, description, qty::float8 as qty, rate::float8 as rate, discount_pct::float8 as discount_pct,
      discount_amount::float8 as discount_amount, line_type, gst_rate::float8 as gst_rate, taxable::float8 as taxable, discount_status
    from sales_invoice_items where invoice_id = ${invoiceId} order by position`;
  const priced = lines.map((line) => ({
    productId: line.product_id as string,
    option: line.option_label as string,
    description: line.description as string,
    qty: line.qty as number,
    rate: line.rate as number,
    discountPct: line.discount_pct as number,
    discountAmount: line.discount_amount as number,
    lineType: line.line_type as 'goods' | 'charge',
    gstRate: line.gst_rate as number,
    taxable: line.taxable as number,
  }));
  const assessed = await assessDiscounts(tx, priced, { day: invoice!.day, inclusive: invoice!.prices_include_gst });
  for (const [index, line] of lines.entries()) {
    if (assessed[index]!.problem) throw new HTTPException(409, { message: `${assessed[index]!.problem} Change the discount before finalizing.` });
    if (line.discount_status === 'pending') throw new HTTPException(409, { message: `The discount on ${line.description} is waiting for approval.` });
    if (line.discount_status === 'rejected') throw new HTTPException(409, { message: `The discount on ${line.description} was refused. Change it before finalizing.` });
  }
  for (const [index, line] of lines.entries()) {
    const a = assessed[index]!;
    await tx`
      update sales_invoice_items set category_id = ${a.categoryId}, discount_rule_id = ${a.ruleId}, discount_source = ${a.source}, rule_type = ${a.ruleType},
        rule_min = ${a.ruleMin}, rule_max = ${a.ruleMax}, discount_value = ${a.value}, effective_pct = ${a.effectivePct}
      where invoice_id = ${invoiceId} and position = ${line.position}`;
  }
}

// ---------- Routes ----------

const Pct = z.number('Enter a percentage.').min(0, 'Enter 0% or more.').max(100, 'Enter 100% or less.').refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'Use up to 2 decimal places.');
const Amount = z.number('Enter rupees.').min(0, 'Enter ₹0 or more.').max(10_000_000).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'Use rupees and paise.');
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.')
  .refine((day) => !Number.isNaN(Date.parse(day)), 'Pick a date.');
const RuleInput = z
  .object({
    scope: z.enum(['default', 'category', 'product']),
    categoryId: z.string().min(1).max(200).nullable().default(null),
    productId: z.string().min(1).max(200).nullable().default(null),
    option: z.string().max(200).default(''),
    enabled: z.boolean(),
    type: z.enum(['percentage', 'amount', 'both']),
    minPct: Pct.default(0),
    maxPct: Pct.default(100),
    defaultPct: Pct.default(0),
    minAmount: Amount.default(0),
    maxAmount: Amount.nullable().default(null),
    defaultAmount: Amount.default(0),
    staffMaxPct: Pct.nullable().default(null),
    staffMaxAmount: Amount.nullable().default(null),
    requiresApproval: z.boolean().default(false),
    startsOn: Day.nullable().default(null),
    endsOn: Day.nullable().default(null),
    note: z.string().trim().max(300).default(''),
  })
  .refine((rule) => rule.minPct <= rule.maxPct, { message: 'The minimum can’t be above the maximum.', path: ['minPct'] })
  .refine((rule) => rule.defaultPct >= rule.minPct && rule.defaultPct <= rule.maxPct, { message: 'The suggested discount must be within the minimum and maximum.', path: ['defaultPct'] })
  .refine((rule) => rule.maxAmount === null || (rule.minAmount <= rule.maxAmount && rule.defaultAmount <= rule.maxAmount && rule.defaultAmount >= rule.minAmount), {
    message: 'Keep the minimum ≤ suggested ≤ maximum.',
    path: ['minAmount'],
  })
  .refine((rule) => rule.staffMaxPct === null || (rule.staffMaxPct >= rule.minPct && rule.staffMaxPct <= rule.maxPct), { message: 'The staff limit must be within the minimum and maximum.', path: ['staffMaxPct'] })
  .refine((rule) => !rule.startsOn || !rule.endsOn || rule.startsOn <= rule.endsOn, { message: 'The end date must be on or after the start.', path: ['endsOn'] })
  .refine((rule) => (rule.scope === 'category') === Boolean(rule.categoryId) && (rule.scope === 'product') === Boolean(rule.productId), { message: 'Choose what the rule is for.', path: ['scope'] });

/** /v1/admin/discounts. Everyone who bills reads the rules; Owners and discount admins change them and approve. */
export function discountRoutes(sql: Sql) {
  const routes = new Hono<Env>();
  routes.use(only('owner', 'sales', 'accountant'));

  const managerOnly = async (staff: { id: number; name: string; role: Role }) => {
    const actor = await actorOf(sql, staff);
    if (!approves(actor)) throw new HTTPException(403, { message: 'Only an Owner or a discount admin can do this.' });
    return actor;
  };
  const event = (db: Db, row: Record<string, unknown>) =>
    db`insert into discount_events ${db({ rule_id: null, invoice_id: null, approval_id: null, subject: '', before: null, after: null, reason: '', ...row } as never)}`;

  routes.get('/rules', async (c) => {
    const [rules, categories, [setting], me] = await Promise.all([
      rulesQuery(sql),
      sql`select id, label from categories order by sort_order`,
      sql`select discount_product_rules from gst_settings`,
      actorOf(sql, c.get('staff')),
    ]);
    return c.json({ rules, categories, productRules: Boolean(setting?.discount_product_rules ?? true), me });
  });

  routes.put('/rules', jsonBody(RuleInput), async (c) => {
    const input = c.req.valid('json');
    const actor = await managerOnly(c.get('staff'));
    const id = await sql.begin(async (tx) => {
      const [existing] = await tx`
        select id from discount_rules where scope = ${input.scope}
          and coalesce(category_id, '') = ${input.categoryId ?? ''} and coalesce(product_id, '') = ${input.productId ?? ''} and option_label = ${input.scope === 'product' ? input.option : ''}
        for update`;
      const before = existing ? (await rulesQuery(tx, tx`r.id = ${existing.id}`))[0] : undefined;
      const row = {
        scope: input.scope,
        category_id: input.scope === 'category' ? input.categoryId : null,
        product_id: input.scope === 'product' ? input.productId : null,
        option_label: input.scope === 'product' ? input.option : '',
        enabled: input.enabled,
        discount_type: input.type,
        min_pct: input.minPct,
        max_pct: input.maxPct,
        default_pct: input.defaultPct,
        min_amount: input.minAmount,
        max_amount: input.maxAmount,
        default_amount: input.defaultAmount,
        staff_max_pct: input.staffMaxPct,
        staff_max_amount: input.staffMaxAmount,
        requires_approval: input.requiresApproval,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        note: input.note,
        updated_by: actor.name,
      };
      let id: number;
      if (existing) {
        await tx`update discount_rules set ${tx(row)}, updated_at = now() where id = ${existing.id}`;
        id = existing.id as number;
      } else {
        if (input.scope === 'product') {
          const [product] = await tx`select id from products where id = ${input.productId}`;
          if (!product) throw new HTTPException(400, { message: 'That product isn’t in the catalogue.', cause: { field: 'productId' } });
        }
        if (input.scope === 'category') {
          const [category] = await tx`select id from categories where id = ${input.categoryId}`;
          if (!category) throw new HTTPException(400, { message: 'That category doesn’t exist.', cause: { field: 'categoryId' } });
        }
        const [saved] = await tx`insert into discount_rules ${tx(row)} returning id`;
        id = saved!.id as number;
      }
      const after = (await rulesQuery(tx, tx`r.id = ${id}`))[0];
      await event(tx, { kind: existing ? 'rule_changed' : 'rule_created', rule_id: id, subject: after!.label, before: before ? tx.json(before as never) : null, after: tx.json(after as never), by: actor.name });
      return id;
    });
    return c.json({ rule: (await rulesQuery(sql, sql`r.id = ${id}`))[0] });
  });

  routes.delete('/rules/:id', async (c) => {
    const actor = await managerOnly(c.get('staff'));
    const id = parse(z.coerce.number().int().positive(), c.req.param('id'));
    await sql.begin(async (tx) => {
      const [rule] = await rulesQuery(tx, tx`r.id = ${id}`);
      if (!rule) throw new HTTPException(404, { message: 'That rule has already been removed.' });
      if (rule.scope === 'default') throw new HTTPException(409, { message: 'The default rule stays: change it instead.' });
      await tx`delete from discount_rules where id = ${id}`;
      await event(tx, { kind: 'rule_removed', rule_id: id, subject: rule.label, before: tx.json(rule as never), by: actor.name });
    });
    return c.body(null, 204);
  });

  routes.put('/settings', jsonBody(z.object({ productRules: z.boolean() })), async (c) => {
    const actor = await managerOnly(c.get('staff'));
    await sql`update gst_settings set discount_product_rules = ${c.req.valid('json').productRules}`;
    await event(sql, { kind: 'rule_changed', subject: 'Product rules', after: sql.json({ productRules: c.req.valid('json').productRules }), by: actor.name });
    return c.json({ productRules: c.req.valid('json').productRules });
  });

  // Who may give how much (Owners set it).
  routes.get('/staff', only('owner'), async (c) =>
    c.json(await sql`select id, name, role, active, discount_level as level, discount_limit_pct::float8 as "limitPct" from staff_users where role <> 'owner' order by name`),
  );
  routes.put(
    '/staff/:id',
    only('owner'),
    jsonBody(z.object({ level: z.enum(['admin', 'manager', 'staff']), limitPct: Pct.nullable().default(null) })),
    async (c) => {
      const id = parse(z.coerce.number().int().positive(), c.req.param('id'));
      const { level, limitPct } = c.req.valid('json');
      const [before] = await sql`select name, discount_level as level, discount_limit_pct::float8 as "limitPct" from staff_users where id = ${id} and role <> 'owner'`;
      if (!before) throw new HTTPException(404, { message: 'That staff member doesn’t exist.' });
      await sql`update staff_users set discount_level = ${level}, discount_limit_pct = ${level === 'manager' ? limitPct : null} where id = ${id}`;
      await event(sql, { kind: 'level_changed', subject: before.name, before: sql.json(before as never), after: sql.json({ level, limitPct } as never), by: c.get('staff').name });
      return c.json({ id, level, limitPct: level === 'manager' ? limitPct : null });
    },
  );

  // Discounts waiting for approval, and the ones decided.
  routes.get('/approvals', async (c) =>
    c.json(
      await sql`
        select a.id::text as id, a.invoice_id::text as "invoiceId", i.number as "invoiceNumber", i.status as "invoiceStatus", i.customer_name as "customerName",
          a.product_id as "productId", a.option_label as option, a.description, a.category_id as "categoryId", cat.label as "categoryLabel",
          a.discount_pct::float8 as "discountPct", a.discount_amount::float8 as "discountAmount", a.effective_pct::float8 as "effectivePct",
          a.qty::float8 as qty, a.rate::float8 as rate, a.rule_min::float8 as "ruleMin", a.rule_max::float8 as "ruleMax", a.authority_pct::float8 as "authority",
          a.status, a.requested_by as "requestedBy", a.requested_at as "requestedAt", a.decided_by as "decidedBy", a.decided_at as "decidedAt", nullif(a.reason, '') as reason
        from discount_approvals a join sales_invoices i on i.id = a.invoice_id left join categories cat on cat.id = a.category_id
        order by (a.status = 'pending') desc, a.requested_at desc limit 500`,
    ),
  );

  routes.get('/approvals/count', async (c) => c.json((await sql`select count(*)::int as pending from discount_approvals where status = 'pending'`)[0]));

  routes.post('/approvals/:id/decide', jsonBody(z.object({ approve: z.boolean(), reason: z.string().trim().max(300).default('') })), async (c) => {
    const id = parse(z.coerce.number().int().positive(), c.req.param('id'));
    const { approve, reason } = c.req.valid('json');
    const actor = await managerOnly(c.get('staff'));
    if (!approve && !reason) throw new HTTPException(400, { message: 'Say why it’s refused: whoever made the bill will see it.', cause: { field: 'reason' } });
    await sql.begin(async (tx) => {
      const [approval] = await tx`select invoice_id, status, description, discount_pct::float8 as pct, discount_amount::float8 as amount, effective_pct::float8 as effective, requested_by from discount_approvals where id = ${id} for update`;
      if (!approval) throw new HTTPException(404, { message: 'That request doesn’t exist.' });
      if (approval.status !== 'pending') throw new HTTPException(409, { message: `That request is already ${approval.status}.` });
      await tx`select id from sales_invoices where id = ${approval.invoice_id} for update`;
      const status = approve ? 'approved' : 'rejected';
      await tx`update discount_approvals set status = ${status}, decided_by = ${actor.name}, decided_at = now(), reason = ${reason} where id = ${id}`;
      await tx`update sales_invoice_items set discount_status = ${status} where discount_approval_id = ${id}`;
      await tx`update sales_invoices set version = version + 1 where id = ${approval.invoice_id}`;
      await event(tx, {
        kind: status,
        invoice_id: approval.invoice_id,
        approval_id: id,
        subject: approval.description,
        before: tx.json({ requestedBy: approval.requested_by } as never),
        after: tx.json({ discountPct: approval.pct, discountAmount: approval.amount, effectivePct: approval.effective } as never),
        reason,
        by: actor.name,
      });
      await tx`insert into invoice_events ${tx({ invoice_id: approval.invoice_id, kind: 'edited', note: `Discount on ${approval.description} ${status} by ${actor.name}${reason ? `: ${reason}` : ''}`, by: actor.name })}`;
    });
    return c.json({ id: String(id), status: approve ? 'approved' : 'rejected' });
  });

  // Discounts given on finalized bills in a period, line by line, with the approval history and rule changes, for the
  // reports to group by category, product, staff member and day.
  routes.get('/report', async (c) => {
    const { from, to } = parse(z.object({ from: Day, to: Day }), c.req.query());
    const [lines, decisions, changes] = await Promise.all([
      sql`
        select to_char(i.invoice_date, 'YYYY-MM-DD') as day, i.id::text as "invoiceId", i.number, i.customer_name as customer,
          l.product_id as "productId", l.option_label as option, l.description, l.detail, l.category_id as "categoryId", coalesce(cat.label, 'Uncategorised') as "categoryLabel",
          l.qty::float8 as qty, (l.taxable + l.discount_value)::float8 as base, l.discount_value::float8 as discount, l.effective_pct::float8 as "effectivePct",
          l.discount_pct::float8 as "discountPct", l.discount_amount::float8 as "discountAmount", l.bill_discount::float8 as "billDiscount",
          l.discount_source as source, l.rule_min::float8 as "ruleMin", l.rule_max::float8 as "ruleMax",
          coalesce(l.discount_by, i.posted_by, i.created_by) as "by", l.discount_status as status
        from sales_invoice_items l join sales_invoices i on i.id = l.invoice_id left join categories cat on cat.id = l.category_id
        where i.status = 'posted' and l.line_type = 'goods' and i.invoice_date between ${from}::date and ${to}::date
        order by i.invoice_date, i.id, l.position`,
      sql`
        select a.id::text as id, i.number, a.description, a.effective_pct::float8 as "effectivePct", a.status, a.requested_by as "requestedBy",
          a.requested_at as "requestedAt", a.decided_by as "decidedBy", a.decided_at as "decidedAt", nullif(a.reason, '') as reason
        from discount_approvals a join sales_invoices i on i.id = a.invoice_id
        where (a.requested_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date order by a.requested_at desc`,
      sql`
        select id::text as id, kind, subject, before, after, nullif(reason, '') as reason, by, at from discount_events
        where kind in ('rule_created', 'rule_changed', 'rule_removed', 'level_changed') and (at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date
        order by at desc`,
    ]);
    return c.json({ from, to, lines, decisions, changes });
  });

  return routes;
}
