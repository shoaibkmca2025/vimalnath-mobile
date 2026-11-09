create table staff_users (
  id integer generated always as identity primary key,
  name text not null,
  -- Always stored in lower case, so one person can't be added twice.
  email text not null unique,
  -- Empty until they open their set-password link.
  password_hash text,
  role text not null check (role in ('owner', 'sales', 'catalogue')),
  active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now()
);

-- Only hashes of tokens are stored, so a leaked database can't be used to sign in.
create table staff_sessions (
  token_hash text primary key,
  staff_id integer not null references staff_users on delete cascade,
  expires_at timestamptz not null
);

create table password_tokens (
  token_hash text primary key,
  staff_id integer not null references staff_users on delete cascade,
  expires_at timestamptz not null
);
