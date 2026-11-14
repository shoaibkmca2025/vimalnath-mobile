-- Every photo and PDF uploaded from the admin.
-- shortcut: the files live in the database, which keeps backups to one place. Move them to S3 or R2 behind a
-- CDN (plan 5.2) when hosting is chosen; their /v1/media addresses can stay the same.
create table media_files (
  -- Random, and part of the address (/v1/media/<id>.webp), so a replaced file always gets a new one.
  id text primary key,
  kind text not null check (kind in ('image', 'pdf')),
  -- The name it had on the uploader's computer, for the media library later.
  name text not null,
  type text not null check (type in ('image/webp', 'application/pdf')),
  bytes integer not null,
  width integer,
  height integer,
  -- Images are re-encoded as WebP, which also drops camera details such as location. PDFs are kept as uploaded.
  data bytea not null,
  -- Smaller WebP copies for lists (small) and cards (medium). Empty for PDFs.
  small bytea,
  medium bytea,
  uploaded_by integer references staff_users on delete set null,
  uploaded_at timestamptz not null default now()
);
