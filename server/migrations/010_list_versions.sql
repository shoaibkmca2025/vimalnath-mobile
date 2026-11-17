-- A save counter for each list the admin saves whole, so a save made from an out-of-date copy is refused
-- instead of quietly replacing someone else's change. The names are the admin's own.
create table list_versions (
  name text primary key,
  version integer not null default 0
);
insert into list_versions (name) values ('categories'), ('catalogues'), ('cutlist'), ('sections'), ('banners'), ('videoSections'), ('moreApps'), ('settings');
