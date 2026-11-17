-- Module 9.4: other 4AM Global Media apps, listed under More Apps in the app.
create table more_apps (
  id integer generated always as identity primary key,
  name text not null,
  description text not null,
  icon text,
  play_store text not null,
  app_store text not null,
  sort_order integer not null
);
