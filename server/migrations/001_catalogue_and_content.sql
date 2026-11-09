-- Everything the app shows today, so its data can be imported once and then managed from the admin.
-- shortcut: image columns hold the app's /media/... paths, until Module 5 moves the files to cloud storage.

create table categories (
  id text primary key,
  label text not null,
  image text not null,
  image_fit text not null check (image_fit in ('cover', 'contain')),
  visible boolean not null default true,
  sort_order integer not null
);

create table products (
  id text primary key,
  -- Not unique: 55 codes appear on more than one product, because the catalogues repeat items.
  code text not null,
  -- Empty when the catalogue only prints the code; the app shows the section instead.
  name text not null default '',
  section text not null,
  category_id text not null references categories,
  catalogue_source text not null check (catalogue_source in ('master', 'office', 'tavic')),
  catalogue_page integer not null,
  image text,
  featured boolean not null default false,
  visible boolean not null default true,
  sort_order integer not null
);

create table product_options (
  id integer generated always as identity primary key,
  product_id text not null references products on delete cascade,
  -- Unique per product, because reorders and saved carts find an option by its label.
  label text not null,
  code text,
  mrp integer not null check (mrp > 0),
  sort_order integer not null,
  unique (product_id, label)
);

create table product_specs (
  product_id text not null references products on delete cascade,
  sort_order integer not null,
  label text not null,
  value text not null,
  primary key (product_id, sort_order)
);

create table catalogue_pages (
  source text not null check (source in ('master', 'office', 'tavic')),
  page integer not null,
  image text not null,
  primary key (source, page)
);

create table price_lists (
  number text primary key,
  kicker text not null,
  title text not null,
  meta text not null,
  tone text not null,
  -- Empty until published; the app shows "coming soon".
  url text not null default '',
  sort_order integer not null
);

create table cutlist_systems (
  id text primary key,
  name text not null,
  subtitle text not null,
  photo text,
  sort_order integer not null
);

create table cutlist_configurations (
  id integer generated always as identity primary key,
  system_id text not null references cutlist_systems,
  name text not null,
  image text not null,
  sort_order integer not null,
  unique (system_id, name)
);

create table bar_sections (
  code text primary key,
  name text not null,
  system text not null,
  bar_mm integer not null check (bar_mm > 0),
  dimensions text not null,
  description text not null,
  sort_order integer not null
);

create table banners (
  id text primary key,
  image text not null,
  kicker text not null,
  headline text not null,
  body text not null,
  active boolean not null default true,
  sort_order integer not null
);

create table video_sections (
  id integer generated always as identity primary key,
  title text not null,
  sort_order integer not null
);

create table videos (
  id integer generated always as identity primary key,
  section_id integer not null references video_sections on delete cascade,
  title text not null,
  detail text not null,
  url text not null,
  sort_order integer not null
);

create table settings (
  key text primary key,
  value text not null
);
