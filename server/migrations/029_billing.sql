-- Custom billing (docs/ERP-ROADMAP.md): counter bills made in the admin, without an app order, in the same tax invoice
-- series and registers as order invoices; their payments; quotations; units of measure; and how bills look.

-- Units a bill line can be in. The stock units come first (an item counted in stock is billed in its stock unit); the shop
-- adds its own. `label` is what staff pick, `print` what the bill prints (Tally's NOS for pieces).
create table measurement_units (
  code text primary key check (code ~ '^[a-z0-9_]{1,20}$'),
  label text not null check (length(label) between 1 and 20),
  print text not null check (length(print) between 1 and 12),
  built_in boolean not null default false,
  sort_order integer not null default 100,
  created_by text,
  created_at timestamptz not null default now()
);
insert into measurement_units (code, label, print, built_in, sort_order) values
  ('pcs', 'PCS', 'NOS', true, 1),
  ('feet', 'FT', 'FT', true, 2),
  ('sqft', 'SQ FT', 'SQF', true, 3),
  ('rft', 'RFT', 'RFT', true, 4),
  ('kg', 'KG', 'KGS', true, 5),
  ('meter', 'MTR', 'MTR', true, 6),
  ('box', 'BOX', 'BOX', true, 7),
  ('set', 'SET', 'SET', true, 8),
  ('pair', 'PAIR', 'PAIR', true, 9),
  ('packet', 'PACKET', 'PAC', true, 10),
  ('sheet', 'SHEET', 'SHEET', true, 11),
  ('length', 'LENGTH', 'LENGTH', true, 12),
  ('sqm', 'SQ M', 'SQM', true, 13);

-- A customer billed at the counter may have no app: their phone is kept on the record itself.
alter table customers add column phone text not null default '';

-- Counter bills have no order. Each is its own customer's document: the customer record (if any) and their phone.
alter table sales_invoices
  alter column order_id drop not null,
  add column customer_id integer references customers,
  add column customer_phone text not null default '',
  -- When the balance is due; empty for a bill paid at once.
  add column due_date date,
  -- Rates typed GST included: each line's value before GST is worked out from it.
  add column prices_include_gst boolean not null default false,
  -- A discount on the whole bill, before GST, shared over its goods lines (the % it came from, if it was one).
  add column bill_discount numeric(14, 2) not null default 0 check (bill_discount >= 0),
  add column bill_discount_pct numeric(5, 2) check (bill_discount_pct between 0 and 100),
  -- An Owner may let one bill take an item below zero stock.
  add column allow_negative_stock boolean not null default false,
  add column duplicate_of integer references sales_invoices,
  -- Bumped on every change: an action from an out-of-date screen is refused.
  add column version integer not null default 1,
  -- A posted bill an Owner opened again to correct: it keeps its number, and the reason is recorded.
  add column reopened_by text,
  add column reopened_at timestamptz,
  add column reopen_reason text not null default '';
create index sales_invoices_customer on sales_invoices (customer_id) where customer_id is not null;

alter table sales_invoice_items
  add column sku text not null default '',
  -- A fixed discount on the line, after its % discount.
  add column discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  -- charge: transport or another charge on the bill, taxed like a line, never from stock or discounted by the bill.
  add column line_type text not null default 'goods' check (line_type in ('goods', 'charge')),
  -- This line's share of the bill discount; taxable = amount less it.
  add column bill_discount numeric(14, 2) not null default 0;

-- Money received against a counter bill (an order's invoice is paid through the order). Never deleted: voided.
create table invoice_payments (
  id integer generated always as identity primary key,
  invoice_id integer not null references sales_invoices,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'upi', 'bank', 'cheque', 'card')),
  paid_on date not null,
  reference text not null default '',
  note text not null default '',
  by text not null,
  created_at timestamptz not null default now(),
  voided_by text,
  voided_at timestamptz,
  void_reason text not null default ''
);
create index invoice_payments_invoice on invoice_payments (invoice_id);

-- Everything done to a bill, in order: who, when, and for edits what it was before and after.
create table invoice_events (
  id bigint generated always as identity primary key,
  invoice_id integer not null references sales_invoices on delete cascade,
  kind text not null check (kind in ('created', 'edited', 'finalized', 'reopened', 'payment', 'payment_voided', 'cancelled', 'duplicated', 'converted', 'credit_note')),
  note text not null default '',
  before jsonb,
  after jsonb,
  by text not null,
  at timestamptz not null default now()
);
create index invoice_events_invoice on invoice_events (invoice_id, id);

-- Quotations: priced offers, numbered in their own series, that become invoices when the customer agrees.
create table quotations (
  id integer generated always as identity primary key,
  number text not null unique,
  financial_year text not null,
  quote_date date not null,
  valid_until date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled')),
  customer_id integer references customers,
  customer_name text not null,
  customer_phone text not null default '',
  customer_gstin text not null default '',
  billing_address text not null default '',
  place_of_supply text not null default '',
  pos_code text not null default '',
  interstate boolean not null default false,
  prices_include_gst boolean not null default false,
  bill_discount numeric(14, 2) not null default 0 check (bill_discount >= 0),
  bill_discount_pct numeric(5, 2) check (bill_discount_pct between 0 and 100),
  taxable numeric(14, 2) not null default 0,
  cgst numeric(14, 2) not null default 0,
  sgst numeric(14, 2) not null default 0,
  igst numeric(14, 2) not null default 0,
  round_off numeric(6, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  notes text not null default '',
  -- The invoice it became.
  invoice_id integer references sales_invoices,
  version integer not null default 1,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table quotation_items (
  quotation_id integer not null references quotations on delete cascade,
  position integer not null,
  product_id text not null default '',
  option_label text not null default '',
  description text not null,
  detail text not null default '',
  sku text not null default '',
  hsn text not null default '',
  qty numeric(12, 3) not null check (qty > 0),
  unit text not null default 'pcs',
  rate numeric(12, 2) not null check (rate >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  line_type text not null default 'goods' check (line_type in ('goods', 'charge')),
  amount numeric(14, 2) not null default 0,
  gst_rate numeric(4, 2) not null default 0 check (gst_rate in (0, 0.25, 3, 5, 12, 18, 28, 40)),
  bill_discount numeric(14, 2) not null default 0,
  taxable numeric(14, 2) not null default 0,
  cgst numeric(14, 2) not null default 0,
  sgst numeric(14, 2) not null default 0,
  igst numeric(14, 2) not null default 0,
  primary key (quotation_id, position)
);

alter table sales_invoices add column quotation_id integer references quotations;

-- A counter bill takes its goods from stock when it is finalized, and gives them back when cancelled.
alter table stock_moves add column invoice_id integer references sales_invoices;
alter table stock_moves drop constraint stock_moves_kind_check;
alter table stock_moves add constraint stock_moves_kind_check check (kind in (
  'opening', 'count', 'adjust', 'delivered', 'undelivered', 'purchase', 'purchase_cancelled',
  'return_received', 'return_inspected', 'return_reversed', 'replacement', 'replacement_reversed', 'written_off',
  'supplier_return', 'supplier_return_reversed', 'billed', 'bill_reversed'));
create index stock_moves_invoice on stock_moves (invoice_id) where invoice_id is not null;

-- How bills look and behave (Invoice Settings). The shop's name, address, GSTIN and bank stay where GST Settings keep them.
alter table gst_settings
  -- Printed at the top; empty for TAX INVOICE (or BILL OF SUPPLY for a composition dealer).
  add column invoice_heading text not null default '',
  add column invoice_footer text not null default '',
  -- Photos from the media library; no logo here uses the company logo.
  add column invoice_logo text,
  add column signature text,
  add column theme_color text not null default '#2458e8' check (theme_color ~ '^#[0-9a-fA-F]{6}$'),
  add column paper_size text not null default 'A4' check (paper_size in ('A4', 'A5', 'thermal')),
  add column invoice_template text not null default 'classic' check (invoice_template in ('classic', 'modern', 'compact')),
  -- Days a bill on credit has to be paid; 0: due the day it's made.
  add column bill_due_days integer not null default 0 check (bill_due_days between 0 and 365),
  add column prices_include_gst boolean not null default false,
  add column allow_negative_stock boolean not null default false,
  add column quotation_days integer not null default 15 check (quotation_days between 1 and 365);
