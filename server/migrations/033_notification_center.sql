-- Notification center: an inbox for every customer (the app) and every staff member (the admin), push to each of a
-- customer's phones (FCM, Expo or Web Push), preferences per category, announcements, and templates for every event.

-- Several phones per account: each login is a session with its own token. Existing logins carry on as sessions.
create table app_sessions (
  id integer generated always as identity primary key,
  account_id integer not null references app_devices on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index app_sessions_account on app_sessions (account_id);
insert into app_sessions (account_id, token_hash, created_at, last_seen_at)
  select id, token_hash, created_at, coalesce(last_seen_at, created_at) from app_devices;

-- Where each phone takes pushes: an FCM token (the Android app), an Expo token, or a browser's subscription (JSON).
-- A session's tokens go with it at logout; a token the push service drops is deleted.
create table device_tokens (
  id integer generated always as identity primary key,
  account_id integer not null references app_devices on delete cascade,
  session_id integer references app_sessions on delete cascade,
  kind text not null check (kind in ('fcm', 'expo', 'web')),
  token text not null unique,
  device_type text not null default 'android' check (device_type in ('android', 'ios', 'web')),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index device_tokens_account on device_tokens (account_id);
insert into device_tokens (account_id, session_id, kind, token, device_type)
  select d.id, (select s.id from app_sessions s where s.token_hash = d.token_hash),
    case when d.push_token like '{%' then 'web' else 'expo' end, d.push_token, case when d.push_token like '{%' then 'web' else 'android' end
  from app_devices d where d.push_token is not null
  on conflict (token) do nothing;

-- Messages the Owner sends to customers or staff, with who they were for.
create table announcements (
  id integer generated always as identity primary key,
  audience text not null check (audience in ('customers', 'staff')),
  -- All of them, or the chosen accounts or roles: {"accountIds": [..]} or {"roles": [..]}.
  target jsonb not null default '{}',
  category text not null,
  title text not null,
  body text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- The inbox: one row per person per event. event_key makes an event notify each person once, however often it's raised.
create table notifications (
  id bigint generated always as identity primary key,
  account_id integer references app_devices on delete cascade,
  staff_id integer references staff_users on delete cascade,
  event text not null,
  category text not null check (category in ('orders', 'payments', 'inventory', 'billing', 'returns', 'customers', 'announcements', 'system')),
  title text not null,
  message text not null,
  entity_type text,
  entity_id text,
  -- Where a tap goes in the app or the admin.
  data jsonb not null default '{}',
  event_key text,
  announcement_id integer references announcements on delete set null,
  is_read boolean not null default false,
  read_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  legacy_log_id integer,
  check ((account_id is null) <> (staff_id is null))
);
create unique index notifications_customer_once on notifications (account_id, event_key) where account_id is not null and event_key is not null;
create unique index notifications_staff_once on notifications (staff_id, event_key) where staff_id is not null and event_key is not null;
create index notifications_customer_inbox on notifications (account_id, id desc) where account_id is not null and deleted_at is null;
create index notifications_staff_inbox on notifications (staff_id, id desc) where staff_id is not null and deleted_at is null;
create index notifications_customer_unread on notifications (account_id) where account_id is not null and not is_read and deleted_at is null;
create index notifications_staff_unread on notifications (staff_id) where staff_id is not null and not is_read and deleted_at is null;
create index notifications_announcement on notifications (announcement_id) where announcement_id is not null;
create index notifications_created on notifications (created_at);

-- The app's inbox so far lived in the delivery log: each customer's rows become notifications.
insert into notifications (account_id, event, category, title, message, entity_type, entity_id, data, event_key, is_read, read_at, created_at, legacy_log_id)
  select l.device_id, l.event, case when l.event = 'broadcast' then 'announcements' else 'orders' end, l.title, l.body,
    case when l.order_id is not null then 'order' end, l.order_id::text, coalesce(l.data, '{}'), null,
    l.read_at is not null, l.read_at, l.created_at, l.id
  from notification_log l where l.channel = 'push' and l.device_id is not null;

-- The delivery log keeps one row per phone (or email) per message, pointing at the notification it delivers.
alter table notification_log
  add column notification_id bigint references notifications on delete set null,
  add column device_token_id integer references device_tokens on delete set null;
update notification_log l set notification_id = n.id from notifications n where n.legacy_log_id = l.id;
alter table notifications drop column legacy_log_id;
create index notification_log_notification on notification_log (notification_id) where notification_id is not null;
drop index if exists notification_log_inbox;

-- Each person's choices. A category turned off is still listed, already read: no alert, no badge.
create table notification_preferences (
  id integer generated always as identity primary key,
  account_id integer unique references app_devices on delete cascade,
  staff_id integer unique references staff_users on delete cascade,
  orders_enabled boolean not null default true,
  payments_enabled boolean not null default true,
  inventory_enabled boolean not null default true,
  billing_enabled boolean not null default true,
  returns_enabled boolean not null default true,
  customers_enabled boolean not null default true,
  announcements_enabled boolean not null default true,
  sound_enabled boolean not null default true,
  vibration_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  check ((account_id is null) <> (staff_id is null))
);

-- Scheduled work (payment reminders, clearing old notifications) runs at most this often, however many servers ask.
create table scheduled_runs (
  name text primary key,
  last_run_at timestamptz not null default 'epoch'
);
insert into scheduled_runs (name) values ('payment_reminders'), ('retention');

-- Templates for every event: who it's for (customers in the app, staff in the admin) and its category.
alter table notification_templates drop constraint notification_templates_channel_check;
alter table notification_templates add constraint notification_templates_channel_check check (channel in ('push', 'email', 'inbox'));
alter table notification_templates
  add column audience text not null default 'customer' check (audience in ('customer', 'staff')),
  add column category text not null default 'orders';
update notification_templates set audience = 'staff' where event = 'placed';
insert into notification_templates (event, channel, audience, category, title, body, sort_order) values
  ('received', 'push', 'customer', 'orders', 'Order {number} received', 'Thank you! Vimalnath has your order {number} ({items}, {total} at MRP). We’ll confirm it soon.', 6),
  ('requested', 'push', 'customer', 'orders', 'Order {number} to confirm', 'Vimalnath sent you order {number} ({items}). Open it to confirm or decline.', 7),
  ('order_updated', 'push', 'customer', 'orders', 'Order {number} updated', 'The bill for your order {number} is now {total}.', 8),
  ('payment_received', 'push', 'customer', 'payments', 'Payment received', 'Thank you! We’ve received {amount} for {number}. {balance}', 9),
  ('payment_due', 'push', 'customer', 'payments', 'Payment due {due}', '{amount} for {number} is due on {due}.', 10),
  ('payment_overdue', 'push', 'customer', 'payments', 'Payment overdue: {number}', '{amount} for {number} was due on {due}. Please pay at the earliest.', 11),
  ('invoice_created', 'push', 'customer', 'billing', 'Tax invoice {number}', 'Your tax invoice {number} for {total} is ready.', 12),
  ('invoice_updated', 'push', 'customer', 'billing', 'Tax invoice {number} corrected', 'Your tax invoice {number} was corrected: the total is now {total}.', 13),
  ('invoice_paid', 'push', 'customer', 'billing', 'Paid in full: {number}', 'Thank you! {number} ({total}) is paid in full.', 14),
  ('credit_note', 'push', 'customer', 'billing', 'Credit note {number}', 'Credit note {number} for {total} was issued against {invoice} for the goods returned.', 15),
  ('return_recorded', 'push', 'customer', 'returns', '{kind} {number} recorded', 'Vimalnath has recorded your {kind} {number} ({items}). We’ll tell you when it’s decided.', 16),
  ('return_approved', 'push', 'customer', 'returns', '{kind} {number} approved', 'Your {kind} {number} is approved.', 17),
  ('return_rejected', 'push', 'customer', 'returns', '{kind} {number} not approved', 'Your {kind} {number} wasn’t approved. {reason}', 18),
  ('return_completed', 'push', 'customer', 'returns', '{kind} {number} complete', 'Your {kind} {number} is complete.', 19),
  ('request_answered', 'inbox', 'staff', 'orders', '{customer} {answer} {number}', '{customer} {answer} order {number} in the app.', 30),
  ('payment_recorded', 'inbox', 'staff', 'payments', '{amount} received for {number}', '{by} recorded {amount} from {customer} for {number}.', 31),
  ('payments_overdue', 'inbox', 'staff', 'payments', '{count} overdue', '{count} past their due day: {amount} to collect.', 32),
  ('low_stock', 'inbox', 'staff', 'inventory', 'Low stock: {item}', '{item} is down to {qty} (minimum {min}).', 33),
  ('out_of_stock', 'inbox', 'staff', 'inventory', 'Out of stock: {item}', '{item} is out of stock ({qty}).', 34),
  ('stock_updated', 'inbox', 'staff', 'inventory', 'Stock changed: {item}', '{by} changed {item} by {change}: now {qty}.', 35),
  ('purchase_received', 'inbox', 'staff', 'inventory', 'Purchase {number} received', '{by} received {number} from {supplier}: {total}.', 36),
  ('bill_finalized', 'inbox', 'staff', 'billing', 'Bill {number}: {total}', '{by} billed {customer} {total} ({number}).', 37),
  ('bill_updated', 'inbox', 'staff', 'billing', 'Bill {number} corrected', '{by} finalized {number} again after correcting it: {total}.', 38),
  ('bill_paid', 'inbox', 'staff', 'billing', 'Bill {number} paid in full', '{customer} has paid {number} ({total}) in full.', 39),
  ('credit_note_issued', 'inbox', 'staff', 'billing', 'Credit note {number}', 'Credit note {number} for {total} against {invoice} ({customer}).', 40),
  ('discount_request', 'inbox', 'staff', 'billing', 'Discount approval: {item}', '{by} asks for {pct}% on {item} for {customer}.', 41),
  ('discount_decided', 'inbox', 'staff', 'billing', 'Discount {decision}: {item}', '{by} {decision} {pct}% on {item}. {reason}', 42),
  ('return_requested', 'inbox', 'staff', 'returns', 'New {kind} {number}', '{by} recorded {kind} {number} from {customer}: {items}, {total}.', 43),
  ('return_decided', 'inbox', 'staff', 'returns', '{kind} {number} {decision}', '{by} {decision} {kind} {number} from {customer}.', 44),
  ('return_finished', 'inbox', 'staff', 'returns', '{kind} {number} complete', '{kind} {number} from {customer} is complete.', 45),
  ('customer_registered', 'inbox', 'staff', 'customers', 'New app account: {customer}', '{customer} registered in the app: {details}.', 46),
  ('customer_updated', 'inbox', 'staff', 'customers', '{customer} updated their profile', '{customer} changed their details in the app: {details}.', 47);
