-- A new account is an app user only; it becomes a customer with its first order (from the app, or a request staff
-- send it). Accounts made before this keep the customer they were given.
alter table app_devices alter column customer_id drop not null;
