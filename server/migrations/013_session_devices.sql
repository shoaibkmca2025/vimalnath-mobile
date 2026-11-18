-- Module 2.6: which devices a staff member is signed in on, so they can sign the others out.
alter table staff_sessions
  add column id integer generated always as identity unique,
  add column device text not null default '',
  add column created_at timestamptz not null default now(),
  add column last_used_at timestamptz not null default now();
