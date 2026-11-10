-- One row per customer the shop has given an app token to.
-- shortcut: one person per token; add an app_users table when phone sign-in lets one person use several phones.
create table app_devices (
  id integer generated always as identity primary key,
  -- Who staff gave the token to, so the list makes sense before the app sends a profile.
  label text not null,
  -- Only the hash is stored, so a leaked database can't be used to connect.
  token_hash text not null unique,
  -- What the customer typed on the app's User screen.
  name text not null default '',
  business text not null default '',
  phone text not null default '',
  email text not null default '',
  city text not null default '',
  profile_updated_at timestamptz,
  blocked boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- What the app sends, kept as received. Module 6 turns the order events into real orders.
create table app_events (
  device_id integer not null references app_devices,
  -- The app's own ID for the event, so a resend after a dropped connection is stored once.
  event_id text not null,
  kind text not null check (kind in ('order', 'activity')),
  body jsonb not null,
  received_at timestamptz not null default now(),
  primary key (device_id, event_id)
);
