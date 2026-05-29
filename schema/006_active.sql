-- Family Hub migration 006: family "be more active" layer. Run after 005.
-- Widen saved_items.kind to allow 'play_idea' (the schema warned: widen the CHECK before
-- adding a new kind, or inserts are silently rejected). play_moments is append-only:
-- there is no "missed" or "failed" state and no row is ever subtracted (anti-pressure).

alter table saved_items drop constraint if exists saved_items_kind_check;
alter table saved_items add constraint saved_items_kind_check check (kind in ('activity','topic','play_idea'));

create table if not exists play_moments (
  id         uuid primary key default gen_random_uuid(),
  done_by    uuid references users(id) on delete set null,
  kid_id     uuid references kids(id) on delete set null,
  idea_id    uuid references saved_items(id) on delete set null,
  note       text,
  done_on    date not null default current_date,
  created_at timestamptz not null default now()
);
