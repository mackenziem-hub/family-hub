-- Family Hub migration 005: Moncton/NB places + cached events. Run after 004.
-- nb_places stores VENUES/TRIPS (evergreen, never stale); dated events live only in
-- nb_event_cache (refreshed by api/cron-nb-events.js) so the seed list never goes stale.

create table if not exists nb_places (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  kind            text not null default 'venue' check (kind in ('venue','trip','event')),
  what_why        text,
  address         text,
  url             text,
  season          text,
  indoor_outdoor  text,
  age_fit         text,
  crowd_level     text,
  noise_level     text,
  easy_exit       boolean default false,
  sensory_friendly boolean default false,
  is_seasonal     boolean default false,
  active          boolean default true,
  created_at      timestamptz not null default now()
);

create table if not exists nb_event_cache (
  id         uuid primary key default gen_random_uuid(),
  source     text,
  title      text,
  starts_on  date,
  ends_on    date,
  url        text,
  raw        jsonb,
  fetched_at timestamptz not null default now()
);
