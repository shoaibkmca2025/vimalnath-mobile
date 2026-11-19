-- The app's Notifications screen: each account's order updates and the shop's messages, kept whether or not the phone
-- takes push notifications (the web app on a home screen can't). A row with no push address is 'skipped' for sending.
-- read_at: when the customer opened the screen after it arrived; the bell's count is the rows without one.
alter table notification_log add column read_at timestamptz;
create index notification_log_inbox on notification_log (device_id, id desc) where channel = 'push';
