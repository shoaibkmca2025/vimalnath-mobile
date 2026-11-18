-- When the customer's app first received an order request the shop sent (its first sync after it was sent).
-- Shown in the admin's Order Requests as an update: Sent → Received in the app → Confirmed or Declined.
alter table orders add column customer_seen_at timestamptz;
