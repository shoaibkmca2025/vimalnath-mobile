-- Failed sign-ins move off the account: counted per email and address, so an attacker can only lock themselves out.
alter table staff_users drop column failed_attempts, drop column locked_until;

create table sign_in_attempts (
  email text not null,
  client text not null,
  attempts integer not null default 1,
  expires_at timestamptz not null,
  primary key (email, client)
);
