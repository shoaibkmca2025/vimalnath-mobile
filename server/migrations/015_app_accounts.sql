-- Customers register in the app with their mobile number and a password, instead of typing in a token from the shop.
-- `login` is the last 10 digits of the mobile number. The token the app gets back works exactly as before.
alter table app_devices
  add column login text unique,
  add column password_hash text;
