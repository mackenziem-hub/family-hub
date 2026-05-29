-- Family Hub schema (Phase 1-3 tables). Run in the Supabase SQL editor.
-- No tenant_id: this is a single household with two users.
-- RLS stays OFF: all access goes through the service-role key behind session auth,
-- exactly like the API layer it is modeled on. The anon key is never shipped to clients.

create extension if not exists "pgcrypto";

-- ── Users (2 seeded rows; no public registration) ──────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null unique,
  password_hash text not null,                 -- scrypt "salt:hash"
  created_at    timestamptz not null default now()
);

-- ── Sessions (30-day bearer tokens) ────────────────────────────────────────
create table if not exists sessions (
  token      text primary key,                 -- 32-byte hex
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions(user_id);

-- ── Groceries (SHARED: both users see and edit one list) ───────────────────
create table if not exists grocery_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  quantity   text,                              -- free-text, e.g. "1 dozen"
  category   text,                              -- user- or AI-set; nullable
  checked    boolean not null default false,
  added_by   uuid references users(id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists grocery_checked_idx on grocery_items(checked);

-- ── Nutrition targets (PER-USER, one row each) ─────────────────────────────
create table if not exists nutrition_targets (
  user_id          uuid primary key references users(id) on delete cascade,
  calorie_target   integer,
  protein_target_g integer,
  carb_target_g    integer,
  fat_target_g     integer,
  updated_at       timestamptz not null default now()
);

-- ── Nutrition log (PER-USER, per meal; daily totals summed at read time) ───
create table if not exists nutrition_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  logged_for_date date not null default current_date,
  description     text not null,
  calories        integer,
  protein_g       numeric(6,1),
  carbs_g         numeric(6,1),
  fat_g           numeric(6,1),
  source          text not null default 'ai_estimate',  -- ai_estimate | manual | photo
  confidence      text check (confidence is null or confidence in ('low','med','high')),
  created_at      timestamptz not null default now()
);
create index if not exists nutrition_user_date_idx on nutrition_log(user_id, logged_for_date);

-- ── Kids (SHARED; age computed at read time, never stored) ─────────────────
create table if not exists kids (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  birthdate  date,
  notes      text,                              -- interests / allergies; feeds AI context
  created_at timestamptz not null default now()
);

-- ── Saved activities + conversation topics (SHARED, one table) ─────────────
-- Widen this CHECK before introducing a third kind (a missing value would
-- otherwise be rejected at insert time).
create table if not exists saved_items (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('activity','topic')),
  kid_id     uuid references kids(id) on delete set null,
  title      text not null,
  detail     text,
  tags       text[] not null default '{}',
  favorited  boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists saved_items_kind_idx on saved_items(kind);

-- ── Chat history (PER-USER thread; both users may view) ────────────────────
-- content = final assistant/user text only. Do NOT persist Claude thinking blocks.
create table if not exists chat_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  role         text not null check (role in ('user','assistant')),
  content      text not null default '',
  tool_actions jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists chat_user_idx on chat_messages(user_id, created_at);
