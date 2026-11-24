-- The inventory team's pick list: each line of an order being packed is ticked as it's picked, with who and when.
alter table order_lines
  add column picked_at timestamptz,
  add column picked_by text;
