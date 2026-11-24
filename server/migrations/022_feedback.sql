-- Feedback from the app's menu: a star rating, a problem report, a suggestion, or anything else the customer wants to say.
-- Staff read it under Feedback in the admin, mark it seen or resolved, and keep a note of what was done.
create table app_feedback (
  id integer generated always as identity primary key,
  device_id integer not null references app_devices on delete cascade,
  -- 1 to 5 stars; empty when they only wrote a message.
  rating integer check (rating between 1 and 5),
  kind text not null check (kind in ('problem', 'suggestion', 'feedback')),
  message text not null default '',
  -- Which app and phone it came from, so a problem can be traced.
  app_version text not null default '',
  platform text not null default '',
  status text not null default 'new' check (status in ('new', 'seen', 'resolved')),
  staff_note text not null default '',
  handled_by text,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  check (rating is not null or message <> '')
);
create index app_feedback_newest on app_feedback (created_at desc);
create index app_feedback_device on app_feedback (device_id, created_at desc);
