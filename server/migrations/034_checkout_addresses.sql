-- Checkout and delivery addresses: each customer account carries its shop's details (shop name, GSTIN, shop address),
-- an address book, and every order keeps a copy of where it was delivered as it was when placed.

-- The shop: its name stays in `business`; the GSTIN and the shop's address are new. Empty for accounts made before.
alter table app_devices
  add column gstin text not null default '',
  add column address_line text not null default '',
  add column area text not null default '',
  add column landmark text not null default '',
  add column state text not null default '',
  add column pincode text not null default '';

-- The address book: the shop, home, sites and others, one of them the default for delivery.
create table customer_addresses (
  id integer generated always as identity primary key,
  account_id integer not null references app_devices on delete cascade,
  address_type text not null check (address_type in ('shop', 'home', 'site', 'other')),
  -- What the customer calls it, e.g. "Godown" for an "other" address, or a site's project name.
  label text not null default '',
  receiver_name text not null,
  contact_number text not null,
  alternate_contact text not null default '',
  site_name text not null default '',
  address_line text not null,
  area text not null default '',
  landmark text not null default '',
  city text not null,
  state text not null,
  pincode text not null check (pincode ~ '^\d{6}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customer_addresses_account on customer_addresses (account_id);
create unique index customer_addresses_one_default on customer_addresses (account_id) where is_default;

-- Where each order goes, copied when it's placed: later changes to the profile or the address book never change it.
-- `delivery` holds the whole copy; the columns are what staff search and sort by.
alter table orders
  add column delivery jsonb,
  add column delivery_receiver_name text not null default '',
  add column delivery_contact text not null default '',
  add column delivery_alternate_contact text not null default '',
  add column delivery_address_type text check (delivery_address_type in ('saved', 'temporary', 'site')),
  add column delivery_site_name text not null default '',
  add column delivery_instructions text not null default '',
  -- The saved address it came from, if any (only a link: the copy above is what counts).
  add column delivery_address_id integer references customer_addresses on delete set null;
