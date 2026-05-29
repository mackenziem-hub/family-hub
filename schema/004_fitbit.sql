-- Family Hub migration 004: Fitbit read-only sync. Run after 003.
-- Per-user tokens + a per-user-per-day fitness snapshot. NOTE: the legacy Fitbit Web
-- API is being decommissioned ~Sept 2026 and replaced by the Google Health API; all
-- Fitbit specifics live behind lib/fitness.js so the eventual swap is localized.

create table if not exists fitbit_tokens (
  user_id        uuid primary key references users(id) on delete cascade,
  access_token   text,
  refresh_token  text not null,                  -- Fitbit ROTATES this on every refresh
  expires_at     timestamptz,
  scope          text,
  fitbit_user_id text,
  connected_at   timestamptz not null default now()
);

create table if not exists fitness_daily (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  day            date not null,
  steps          integer,
  calories_out   integer,
  active_minutes integer,
  resting_hr     integer,
  sleep_minutes  integer,
  weight_kg      numeric(5,2),
  provider       text not null default 'fitbit',
  synced_at      timestamptz not null default now(),
  unique (user_id, day, provider)
);
