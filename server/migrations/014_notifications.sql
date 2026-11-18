-- Module 10: messages to customers' phones and to staff, queued with the change that causes them and sent in the background.

-- 3.5: the address Expo gives this phone for notifications; the app refreshes it whenever it changes.
alter table app_devices add column push_token text;

-- 10.3: the wording for each event, editable by the Owner. {number}, {customer}, {total} and {items} are filled in.
create table notification_templates (
  event text primary key,
  channel text not null check (channel in ('push', 'email')),
  title text not null,
  body text not null,
  sort_order integer not null
);
insert into notification_templates (event, channel, title, body, sort_order) values
  ('placed', 'email', 'New order {number} from {customer}', '{customer} placed {number} in the app: {items}, {total} at MRP. Open the admin to confirm it.', 1),
  ('confirmed', 'push', 'Order {number} confirmed', 'Vimalnath has confirmed your order {number}.', 2),
  ('dispatched', 'push', 'Order {number} dispatched', 'Your order {number} is on its way.', 3),
  ('delivered', 'push', 'Order {number} delivered', 'Your order {number} has been delivered. Thank you!', 4),
  ('cancelled', 'push', 'Order {number} cancelled', 'Your order {number} has been cancelled. Call us if you didn’t expect this.', 5);

-- 10.2: who gets an email for each new order.
create table staff_alert_recipients (email text primary key);

-- 10.4: what was sent, to whom, when, and whether it worked. Rows start pending; the sender picks them up.
create table notification_log (
  id integer generated always as identity primary key,
  event text not null,
  channel text not null check (channel in ('push', 'email')),
  recipient text not null,
  device_id integer references app_devices on delete set null,
  order_id integer references orders on delete set null,
  title text not null,
  body text not null,
  data jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_log_pending on notification_log (id) where status = 'pending';
create index notification_log_newest on notification_log (created_at desc);
