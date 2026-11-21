-- The shop's own tax invoice format (as issued from Tally): rates before GST with a discount per line, GST added on top
-- per rate, numbers like VSC-26-27-412 continuing the existing series, the buyer's balance, ship-to and reference
-- details, bank details, the declaration and the jurisdiction.

alter table gst_settings
  add column phone text not null default '',
  add column email text not null default '',
  add column bank_name text not null default '',
  add column bank_account text not null default '',
  add column bank_branch_ifsc text not null default '',
  add column declaration text not null default 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  add column jurisdiction text not null default '';

-- Each line is now its rate before GST, less a discount: amount = qty × rate × (1 − discount), before GST.
alter table sales_invoice_items
  add column rate numeric(12, 2) not null default 0 check (rate >= 0),
  add column discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  -- A second, smaller line under the description, e.g. the profile series.
  add column detail text not null default '';
update sales_invoice_items set rate = round(taxable / qty, 2), amount = taxable;

-- Printed details that don't feed GST reports: contacts, ship-to, delivery and order references.
alter table sales_invoices
  add column details jsonb not null default '{}',
  -- The buyer's balance with the shop just before this invoice, fixed when it is posted.
  add column previous_balance numeric(14, 2);
