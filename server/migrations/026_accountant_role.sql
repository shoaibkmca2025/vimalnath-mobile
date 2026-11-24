-- The Accountant: GST invoices, payments, purchases, suppliers, refunds and credit notes; sees orders and customers
-- but doesn't move orders or change the catalogue, staff or settings.
alter table staff_users drop constraint staff_users_role_check;
alter table staff_users add constraint staff_users_role_check check (role in ('owner', 'sales', 'catalogue', 'inventory', 'accountant'));
