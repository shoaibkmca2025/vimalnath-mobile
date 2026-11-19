-- Customer payments. Each order is also a bill: what the customer owes for it, whether they pay cash (due on
-- delivery) or on credit (due the Settings' credit period after delivery), and the money they have paid towards it.
alter table orders
  add column payment_terms text not null default 'credit' check (payment_terms in ('cash', 'credit')),
  -- Whole rupees, set by staff for a discount or for lines priced from the catalogue page. Empty: the MRP total.
  add column bill_amount integer check (bill_amount between 0 and 1000000000);

create table order_payments (
  id integer generated always as identity primary key,
  order_id integer not null references orders,
  amount integer not null check (amount > 0),
  method text not null check (method in ('cash', 'upi', 'bank', 'cheque')),
  -- The day the money came in, as staff give it; it can be earlier than the day it was recorded.
  paid_on date not null,
  note text not null default '',
  -- The staff member's name as it was then.
  by text not null,
  created_at timestamptz not null default now()
);
create index order_payments_order on order_payments (order_id);
