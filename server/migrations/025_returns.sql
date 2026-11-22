-- Phase 4, Returns & Replacements (docs/ERP-ROADMAP.md): customers' returns and exchanges against their orders, refunds
-- and store credit, GST credit notes against posted tax invoices, and goods sent back to suppliers. Money and stock only
-- ever change through ledgers (refund_transactions, order_payments, stock_moves); records are cancelled, never deleted.

-- Stock that can't be sold: goods back from customers wait for inspection (held), and damaged or defective goods are
-- kept apart. `quantity` stays what can be sold, so everything that already reads it is unchanged.
alter table stock_items
  add column held numeric(12, 3) not null default 0 check (held >= 0),
  add column damaged numeric(12, 3) not null default 0 check (damaged >= 0),
  add column defective numeric(12, 3) not null default 0 check (defective >= 0);

-- How the shop handles returns. One row; Owners change it.
create table return_settings (
  only_one boolean primary key default true check (only_one),
  -- Days after delivery a return is expected within; 0 for no limit. A later return still goes in, flagged, and always
  -- waits for approval: nothing already sold is refused by a setting.
  eligibility_days integer not null default 30 check (eligibility_days between 0 and 3650),
  -- Off: a new return is approved as it's created, by someone allowed to approve.
  require_approval boolean not null default true,
  allow_replacements boolean not null default true,
  -- On: a refund waits for someone allowed to approve before it can be paid.
  refund_approval boolean not null default false,
  -- Category ids whose products are returnable; empty for every category. Others are flagged, never refused.
  eligible_categories text[] not null default '{}',
  -- inspect: everything waits for the quality check. unopened: unopened goods go straight back on sale.
  restock_rule text not null default 'inspect' check (restock_rule in ('inspect', 'unopened')),
  -- keep: damaged goods stay in damaged stock (to send back or sell as seconds). write_off: they leave stock.
  damaged_handling text not null default 'keep' check (damaged_handling in ('keep', 'write_off')),
  -- A replacement can't take stock below zero unless this is on.
  allow_negative_stock boolean not null default false,
  -- For orders with a posted tax invoice. invoice: a credit note for the goods back and a tax invoice for the goods
  -- given. none: no GST documents (e.g. a like-for-like warranty swap). The accountant confirms which applies.
  replacement_tax text not null default 'invoice' check (replacement_tax in ('invoice', 'none')),
  -- Issue the GST credit note as the goods come back; off, staff issue it from the return.
  credit_note_on_receipt boolean not null default true,
  return_prefix text not null default 'RET' check (return_prefix ~ '^[A-Z0-9]{1,6}$'),
  credit_note_prefix text not null default 'CN' check (credit_note_prefix ~ '^[A-Z0-9]{1,6}$'),
  supplier_return_prefix text not null default 'SRN' check (supplier_return_prefix ~ '^[A-Z0-9]{1,6}$'),
  refund_methods text[] not null default '{cash,upi,bank,cheque,original,store_credit,adjustment}',
  -- Printed on the return receipt.
  terms text not null default '',
  -- Which roles may do what. Owners always may.
  permissions jsonb not null default '{"create": ["sales"], "approve": [], "receive": ["inventory"], "inspect": ["inventory"], "refund": []}',
  updated_by text,
  updated_at timestamptz
);
insert into return_settings default values;

create sequence return_numbers;

-- A customer's return of goods from one order: for money back (refund) or for other goods (replacement).
create table sales_returns (
  id integer generated always as identity primary key,
  number text not null unique,
  kind text not null check (kind in ('refund', 'replacement')),
  order_id integer not null references orders,
  -- The order's posted tax invoice when the return was made: its lines and tax are what the return gives back.
  invoice_id integer references sales_invoices,
  customer_id integer references customers,
  customer_name text not null,
  customer_phone text not null default '',
  return_date date not null,
  reason text not null check (reason in ('wrong_product', 'damaged', 'defective', 'wrong_size', 'changed_mind', 'duplicate_order', 'quality', 'other')),
  reason_note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'under_review', 'approved', 'rejected', 'received', 'inspected', 'refunded', 'replaced', 'closed', 'cancelled')),
  -- Whole rupees, worked out here from the items. The goods back, as billed (GST included):
  return_value integer not null default 0,
  -- The goods given in exchange, GST included:
  replacement_value integer not null default 0,
  -- Approved deductions, e.g. a restocking charge, where legally and commercially applicable.
  charges integer not null default 0 check (charges >= 0),
  charges_note text not null default '',
  -- return_value − charges − replacement_value: above 0 the shop owes the customer, below 0 the customer owes the shop.
  settle_amount integer not null default 0,
  -- Flags for whoever approves: returned later than the eligibility period, or a category not returnable.
  flags text[] not null default '{}',
  attachments text[] not null default '{}',
  notes text not null default '',
  -- Bumped on every change: an action sent with an older version was decided on an out-of-date screen and is refused.
  version integer not null default 1,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sales_returns_order on sales_returns (order_id);
create index sales_returns_customer on sales_returns (customer_id);
create index sales_returns_date on sales_returns (return_date);

-- The goods coming back: a copy of the line as it was sold, so later price or GST changes never rewrite it.
create table sales_return_items (
  return_id integer not null references sales_returns on delete cascade,
  position integer not null,
  -- The sold line it comes from: an invoice line when the order was invoiced, otherwise an order line.
  source text not null check (source in ('invoice', 'order')),
  source_position integer not null,
  product_id text not null,
  option_label text not null default '',
  description text not null,
  name text not null default '',
  hsn text not null default '',
  unit text not null default 'pcs',
  qty numeric(12, 3) not null check (qty > 0),
  -- Per unit as sold: before GST after the line discount (invoiced), or the price billed (not invoiced).
  rate numeric(14, 4) not null check (rate >= 0),
  gst_rate numeric(4, 2) not null default 0,
  taxable numeric(14, 2) not null default 0,
  cgst numeric(14, 2) not null default 0,
  sgst numeric(14, 2) not null default 0,
  igst numeric(14, 2) not null default 0,
  amount numeric(14, 2) not null default 0,
  condition text not null check (condition in ('unopened', 'good', 'opened', 'damaged', 'defective', 'used', 'incomplete')),
  -- The quality check: back on sale, damaged or defective stock, or written off.
  outcome text check (outcome in ('restock', 'damaged', 'defective', 'write_off')),
  outcome_note text not null default '',
  inspected_by text,
  inspected_at timestamptz,
  primary key (return_id, position)
);

-- The goods given in exchange for a replacement, priced as the shop bills them.
create table replacement_items (
  return_id integer not null references sales_returns on delete cascade,
  position integer not null,
  product_id text not null,
  option_label text not null default '',
  description text not null,
  name text not null default '',
  hsn text not null default '',
  unit text not null default 'pcs',
  qty numeric(12, 3) not null check (qty > 0),
  -- Before GST for an invoiced order, the billed price otherwise.
  rate numeric(12, 2) not null check (rate >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  gst_rate numeric(4, 2) not null default 0,
  taxable numeric(14, 2) not null default 0,
  cgst numeric(14, 2) not null default 0,
  sgst numeric(14, 2) not null default 0,
  igst numeric(14, 2) not null default 0,
  amount numeric(14, 2) not null default 0,
  primary key (return_id, position)
);

-- Everything that happened to a return, in order: the status history and audit log in one.
create table return_events (
  id bigint generated always as identity primary key,
  return_id integer not null references sales_returns on delete cascade,
  kind text not null check (kind in ('created', 'edited', 'status', 'received', 'inspected', 'replaced', 'credit_note', 'refund', 'note', 'attachment')),
  from_status text,
  to_status text,
  note text not null default '',
  by text not null,
  at timestamptz not null default now()
);
create index return_events_return on return_events (return_id, id);

-- GST credit notes against posted tax invoices, for goods returned. Figures come from the return's items.
create table sales_credit_notes (
  id integer generated always as identity primary key,
  return_id integer not null references sales_returns,
  invoice_id integer not null references sales_invoices,
  number text not null unique,
  financial_year text not null,
  note_date date not null,
  status text not null default 'posted' check (status in ('posted', 'cancelled')),
  customer_name text not null,
  customer_gstin text not null default '',
  place_of_supply text not null default '',
  pos_code text not null default '',
  interstate boolean not null default false,
  seller_gstin text not null default '',
  taxable numeric(14, 2) not null default 0,
  cgst numeric(14, 2) not null default 0,
  sgst numeric(14, 2) not null default 0,
  igst numeric(14, 2) not null default 0,
  round_off numeric(6, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  created_by text not null,
  created_at timestamptz not null default now(),
  cancelled_by text,
  cancelled_at timestamptz,
  cancel_reason text not null default ''
);
create unique index sales_credit_notes_one_per_return on sales_credit_notes (return_id) where status = 'posted';
create index sales_credit_notes_date on sales_credit_notes (note_date);

-- A replacement's tax invoice for the goods given belongs to the original order too, so an order has one ordinary
-- invoice plus any for its replacements.
alter table sales_invoices add column return_id integer references sales_returns;
drop index sales_invoices_one_per_order;
create unique index sales_invoices_one_per_order on sales_invoices (order_id) where status <> 'cancelled' and return_id is null;
create unique index sales_invoices_one_per_return on sales_invoices (return_id) where status <> 'cancelled' and return_id is not null;

-- Money settling a return. out: the shop pays the customer (refund, store credit, or paying off one of their orders).
-- in: the customer pays the difference for a dearer replacement. Never deleted: a mistake is cancelled.
create table refund_transactions (
  id integer generated always as identity primary key,
  return_id integer not null references sales_returns,
  direction text not null default 'out' check (direction in ('out', 'in')),
  amount integer not null check (amount > 0),
  method text not null check (method in ('cash', 'upi', 'bank', 'cheque', 'original', 'store_credit', 'adjustment')),
  -- adjustment: the order whose balance it pays, and the payment recorded there.
  order_id integer references orders,
  order_payment_id integer,
  reference text not null default '',
  paid_on date,
  status text not null default 'pending' check (status in ('pending', 'approved', 'processing', 'completed', 'failed', 'cancelled')),
  note text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  completed_by text,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index refund_transactions_return on refund_transactions (return_id);

-- Customer payments can now be settled from a return (`return`) or from store credit the customer holds.
alter table order_payments drop constraint order_payments_method_check;
alter table order_payments add constraint order_payments_method_check check (method in ('cash', 'upi', 'bank', 'cheque', 'return', 'store_credit'));
alter table order_payments add column refund_id integer references refund_transactions;
alter table refund_transactions add constraint refund_transactions_payment foreign key (order_payment_id) references order_payments;

-- Goods sent back to a supplier against one of their bills.
create sequence supplier_return_numbers;

create table supplier_returns (
  id integer generated always as identity primary key,
  number text not null unique,
  supplier_id integer not null references suppliers,
  purchase_id integer not null references purchases,
  return_date date not null,
  reason text not null check (reason in ('wrong_product', 'damaged', 'defective', 'wrong_size', 'excess', 'quality', 'other')),
  reason_note text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved', 'dispatched', 'supplier_received', 'credited', 'settled', 'closed', 'cancelled')),
  -- The shop's challan or reference for the goods sent, and how they went.
  challan text not null default '',
  transport text not null default '',
  -- From the bill's rates, worked out here.
  interstate boolean not null default false,
  taxable numeric(14, 2) not null default 0,
  tax numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  -- The supplier's credit note: it lowers what the shop owes them, and the input tax credit.
  credit_note_number text not null default '',
  credit_note_date date,
  credit_note_amount numeric(14, 2) check (credit_note_amount >= 0),
  credit_note_tax numeric(14, 2) check (credit_note_tax >= 0),
  -- How it was settled: against what the shop owes them (adjust), or money back (refund).
  settlement text check (settlement in ('adjust', 'refund')),
  refund_amount numeric(14, 2) check (refund_amount >= 0),
  refund_method text check (refund_method in ('cash', 'upi', 'bank', 'cheque')),
  refund_reference text not null default '',
  refunded_on date,
  attachments text[] not null default '{}',
  notes text not null default '',
  version integer not null default 1,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index supplier_returns_supplier on supplier_returns (supplier_id);
create index supplier_returns_purchase on supplier_returns (purchase_id);

create table supplier_return_items (
  supplier_return_id integer not null references supplier_returns on delete cascade,
  position integer not null,
  purchase_position integer not null,
  product_id text not null,
  option_label text not null default '',
  name text not null,
  code text not null default '',
  qty numeric(12, 3) not null check (qty > 0),
  unit text not null,
  -- Per unit after the bill's line discount, before GST.
  rate numeric(14, 4) not null check (rate >= 0),
  gst_rate numeric(4, 2) not null default 0,
  taxable numeric(14, 2) not null default 0,
  tax numeric(14, 2) not null default 0,
  -- Which stock it leaves from.
  bucket text not null default 'available' check (bucket in ('available', 'damaged', 'defective')),
  primary key (supplier_return_id, position)
);

create table supplier_return_events (
  id bigint generated always as identity primary key,
  supplier_return_id integer not null references supplier_returns on delete cascade,
  kind text not null check (kind in ('created', 'edited', 'status', 'credit_note', 'settled', 'note')),
  from_status text,
  to_status text,
  note text not null default '',
  by text not null,
  at timestamptz not null default now()
);
create index supplier_return_events_return on supplier_return_events (supplier_return_id, id);

-- Every stock change says which stock it moved (what can be sold, or held, damaged, defective) and which return made it.
alter table stock_moves
  add column bucket text not null default 'available' check (bucket in ('available', 'held', 'damaged', 'defective')),
  add column return_id integer references sales_returns,
  add column supplier_return_id integer references supplier_returns;
alter table stock_moves drop constraint stock_moves_kind_check;
alter table stock_moves add constraint stock_moves_kind_check check (kind in (
  'opening', 'count', 'adjust', 'delivered', 'undelivered', 'purchase', 'purchase_cancelled',
  'return_received', 'return_inspected', 'return_reversed', 'replacement', 'replacement_reversed', 'written_off',
  'supplier_return', 'supplier_return_reversed'));
create index stock_moves_return on stock_moves (return_id) where return_id is not null;
create index stock_moves_supplier_return on stock_moves (supplier_return_id) where supplier_return_id is not null;

