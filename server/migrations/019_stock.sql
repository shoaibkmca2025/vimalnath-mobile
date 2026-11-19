-- Stock, stage 1 of inventory. One row per item the shop counts: a product option, or a product without options
-- (option ''). Kept apart from product_options, which every product save rewrites, and never sent to phones.
-- An item is tracked from the moment it has a row: delivered orders only take stock from tracked items.
create table stock_items (
  product_id text not null references products on delete cascade,
  -- The option's name, as order lines and saved carts give it; '' for a product without options.
  option_label text not null default '',
  sku text not null default '',
  barcode text not null default '',
  unit text not null default 'pcs' check (unit in ('pcs', 'box', 'kg', 'meter', 'feet', 'set')),
  brand text not null default '',
  manufacturer text not null default '',
  hsn text not null default '',
  gst_rate numeric(4, 2) check (gst_rate in (0, 0.25, 3, 5, 12, 18, 28, 40)),
  -- Rupees and paise, before GST. Empty: not known yet. Only Owners see the purchase price.
  purchase_price numeric(12, 2) check (purchase_price >= 0),
  selling_price numeric(12, 2) check (selling_price >= 0),
  wholesale_price numeric(12, 2) check (wholesale_price >= 0),
  -- What there is now, changed only together with a stock_moves row. It goes below zero when more is delivered than
  -- was counted, which tells staff to count it again.
  quantity numeric(12, 3) not null default 0,
  min_stock numeric(12, 3) check (min_stock >= 0),
  max_stock numeric(12, 3) check (max_stock >= 0),
  rack text not null default '',
  location text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, option_label)
);

-- Every change to a quantity: the opening count, recounts, adjustments, and orders delivered or taken back.
create table stock_moves (
  id bigint generated always as identity primary key,
  product_id text not null,
  option_label text not null,
  -- Positive in, negative out.
  change numeric(12, 3) not null,
  -- The quantity after this change.
  balance numeric(12, 3) not null,
  kind text not null check (kind in ('opening', 'count', 'adjust', 'delivered', 'undelivered')),
  reason text not null default '',
  note text not null default '',
  order_id integer references orders,
  -- The staff member's name as it was then.
  by text not null,
  at timestamptz not null default now(),
  foreign key (product_id, option_label) references stock_items on delete cascade
);
create index stock_moves_item on stock_moves (product_id, option_label, id);
create index stock_moves_order on stock_moves (order_id) where order_id is not null;
