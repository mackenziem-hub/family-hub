# Family Hub

A mobile-first family assistant app for a two-parent household: shared groceries, a Google-synced
family calendar, calorie/nutrition tracking, and kid activities + conversation topics, all
wrapped by a conversational Claude assistant that can take actions. All real family data (names,
emails, kid profiles) is supplied via a gitignored `family.local.json` and the database, never
committed to this repo.

Standalone app. Own Supabase project, own Vercel project, own Anthropic key. Not connected to
the business Ryujin platform.

## Stack

- Vercel serverless (`api/*.js`, ESM) + static HTML in `public/`. Vanilla JS, no framework, no build step.
- Supabase (Postgres) via `@supabase/supabase-js` (the only runtime dependency).
- Claude (Anthropic Messages API) and Google Calendar are called with raw `fetch`.
- Two users, session-token auth, scrypt password hashing. No multi-tenant.

## Setup (do these once, in order)

### 1. Supabase project
- Create a new project at supabase.com (region near Atlantic Canada).
- Settings > API: copy the **Project URL** into `SUPABASE_URL` and the **service_role** key into
  `SUPABASE_SERVICE_KEY` (the anon key is not used; the server is the only DB client).
- SQL editor: run the migrations in order: `schema/001_init.sql` through `schema/006_active.sql`.
- Storage (for photo meal logging): create a **private** bucket named `meal-photos`
  (Storage > New bucket > Public: OFF). Skip this if you set `STORE_MEAL_PHOTOS=false`.

### 2. Seed the users and kids
- `cp .env.example .env.local`, fill `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
- `cp family.example.json family.local.json`, fill in your users + kids (this file is gitignored).
- `npm install`
- Copy `family.example.json` to `family.local.json` and fill in your users + kids (names, emails,
  passwords, kid profiles). This file is gitignored and is the only place real family data lives.
- `npm run seed` (inserts the users from family.local.json with scrypt-hashed passwords).
- `npm run seed:kids` (inserts the kids from family.local.json with their affirming profile notes).
- `npm run seed:places` (inserts the curated Moncton/NB venues + day trips).
- Clear the two `SEED_*` values from `.env.local` afterward.

### 3. Vercel project
- `npx vercel` once in this folder to link/create the project (note the assigned domain).
- Add every variable from `.env.example` to the Vercel dashboard (Production + Preview).
- Deploy: `npm run deploy` (which is `vercel --prod --yes`). Auto-deploy is not relied on.

### 4. Anthropic key (Phase 2)
- Mint a key at console.anthropic.com (a fresh key keeps this app's cost separate) into `ANTHROPIC_API_KEY`.

### 5. Google Calendar read-only (Phase 2)
- Google Calendar > the family calendar > Settings > Integrate calendar >
  copy **"Secret address in iCal format"** into `GOOGLE_CALENDAR_ICS_URL`.

### 6. Google Calendar read+write OAuth (Phase 4 only)
The one step that needs your Google account in a browser:
- console.cloud.google.com: create a project, enable the **Google Calendar API**.
- OAuth consent screen: **External**, add scope `https://www.googleapis.com/auth/calendar`,
  add both parents as test users, then **Publish to "In production"** (otherwise refresh tokens
  expire after 7 days and calendar writes silently break).
- Credentials > OAuth client ID > **Web application**. Authorized redirect URI:
  `https://<your-vercel-domain>/api/google-oauth?action=callback`.
- Copy the Client ID + Secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, and set
  `GOOGLE_OAUTH_REDIRECT_URI` to that callback URL.
- Optionally set `GOOGLE_CALENDAR_ID` to a shared family calendar's ID (default `primary`).
- In the app: each of you taps **Connect Google Calendar** on the Calendar tab once.

### 7. Fitbit read-only sync (Phase 5)
- dev.fitbit.com > Register an app. Type: **Personal** only covers the developer's own
  account, so register a **Client (public, PKCE)** app to cover both of you.
- OAuth 2.0 redirect URL (exact): `https://<your-vercel-domain>/api/fitbit-oauth?action=callback`.
- Scopes: activity, heartrate, sleep, weight.
- Put the Client ID into `FITBIT_CLIENT_ID` and the redirect into `FITBIT_OAUTH_REDIRECT_URI`
  (only set `FITBIT_CLIENT_SECRET` if you chose a confidential "Server" app).
- In the app: each of you taps **Connect Fitbit** on the Food tab. (Note: the legacy Fitbit
  Web API is slated to retire ~Sept 2026; this is a deliberate short-lived bridge.)

### 8. NB events cron (Phase 6)
- The Vercel Cron is already declared in `vercel.json` (`/api/cron-nb-events`, daily). Set a
  `CRON_SECRET` env var if you want to trigger it manually; Vercel's scheduled runs are
  authenticated by Vercel automatically.

## Final connections checklist (the human-only steps)

1. Create the Supabase project; run migrations `001`-`006`; create the private `meal-photos` bucket.
2. `npm install`, fill `.env.local`, `npm run seed`, `npm run seed:kids`, `npm run seed:places`, then clear `SEED_*`.
3. `npx vercel` to create the Vercel project; add every env var (Production + Preview); `npm run deploy`.
4. Mint `ANTHROPIC_API_KEY`; grab the calendar `GOOGLE_CALENDAR_ICS_URL` (read-only fallback).
5. Google OAuth client (step 6) + both connect on the Calendar tab.
6. Fitbit app (step 7) + both connect on the Food tab.
7. Confirm the cron shows up in the Vercel dashboard (Settings > Cron Jobs).

## Build phases

- **Phase 1** (done): scaffold + auth + groceries.
- **Phase 2** (done): Claude assistant (Home tab) + read-only calendar.
- **Phase 3** (done): nutrition (manual + photo-calorie via Claude vision) + kids/conversation.
- **Phase 4** (done): Google Calendar write via OAuth.
- **Phase 5** (done): Fitbit read-only sync. **Phase 6** (done): Moncton/NB events + trips. **Phase 7** (done): family "be more active".

## Before every deploy

```
npm run check          # node --check every api/ handler (Vercel does not syntax-check)
npm run deploy         # vercel --prod --yes
```

Then curl-smoke each touched endpoint against the live domain (build success != runtime success).

## Conventions

- `.trim()` every env var read (Vercel can append a trailing newline).
- No `setTimeout` retries in serverless (Vercel can freeze the invocation after the response).
- Internal-tool palette (dark navy + teal-mint). No em/en dashes anywhere.
