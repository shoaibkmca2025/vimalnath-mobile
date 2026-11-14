-- Every MRP change (plan 4.9), from the product editor or the Prices page. Never edited or deleted.
create table price_changes (
  id bigint generated always as identity primary key,
  -- Copies, not references, so the history still reads right after a product is renamed or deleted.
  product_id text not null,
  code text not null,
  product text not null,
  option_label text not null,
  -- Empty old price: the option was added. Empty new price: it was removed.
  old_mrp integer,
  new_mrp integer,
  changed_by text not null,
  -- What the person was doing, for example "Raised 312 prices by 8%".
  reason text not null default '',
  changed_at timestamptz not null default now()
);
