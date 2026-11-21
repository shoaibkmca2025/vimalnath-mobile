-- Phase 3, GST (docs/ERP-ROADMAP.md): the shop's GST registration, customers' GST details, tax invoices made from
-- orders, input tax credit on purchase bills, and GST paid. Every amount on a posted invoice is stored as issued, so
-- later changes to a product's rate or a customer's details never rewrite it.

-- One row: the shop's GST registration and invoice numbering.
create table gst_settings (
  only_one boolean primary key default true check (only_one),
  legal_name text not null default '',
  trade_name text not null default '',
  gstin text not null default '',
  address text not null default '',
  pincode text not null default '',
  registration_type text not null default 'regular' check (registration_type in ('regular', 'composition')),
  -- Invoice numbers are PREFIX/26-27/0001: up to 16 characters, as GST allows.
  invoice_prefix text not null default 'VSC' check (invoice_prefix ~ '^[A-Z0-9]{0,6}$'),
  terms text not null default '',
  updated_by text,
  updated_at timestamptz
);
insert into gst_settings default values;

-- What a tax invoice needs to know about the buyer. Empty GSTIN: an unregistered buyer (B2C).
alter table customers
  add column gstin text not null default '',
  add column legal_name text not null default '',
  add column billing_address text not null default '',
  add column state text not null default '',
  add column pincode text not null default '';

-- The next number for each series and financial year, taken under a row lock so numbers never repeat or skip.
create table invoice_counters (
  series text not null,
  financial_year text not null,
  last_number integer not null default 0,
  primary key (series, financial_year)
);

-- A GST tax invoice. A draft has no number and can change; posting numbers it and locks it; a posted one is cancelled,
-- never deleted. One invoice per order (a cancelled one doesn't count, so the order can be invoiced again).
create table sales_invoices (
  id integer generated always as identity primary key,
  order_id integer not null references orders,
  number text unique,
  financial_year text,
  invoice_date date not null,
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  -- The buyer as it was when invoiced.
  customer_name text not null,
  customer_gstin text not null default '',
  billing_address text not null default '',
  -- Place of supply: the buyer's state, and its GST code. Inter-state supplies take IGST, others CGST and SGST.
  place_of_supply text not null default '',
  pos_code text not null default '',
  interstate boolean not null default false,
  -- The seller as it was when invoiced.
  seller_gstin text not null default '',
  taxable numeric(14, 2) not null default 0,
  cgst numeric(14, 2) not null default 0,
  sgst numeric(14, 2) not null default 0,
  igst numeric(14, 2) not null default 0,
  round_off numeric(6, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  notes text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  posted_by text,
  posted_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  cancel_reason text not null default ''
);
create unique index sales_invoices_one_per_order on sales_invoices (order_id) where status <> 'cancelled';
create index sales_invoices_date on sales_invoices (invoice_date);

create table sales_invoice_items (
  invoice_id integer not null references sales_invoices on delete cascade,
  position integer not null,
  product_id text not null,
  option_label text not null default '',
  description text not null,
  hsn text not null default '',
  qty numeric(12, 3) not null check (qty > 0),
  unit text not null default 'pcs',
  -- What the buyer pays for the line, GST included, after any discount.
  amount numeric(14, 2) not null check (amount >= 0),
  gst_rate numeric(4, 2) not null check (gst_rate in (0, 0.25, 3, 5, 12, 18, 28, 40)),
  taxable numeric(14, 2) not null default 0,
  cgst numeric(14, 2) not null default 0,
  sgst numeric(14, 2) not null default 0,
  igst numeric(14, 2) not null default 0,
  primary key (invoice_id, position)
);

-- Purchases: whether the bill is inter-state (IGST) or not, fixed when it is saved, and the accountant's view of its
-- input tax credit. Nothing is claimed by itself: every bill starts pending review.
alter table purchases
  add column interstate boolean not null default false,
  add column itc_status text not null default 'pending' check (itc_status in ('pending', 'eligible', 'ineligible', 'claimed', 'reversed')),
  -- The return period (YYYY-MM) the credit is claimed or reversed in.
  add column itc_period text check (itc_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  add column itc_note text not null default '',
  add column itc_by text,
  add column itc_at timestamptz;

-- GST paid to the government, as entered from the challan. Recorded by staff; never assumed.
create table gst_payments (
  id integer generated always as identity primary key,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  paid_on date not null,
  challan text not null default '',
  cpin text not null default '',
  cin text not null default '',
  cgst numeric(14, 2) not null default 0 check (cgst >= 0),
  sgst numeric(14, 2) not null default 0 check (sgst >= 0),
  igst numeric(14, 2) not null default 0 check (igst >= 0),
  cess numeric(14, 2) not null default 0 check (cess >= 0),
  interest numeric(14, 2) not null default 0 check (interest >= 0),
  penalty numeric(14, 2) not null default 0 check (penalty >= 0),
  note text not null default '',
  attachment text,
  by text not null,
  created_at timestamptz not null default now()
);
create index gst_payments_period on gst_payments (period);
