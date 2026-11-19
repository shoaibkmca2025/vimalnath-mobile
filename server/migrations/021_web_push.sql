-- Phone notifications for the web app on a home screen (Web Push). The shop signs every message with this key pair
-- (VAPID); the server makes it the first time it's needed and keeps it here, so there's nothing to set up. One row.
-- A phone's own push address goes in app_devices.push_token, as for the native app (there as JSON, starting with '{').
create table web_push_keys (
  only_one boolean primary key default true check (only_one),
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
