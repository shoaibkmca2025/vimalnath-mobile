-- Orders from the app (Module 6). Orders are never deleted: a mistake is cancelled, and that can be reversed.

-- One shared counter, so no two orders ever get the same VSC- number, even at the same moment.
create sequence order_numbers;

create table orders (
  id integer generated always as identity primary key,
  number text not null unique,
  device_id integer not null references app_devices,
  -- The app's ids for the order and for sending it: a resend after a dropped connection is stored once.
  client_event_id text not null,
  client_order_id text not null,
  customer text not null,
  phone text not null default '',
  notes text not null default '',
  status text not null default 'placed' check (status in ('placed', 'confirmed', 'dispatched', 'delivered', 'cancelled')),
  -- Whole rupees: the lines that have an MRP. Catalogue-priced lines are listed but left out, as the app does.
  total integer not null,
  -- When the customer placed it, which can be earlier than it arrived if their phone was offline.
  placed_at timestamptz not null,
  received_at timestamptz not null default now(),
  -- Staff only; the app never sees it.
  internal_note text,
  internal_note_by text,
  internal_note_at timestamptz,
  unique (device_id, client_event_id)
);

-- A copy of each line as it was when ordered, so later catalogue changes never rewrite an order.
create table order_lines (
  order_id integer not null references orders,
  position integer not null,
  -- No reference to products: a product can be deleted, and the line keeps its copy.
  product_id text not null,
  code text not null,
  name text not null,
  option text,
  option_code text,
  note text,
  qty integer not null check (qty > 0),
  -- The server's MRP when the order arrived, never the phone's. Empty when priced from the catalogue page.
  mrp integer,
  -- Why staff should look at this line, for example a product no longer in the catalogue.
  problem text,
  primary key (order_id, position)
);

create table order_events (
  order_id integer not null references orders,
  status text not null,
  at timestamptz not null default now(),
  -- 'App' for the order itself, otherwise the staff member's name as it was then.
  by text not null
);
create index order_events_order on order_events (order_id, at);

-- Module 3 kept orders in app_events until this module. None were ever stored outside test databases,
-- so this stops rather than guess, if any turn up.
do $$
begin
  if exists (select 1 from app_events where kind = 'order') then
    raise exception 'app_events still holds orders from before Module 6. Move them into orders first.';
  end if;
end $$;
alter table app_events drop constraint app_events_kind_check, add constraint app_events_kind_check check (kind = 'activity');
