-- Notifications go out the moment they're queued, not on the sender's next 10-second round: each insert into
-- notification_log notifies the API (LISTEN notification_queued). Postgres delivers the notice when the saving transaction
-- commits, and folds repeats within one transaction into one.
create function notification_queued() returns trigger language plpgsql as $$
begin
  perform pg_notify('notification_queued', '');
  return null;
end
$$;
create trigger notification_log_queued after insert on notification_log for each statement execute function notification_queued();

-- A sending round claims its messages, so a second round running at the same time (a notice arriving mid-round) can't
-- send them again. A claim older than two minutes is from a round that died, and is taken over.
alter table notification_log add column claimed_at timestamptz;
