-- Family Hub migration 007: per-person profiles + photo bank (Phase 2.2).
-- Profiles are private to each user (the assistant coaches a person using their own
-- profile). Kids stay shared (both parents co-parent) in the existing kids table.

create table if not exists profiles (
  user_id      uuid primary key references users(id) on delete cascade,
  diet         text,                                   -- e.g. omnivore, vegetarian, keto, custom
  allergies    text[] not null default '{}',
  dislikes     text[] not null default '{}',
  goals        text,                                   -- short, current goals
  goals_doc    text,                                   -- authored north-star / values doc (coaching anchor)
  personality  text,                                   -- traits, what helps, communication style
  interests    text[] not null default '{}',
  hobbies      text[] not null default '{}',
  notes        text,                                   -- free-form accumulation from progressive profiling
  extra        jsonb not null default '{}'::jsonb,     -- misc learned facts
  updated_at   timestamptz not null default now()
);

create table if not exists photo_bank (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  category     text not null default 'other',          -- pantry|fridge|meal|workout|kids_art|other
  storage_path text not null,                           -- path in the private photo-bank bucket
  caption      text,                                    -- optional Claude-vision summary
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists idx_photo_bank_user on photo_bank(user_id, created_at desc);
