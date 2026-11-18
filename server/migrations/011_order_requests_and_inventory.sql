-- Order requests and the inventory team.
-- Staff can now send an order to a customer's app ('requested'); the customer confirms it (it then goes to
-- the inventory team, like any confirmed order) or declines it. The inventory team packs and dispatches
-- confirmed orders, and keeps a note on each that the rest of the staff can read.

alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('requested', 'declined', 'placed', 'confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'));

-- 'app': placed from the phone's cart. 'admin': sent from the admin as a request for the customer to confirm.
alter table orders add column source text not null default 'app' check (source in ('app', 'admin'));

alter table orders add column inventory_note text;
alter table orders add column inventory_note_by text;
alter table orders add column inventory_note_at timestamptz;

-- The inventory team sees confirmed, packed and dispatched orders.
create index orders_status on orders (status);

alter table staff_users drop constraint staff_users_role_check;
alter table staff_users add constraint staff_users_role_check check (role in ('owner', 'sales', 'catalogue', 'inventory'));
