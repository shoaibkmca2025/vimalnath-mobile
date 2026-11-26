-- Category-wise discounts (docs/ERP-ROADMAP.md): the limits a bill's line discounts must keep to, by product, by
-- category, or the shop's default; who may give how much; approvals for more; and, on every bill line, a copy of the rule
-- and the discount it got, so changing a rule never rewrites a bill.

-- A rule: for one product (or one of its options), one category, or the default for everything else. Percentages are
-- of the line's value; fixed amounts are rupees off each unit. A rule outside its dates doesn't apply.
create table discount_rules (
  id integer generated always as identity primary key,
  scope text not null check (scope in ('default', 'category', 'product')),
  category_id text references categories on delete cascade,
  product_id text references products on delete cascade,
  -- '' for every option of the product.
  option_label text not null default '',
  -- Off: no discount at all on these goods.
  enabled boolean not null default true,
  -- percentage: % only. amount: ₹ off each unit only. both: either, checked as the % it comes to.
  discount_type text not null default 'percentage' check (discount_type in ('percentage', 'amount', 'both')),
  min_pct numeric(5, 2) not null default 0 check (min_pct between 0 and 100),
  max_pct numeric(5, 2) not null default 100 check (max_pct between 0 and 100),
  default_pct numeric(5, 2) not null default 0 check (default_pct between 0 and 100),
  min_amount numeric(12, 2) not null default 0 check (min_amount >= 0),
  max_amount numeric(12, 2) check (max_amount >= 0),
  default_amount numeric(12, 2) not null default 0 check (default_amount >= 0),
  -- What billing staff may give without approval; empty: up to the maximum.
  staff_max_pct numeric(5, 2) check (staff_max_pct between 0 and 100),
  staff_max_amount numeric(12, 2) check (staff_max_amount >= 0),
  -- On: any discount from billing staff above the suggested one waits for approval.
  requires_approval boolean not null default false,
  starts_on date,
  ends_on date,
  note text not null default '',
  updated_by text,
  updated_at timestamptz not null default now(),
  check (min_pct <= max_pct and default_pct between min_pct and max_pct),
  check (max_amount is null or (min_amount <= max_amount and default_amount <= max_amount)),
  check (starts_on is null or ends_on is null or starts_on <= ends_on),
  check ((scope = 'default') = (category_id is null and product_id is null)),
  check ((scope = 'category') = (category_id is not null and product_id is null)),
  check ((scope = 'product') = (product_id is not null and category_id is null))
);
create unique index discount_rules_default on discount_rules (scope) where scope = 'default';
create unique index discount_rules_category on discount_rules (category_id) where scope = 'category';
create unique index discount_rules_product on discount_rules (product_id, option_label) where scope = 'product';
-- No limits until the shop sets them: bills made so far keep working.
insert into discount_rules (scope, note) values ('default', 'Applies to goods with no category or product rule.');

-- Product rules can be turned off for the whole shop, leaving only category rules and the default.
alter table gst_settings add column discount_product_rules boolean not null default true;

-- How much each staff member may give. Owners have full control. admin: edits rules and approves, and gives up to a
-- rule's maximum; manager: up to their own limit (or the rule's staff limit); staff: up to the rule's staff limit.
alter table staff_users
  add column discount_level text not null default 'staff' check (discount_level in ('admin', 'manager', 'staff')),
  add column discount_limit_pct numeric(5, 2) check (discount_limit_pct between 0 and 100);

-- A discount waiting for someone who may approve it: one bill line's discount, above its giver's authority.
create table discount_approvals (
  id integer generated always as identity primary key,
  invoice_id integer not null references sales_invoices on delete cascade,
  product_id text not null default '',
  option_label text not null default '',
  description text not null,
  category_id text,
  -- What was asked for: the line's % and its fixed ₹ (total), and the whole discount as a % of the line.
  discount_pct numeric(5, 2) not null,
  discount_amount numeric(12, 2) not null,
  effective_pct numeric(6, 2) not null,
  qty numeric(12, 3) not null,
  rate numeric(12, 2) not null,
  -- The rule and the giver's limit at the time.
  rule_min numeric(6, 2) not null,
  rule_max numeric(6, 2) not null,
  authority_pct numeric(6, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  reason text not null default ''
);
create index discount_approvals_invoice on discount_approvals (invoice_id);
create index discount_approvals_pending on discount_approvals (status) where status = 'pending';

-- Every rule change, approval request and decision: who, when, why, and the values before and after.
create table discount_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('rule_created', 'rule_changed', 'rule_removed', 'requested', 'approved', 'rejected', 'withdrawn', 'level_changed')),
  rule_id integer,
  invoice_id integer references sales_invoices on delete set null,
  approval_id integer references discount_approvals on delete set null,
  subject text not null default '',
  before jsonb,
  after jsonb,
  reason text not null default '',
  by text not null,
  at timestamptz not null default now()
);
create index discount_events_at on discount_events (at);

-- On every bill and quotation line: the rule that applied and the discount it got, as they were.
alter table sales_invoice_items
  add column category_id text,
  add column discount_rule_id integer,
  add column discount_source text check (discount_source in ('product', 'category', 'default')),
  add column rule_type text,
  add column rule_min numeric(12, 2),
  add column rule_max numeric(12, 2),
  -- Rupees off the line before GST: its % and fixed discount and its share of a bill discount.
  add column discount_value numeric(14, 2) not null default 0,
  add column effective_pct numeric(6, 2) not null default 0,
  -- ok, or waiting for (or given, or refused) approval.
  add column discount_status text not null default 'ok' check (discount_status in ('ok', 'pending', 'approved', 'rejected')),
  add column discount_approval_id integer references discount_approvals on delete set null,
  add column discount_by text;
alter table quotation_items
  add column category_id text,
  add column discount_rule_id integer,
  add column discount_source text,
  add column rule_type text,
  add column rule_min numeric(12, 2),
  add column rule_max numeric(12, 2),
  add column discount_value numeric(14, 2) not null default 0,
  add column effective_pct numeric(6, 2) not null default 0;
