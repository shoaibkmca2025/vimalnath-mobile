-- Phase 2, purchases (docs/ERP-ROADMAP.md). Suppliers, their bills with items, and what the shop paid them.
-- Receiving a bill's goods adds its items to stock exactly once; cancelling a received bill takes them back out.

-- More units for hardware, glass and aluminium: packet, running feet, square feet and metres, sheet, length.
alter table stock_items drop constraint stock_items_unit_check;
alter table stock_items add constraint stock_items_unit_check check (unit in ('pcs', 'box', 'packet', 'set', 'feet', 'rft', 'meter', 'sqft', 'sqm', 'kg', 'sheet', 'length'));

create table suppliers (
  id integer generated always as identity primary key,
  name text not null,
  company text not null default '',
  contact_person text not null default '',
  phone text not null default '',
  email text not null default '',
  gstin text not null default '',
  address text not null default '',
  state text not null default '',
  -- What the shop already owed them when they were added, in rupees and paise.
  opening_balance numeric(14, 2) not null default 0 check (opening_balance >= 0),
  -- Days the shop has to pay a bill; empty when nothing is agreed.
  payment_days integer check (payment_days between 0 and 365),
  bank_details text not null default '',
  notes text not null default '',
  -- Archived suppliers keep their bills and payments but leave the pickers.
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index suppliers_gstin on suppliers (upper(gstin)) where gstin <> '';

create sequence purchase_numbers;

create table purchases (
  id integer generated always as identity primary key,
  -- The shop's own number, PUR-0001.
  number text not null unique,
  supplier_id integer not null references suppliers,
  -- The number printed on the supplier's bill.
  supplier_invoice text not null default '',
  bill_date date not null,
  -- draft: editable, no stock yet. received: goods in stock, locked. cancelled: kept for the record.
  status text not null default 'draft' check (status in ('draft', 'received', 'cancelled')),
  freight numeric(12, 2) not null default 0 check (freight >= 0),
  other_charges numeric(12, 2) not null default 0 check (other_charges >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  round_off numeric(6, 2) not null default 0 check (round_off between -100 and 100),
  -- Worked out by the server from the items and charges, never sent by the admin.
  subtotal numeric(14, 2) not null default 0,
  tax numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0 check (total >= 0),
  notes text not null default '',
  -- The supplier's bill, a PDF or photo uploaded to the media library.
  attachment text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  received_by text,
  received_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz
);
-- The same supplier bill can't be entered twice; a cancelled one doesn't count.
create unique index purchases_supplier_invoice on purchases (supplier_id, upper(supplier_invoice)) where supplier_invoice <> '' and status <> 'cancelled';
create index purchases_supplier on purchases (supplier_id);

-- A copy of each item as bought, so later catalogue changes never rewrite a bill.
create table purchase_items (
  purchase_id integer not null references purchases on delete cascade,
  position integer not null,
  product_id text not null,
  option_label text not null default '',
  name text not null,
  code text not null default '',
  qty numeric(12, 3) not null check (qty > 0),
  unit text not null,
  -- Before GST, per unit.
  rate numeric(12, 2) not null check (rate >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  gst_rate numeric(4, 2) not null default 0 check (gst_rate in (0, 0.25, 3, 5, 12, 18, 28, 40)),
  primary key (purchase_id, position)
);

-- Money paid to a supplier: against one bill, or on account (an advance, or an old balance).
create table supplier_payments (
  id integer generated always as identity primary key,
  supplier_id integer not null references suppliers,
  purchase_id integer references purchases,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'upi', 'bank', 'cheque')),
  paid_on date not null,
  note text not null default '',
  by text not null,
  created_at timestamptz not null default now()
);
create index supplier_payments_supplier on supplier_payments (supplier_id);
create index supplier_payments_purchase on supplier_payments (purchase_id) where purchase_id is not null;

-- Stock moves from purchases: goods received, and taken back out when a received bill is cancelled.
alter table stock_moves add column purchase_id integer references purchases;
alter table stock_moves drop constraint stock_moves_kind_check;
alter table stock_moves add constraint stock_moves_kind_check check (kind in ('opening', 'count', 'adjust', 'delivered', 'undelivered', 'purchase', 'purchase_cancelled'));
create index stock_moves_purchase on stock_moves (purchase_id) where purchase_id is not null;
