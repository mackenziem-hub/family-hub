// Family Hub - Fitbit read-only sync (provider-agnostic seam).
// OAuth 2.0 Authorization Code + PKCE. Each person connects their own Fitbit account.
// The legacy Fitbit Web API sunsets ~Sept 2026 (-> Google Health API); keep all
// Fitbit-specific calls in THIS file so that migration only touches here + api/fitbit-oauth.js.
import crypto from 'node:crypto';
import { supabaseAdmin } from './supabase.js';
import { todayLocalISODate } from './dates.js';

const AUTH_URL = 'https://www.fitbit.com/oauth2/authorize';
const TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const API = 'https://api.fitbit.com';
const SCOPE = 'activity heartrate sleep weight'; // resting HR needs the heartrate scope

const clientId = () => (process.env.FITBIT_CLIENT_ID || '').trim();
const clientSecret = () => (process.env.FITBIT_CLIENT_SECRET || '').trim();
export const fitbitRedirectUri = () => (process.env.FITBIT_OAUTH_REDIRECT_URI || '').trim();
export function fitbitConfigured() { return Boolean(clientId() && fitbitRedirectUri()); }

export function fitbitAuthUrl(state, challenge) {
  const p = new URLSearchParams({
    client_id: clientId(), response_type: 'code', scope: SCOPE,
    redirect_uri: fitbitRedirectUri(), state,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${p.toString()}`;
}

// Confidential ("Server") app -> Basic auth. Public PKCE app -> no auth header.
function tokenAuthHeader() {
  if (clientSecret()) return 'Basic ' + Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
  return null;
}

export async function exchangeFitbitCode(code, verifier) {
  const body = new URLSearchParams({
    client_id: clientId(), grant_type: 'authorization_code', code,
    redirect_uri: fitbitRedirectUri(), code_verifier: verifier,
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const auth = tokenAuthHeader(); if (auth) headers.Authorization = auth;
  const r = await fetch(TOKEN_URL, { method: 'POST', headers, body });
  if (!r.ok) throw new Error('fitbit token exchange failed: ' + (await r.text()).slice(0, 300));
  return r.json();
}

export async function storeFitbitTokens(userId, tok) {
  const expiresAt = new Date(Date.now() + (tok.expires_in || 28800) * 1000).toISOString();
  await supabaseAdmin.from('fitbit_tokens').upsert({
    user_id: userId, access_token: tok.access_token, refresh_token: tok.refresh_token,
    expires_at: expiresAt, scope: tok.scope || null, fitbit_user_id: tok.user_id || null,
    connected_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

async function getFitbitAccessToken(userId) {
  const { data: row } = await supabaseAdmin.from('fitbit_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (!row) return null;
  // 5-min buffer so the token can't expire in-flight after the check.
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() - Date.now() > 300000) return row.access_token;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token, client_id: clientId() });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const auth = tokenAuthHeader(); if (auth) headers.Authorization = auth;
  const r = await fetch(TOKEN_URL, { method: 'POST', headers, body });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    if (r.status === 400) await supabaseAdmin.from('fitbit_tokens').delete().eq('user_id', userId); // dead refresh token -> reconnect
    throw new Error(`fitbit refresh failed: ${r.status} ${detail}`);
  }
  const tok = await r.json();
  const expiresAt = new Date(Date.now() + (tok.expires_in || 28800) * 1000).toISOString();
  // Fitbit ROTATES the refresh token on every use: persist the new one (and fail loudly if
  // that write fails) or the next refresh uses a dead token and the user is silently logged out.
  const { error } = await supabaseAdmin.from('fitbit_tokens').update({
    access_token: tok.access_token, refresh_token: tok.refresh_token || row.refresh_token, expires_at: expiresAt,
  }).eq('user_id', userId);
  if (error) { console.error('[fitbit] token persist failed:', error.message); throw new Error('fitbit token persist failed'); }
  return tok.access_token;
}

export async function isFitbitConnected(userId) {
  const { data } = await supabaseAdmin.from('fitbit_tokens').select('user_id').eq('user_id', userId).maybeSingle();
  return Boolean(data);
}
export async function disconnectFitbit(userId) { await supabaseAdmin.from('fitbit_tokens').delete().eq('user_id', userId); }

async function fitbitGet(token, path) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token, 'Accept-Language': 'en_CA' } });
  if (r.status === 429) { const e = new Error('fitbit_rate_limited'); e.code = 429; throw e; }
  if (!r.ok) throw new Error(`fitbit GET ${path} -> ${r.status}`);
  return r.json();
}

// Pull a day's summary, upsert into fitness_daily, return the row. null if not connected.
// Throws an error with .code === 429 when rate-limited (caller surfaces "try later").
export async function readDailySummary(userId, date) {
  const token = await getFitbitAccessToken(userId);
  if (!token) return null;
  const day = date || new Date().toISOString().slice(0, 10);

  let steps = null, caloriesOut = null, activeMinutes = null, restingHr = null, sleepMinutes = null, weightKg = null;
  try {
    const act = await fitbitGet(token, `/1/user/-/activities/date/${day}.json`);
    const s = act.summary || {};
    steps = s.steps ?? null;
    caloriesOut = s.caloriesOut ?? null;
    activeMinutes = (s.fairlyActiveMinutes == null && s.veryActiveMinutes == null)
      ? null : (s.fairlyActiveMinutes || 0) + (s.veryActiveMinutes || 0);
    restingHr = s.restingHeartRate ?? null;
  } catch (e) { if (e.code === 429) throw e; console.error('[fitbit activity]', e.message); }
  try {
    const sl = await fitbitGet(token, `/1.2/user/-/sleep/date/${day}.json`);
    sleepMinutes = sl.summary?.totalMinutesAsleep ?? null;
  } catch (e) { if (e.code === 429) throw e; console.error('[fitbit sleep]', e.message); }
  try {
    const w = await fitbitGet(token, `/1/user/-/body/log/weight/date/${day}/1d.json`);
    if (Array.isArray(w.weight) && w.weight.length) weightKg = w.weight[w.weight.length - 1].weight ?? null;
  } catch (e) { if (e.code === 429) throw e; console.error('[fitbit weight]', e.message); }

  const row = {
    user_id: userId, day, steps, calories_out: caloriesOut, active_minutes: activeMinutes,
    resting_hr: restingHr, sleep_minutes: sleepMinutes, weight_kg: weightKg, provider: 'fitbit', synced_at: new Date().toISOString(),
  };
  await supabaseAdmin.from('fitness_daily').upsert(row, { onConflict: 'user_id,day,provider' });
  return row;
}

export function makePkce() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ── Manual logging (when there's no Fitbit sync: the user reads stats off their
// watch and tells the assistant, or snaps a photo). Stored under provider='manual'
// in the same fitness_daily table, so trends and reads treat both alike. ──
const MANUAL_FIELDS = ['steps', 'calories_out', 'active_minutes', 'resting_hr', 'sleep_minutes', 'weight_kg'];

// Log/merge a day's manual fitness for a user. MERGES with any existing manual row for
// that day so piecemeal logging ("8k steps" now, "slept 7h" later) accumulates instead
// of overwriting. Only fields present in `fields` are changed. Returns the merged row.
export async function logManualFitness(userId, fields, day) {
  const d = day || todayLocalISODate();
  const { data: existing } = await supabaseAdmin.from('fitness_daily')
    .select('*').eq('user_id', userId).eq('day', d).eq('provider', 'manual').maybeSingle();
  const row = {
    user_id: userId, day: d, provider: 'manual',
    steps: existing?.steps ?? null, calories_out: existing?.calories_out ?? null,
    active_minutes: existing?.active_minutes ?? null, resting_hr: existing?.resting_hr ?? null,
    sleep_minutes: existing?.sleep_minutes ?? null, weight_kg: existing?.weight_kg ?? null,
    synced_at: new Date().toISOString(),
  };
  for (const k of MANUAL_FIELDS) { if (fields?.[k] != null) row[k] = fields[k]; }
  const { data, error } = await supabaseAdmin.from('fitness_daily')
    .upsert(row, { onConflict: 'user_id,day,provider' }).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

// Today's fitness from the best source: live Fitbit if connected, else the manual row.
// Returns { source: 'fitbit'|'manual', ...row } or null. May throw .code===429 (Fitbit).
export async function readTodayFitness(userId) {
  if (await isFitbitConnected(userId)) {
    const row = await readDailySummary(userId);
    if (row) return { source: 'fitbit', ...row };
  }
  const { data } = await supabaseAdmin.from('fitness_daily')
    .select('*').eq('user_id', userId).eq('day', todayLocalISODate()).eq('provider', 'manual').maybeSingle();
  return data ? { source: 'manual', ...data } : null;
}
