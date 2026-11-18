-- Module 12.1: who changed what and when. Rows are only ever added: nothing in the API edits or deletes them.
create table activity_log (
  id integer generated always as identity primary key,
  at timestamptz not null default now(),
  -- Kept when the staff member is removed; `by` keeps their name as it was.
  staff_id integer references staff_users on delete set null,
  by text not null,
  area text not null,
  summary text not null,
  to_path text,
  -- Only what changed: the list items or fields before and after.
  before jsonb,
  after jsonb
);
create index activity_log_newest on activity_log (at desc);
create index activity_log_by_staff on activity_log (staff_id, at desc);
