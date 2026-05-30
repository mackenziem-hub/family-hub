-- Family Hub migration 008: persistent assistant memory (Phase 2.3 foundation).
-- Durable facts/events/insights the assistant accumulates over time. user_id NULL =
-- shared household memory (both parents); a user_id = private to that person.
-- This is the freeform layer; profiles holds the structured essentials.

create table if not exists assistant_memory (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade,   -- NULL = household-shared
  category    text not null default 'fact',                   -- fact|preference|event|insight|routine
  content     text not null,
  source      text not null default 'assistant',              -- assistant|import|manual
  pinned      boolean not null default false,                 -- always include in context
  dedup_key   text,                                           -- optional idempotency hint
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_mem_user on assistant_memory(user_id, updated_at desc);
create index if not exists idx_mem_pinned on assistant_memory(pinned) where pinned = true;
