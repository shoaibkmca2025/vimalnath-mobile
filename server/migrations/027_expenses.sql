-- Phase 4, accounts (docs/ERP-ROADMAP.md): the shop's running costs, and what the cash and bank books start from.
-- An expense entered by the Owner counts at once; one entered by the Accountant waits for the Owner's approval.
-- Approved expenses are never deleted: they're cancelled with a reason, so the books keep them.

create sequence expense_numbers;

create table expenses (
  id integer generated always as identity primary key,
  -- The shop's own number, EXP-0001.
  number text not null unique,
  spent_on date not null,
  category text not null check (category in ('rent', 'electricity', 'salary', 'transport', 'maintenance', 'office', 'marketing', 'other')),
  description text not null default '',
  paid_to text not null default '',
  -- What was paid, GST included, in rupees and paise.
  amount numeric(14, 2) not null check (amount > 0),
  -- The GST inside `amount`, from a GST bill, and the seller's GSTIN.
  gst numeric(14, 2) not null default 0 check (gst >= 0 and gst < amount),
  gstin text not null default '',
  method text not null check (method in ('cash', 'upi', 'bank', 'cheque')),
  reference text not null default '',
  -- The bill or receipt, a PDF or photo in the media library.
  attachment text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_by text not null,
  created_at timestamptz not null default now(),
  -- Who approved, rejected or cancelled it, and why (rejected and cancelled need a reason).
  decided_by text,
  decided_at timestamptz,
  reason text not null default ''
);
create index expenses_spent_on on expenses (spent_on);

-- Cash in hand and money in the bank on the day the books start; the Cash & Bank book adds every payment after it.
create table book_openings (
  book text primary key check (book in ('cash', 'bank')),
  amount numeric(14, 2) not null default 0,
  as_of date not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);
