-- Family Hub migration 003: Google Calendar OAuth (read + write). Run after 002.
-- Per-user refresh tokens + a short-lived oauth_state table (shared by all OAuth
-- providers) that ties an OAuth callback back to the user who started it, since the
-- callback is a top-level browser redirect with no Authorization header.

create table if not exists google_tokens (
  user_id           uuid primary key references users(id) on delete cascade,
  refresh_token     text not null,
  access_token      text,
  access_expires_at timestamptz,
  google_email      text,
  scope             text,
  calendar_id       text not null default 'primary',
  connected_at      timestamptz not null default now()
);

create table if not exists oauth_state (
  state         text primary key,                 -- random nonce in the OAuth state param
  user_id       uuid not null references users(id) on delete cascade,
  provider      text not null,                     -- 'google' | 'fitbit'
  code_verifier text,                              -- PKCE (Fitbit); null for Google
  created_at    timestamptz not null default now()
);
