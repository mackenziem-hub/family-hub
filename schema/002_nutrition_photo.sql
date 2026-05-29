-- Family Hub migration 002: photo-calorie support. Run after 001.
-- Extends nutrition_log so an estimate can carry a range, per-item breakdown,
-- assumptions, and a pointer to the stored photo. Idempotent.

alter table nutrition_log
  add column if not exists meal_slot     text,                          -- breakfast|lunch|dinner|snack (optional)
  add column if not exists calorie_low   integer,                       -- plausible range low
  add column if not exists calorie_high  integer,                       -- plausible range high
  add column if not exists assumptions   text,                          -- what the estimate assumed
  add column if not exists items         jsonb not null default '[]'::jsonb, -- per-item breakdown
  add column if not exists photo_path    text,                          -- Storage key in 'meal-photos' (NOT the image bytes)
  add column if not exists corrected     boolean not null default false; -- true once the user edits the estimate

-- IMPORTANT: also create a PRIVATE Storage bucket for meal photos. SQL cannot
-- create buckets, so in the Supabase dashboard:
--   Storage > New bucket > name: meal-photos > Public: OFF
-- Photos are served only via short-lived signed URLs. To skip storing photos
-- entirely (analyze-and-discard), set STORE_MEAL_PHOTOS=false in the env.
