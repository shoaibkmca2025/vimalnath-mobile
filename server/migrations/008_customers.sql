-- Customers (Module 7). Each app user (one phone with a shop token) belongs to one customer; a customer with two
-- phones has two app users. Orders come from app users, so they reach their customer through them.
create table customers (
  id integer generated always as identity primary key,
  name text not null,
  -- Staff only, never shown in the app.
  tags text[] not null default '{}',
  note text not null default '',
  -- Set when staff merge this record into another: its phones, and so its orders, now belong to that one.
  merged_into integer references customers,
  created_at timestamptz not null default now()
);

alter table app_devices add column customer_id integer references customers;

-- A customer for every app user that exists already, named as staff named the app user.
alter table customers add column device_id integer;
insert into customers (name, created_at, device_id) select label, created_at, id from app_devices order by id;
update app_devices d set customer_id = c.id from customers c where c.device_id = d.id;
alter table customers drop column device_id;
alter table app_devices alter column customer_id set not null;
