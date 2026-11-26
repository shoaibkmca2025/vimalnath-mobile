-- Returns and credit notes from counter bills: a return comes from an order, or from a finalized bill made at the counter
-- (no order), whose posted invoice is then where its lines, prices and GST come from.
alter table sales_returns alter column order_id drop not null;
alter table sales_returns add constraint sales_returns_source check (order_id is not null or invoice_id is not null);
create index sales_returns_invoice on sales_returns (invoice_id);
