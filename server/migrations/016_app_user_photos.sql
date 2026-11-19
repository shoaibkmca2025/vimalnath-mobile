-- A customer's own photo, taken or chosen when they create their account (and changed later on the app's User screen).
-- Kept apart from media_files: those are served publicly at /v1/media, but a customer's photo is only for signed-in
-- staff, who see it under App Users.
create table app_user_photos (
  device_id integer primary key references app_devices on delete cascade,
  -- WebP, re-encoded on arrival, which also drops camera details such as location. Up to 800 px, and 240 px for lists.
  data bytea not null,
  small bytea not null,
  updated_at timestamptz not null default now()
);
