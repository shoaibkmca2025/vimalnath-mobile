-- Phase 3 (docs/ERP-ROADMAP.md): how much a customer may owe. Empty: no limit. Set by the Owner or the Accountant; the
-- admin warns on the customer and on their open orders when what they owe passes it.
alter table customers add column credit_limit integer check (credit_limit between 0 and 1000000000);
