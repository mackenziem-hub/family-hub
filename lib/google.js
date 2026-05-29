// Family Hub - Google Calendar OAuth (read + write).
// Per-user refresh tokens. Reads can use any connected user's token (the family
// shares one calendar via GOOGLE_CALENDAR_ID); writes use the acting user's token.
import { supabaseAdmin } from './supabase.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

const clientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = () => (process.env.GOOGLE_CLIENT_SECRET || '').trim();
export const googleRedirectUri = () => (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
const calendarId = () => (process.env.GOOGLE_CALENDAR_ID || 'primary').trim();

export function googleConfigured() {
  return Boolean(clientId() && clientSecret() && googleRedirectUri());
}

export function googleAuthUrl(state, codeChallenge) {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: `${SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token every time
    include_granted_scopes: 'true',
    state,
  });
  if (codeChallenge) { p.set('code_challenge', codeChallenge); p.set('code_challenge_method', 'S256'); }
  return `${AUTH_URL}?${p.toString()}`;
}

export async function exchangeGoogleCode(code, codeVerifier) {
  const params = {
    code, client_id: clientId(), client_secret: clientSecret(),
    redirect_uri: googleRedirectUri(), grant_type: 'authorization_code',
  };
  if (codeVerifier) params.code_verifier = codeVerifier; // PKCE (defense in depth)
  const body = new URLSearchParams(params);
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error('google token exchange failed: ' + (await r.text()).slice(0, 300));
  return r.json();
}

export async function storeGoogleTokens(userId, tok) {
  if (!tok || !tok.access_token) throw new Error('google token response missing access_token');
  const expiresAt = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
  let email = null;
  try {
    const u = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } });
    if (u.ok) email = (await u.json()).email || null;
  } catch { /* optional */ }
  const row = {
    user_id: userId, access_token: tok.access_token, access_expires_at: expiresAt,
    google_email: email, scope: tok.scope || null, connected_at: new Date().toISOString(),
  };
  if (tok.refresh_token) row.refresh_token = tok.refresh_token; // only present on first consent
  await supabaseAdmin.from('google_tokens').upsert(row, { onConflict: 'user_id' });
}

async function getGoogleAccessToken(userId) {
  const { data: row } = await supabaseAdmin.from('google_tokens').select('*').eq('user_id', userId).maybeSingle();
  if (!row) return null;
  if (!row.refresh_token) { console.error(`[google] user ${userId} has no refresh_token; reconnect needed`); return null; }
  // 5-min buffer so the token can't expire in-flight after the check.
  if (row.access_token && row.access_expires_at && new Date(row.access_expires_at).getTime() - Date.now() > 300000) {
    return row.access_token;
  }
  const body = new URLSearchParams({
    client_id: clientId(), client_secret: clientSecret(),
    refresh_token: row.refresh_token, grant_type: 'refresh_token',
  });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    // 400 invalid_grant = revoked/expired refresh token (unrecoverable): drop the row so the
    // UI shows "not connected" and the user can reconnect, rather than failing forever.
    if (r.status === 400) await supabaseAdmin.from('google_tokens').delete().eq('user_id', userId);
    throw new Error(`google refresh failed: ${r.status} ${detail}`);
  }
  const tok = await r.json();
  const expiresAt = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
  // Google does not return a new refresh_token on refresh; keep the stored one.
  const { error } = await supabaseAdmin.from('google_tokens').update({ access_token: tok.access_token, access_expires_at: expiresAt }).eq('user_id', userId);
  if (error) { console.error('[google] token persist failed:', error.message); throw new Error('google token persist failed'); }
  return tok.access_token;
}

async function anyGoogleUserId() {
  const { data } = await supabaseAdmin.from('google_tokens').select('user_id').limit(1).maybeSingle();
  return data?.user_id || null;
}
export async function hasAnyGoogleToken() { return Boolean(await anyGoogleUserId()); }
export async function isGoogleConnected(userId) {
  const { data } = await supabaseAdmin.from('google_tokens').select('user_id, google_email').eq('user_id', userId).maybeSingle();
  return data || null;
}
export async function disconnectGoogle(userId) {
  await supabaseAdmin.from('google_tokens').delete().eq('user_id', userId);
}

function normalizeGoogleEvent(e) {
  const startRaw = e.start?.dateTime || (e.start?.date ? `${e.start.date}T12:00:00Z` : null);
  const endRaw = e.end?.dateTime || (e.end?.date ? `${e.end.date}T12:00:00Z` : null);
  return {
    uid: e.id,
    summary: e.summary || '(untitled)',
    location: e.location || null,
    description: e.description || null,
    startTime: startRaw ? new Date(startRaw).toISOString() : null,
    endTime: endRaw ? new Date(endRaw).toISOString() : null,
    allDay: Boolean(e.start?.date),
  };
}

// Read upcoming events via OAuth (any connected user). Returns null if nobody connected.
export async function listGoogleEvents(days = 7, userId = null) {
  const uid = userId || (await anyGoogleUserId());
  if (!uid) return null;
  const token = await getGoogleAccessToken(uid);
  if (!token) return null;
  const timeMin = new Date(Date.now() - 86400000).toISOString();
  const timeMax = new Date(Date.now() + days * 86400000).toISOString();
  const url = `${CAL_BASE}/calendars/${encodeURIComponent(calendarId())}/events`
    + `?singleEvents=true&orderBy=startTime&maxResults=50`
    + `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('google events fetch failed: ' + r.status);
  const data = await r.json();
  return (data.items || []).filter((e) => e.status !== 'cancelled').map(normalizeGoogleEvent);
}

export async function insertGoogleEvent(userId, ev) {
  const token = await getGoogleAccessToken(userId);
  if (!token) throw new Error('not_connected');
  const tz = (process.env.APP_TIMEZONE || 'America/Moncton').trim();
  const payload = {
    summary: ev.summary,
    location: ev.location || undefined,
    description: ev.description || undefined,
    start: ev.allDay ? { date: ev.start } : { dateTime: ev.start, timeZone: tz },
    // Google all-day end is EXCLUSIVE: a 1-day event ending 2026-06-01 needs end date 2026-06-02.
    end: ev.allDay
      ? { date: ev.end || new Date(new Date(ev.start).getTime() + 86400000).toISOString().slice(0, 10) }
      : { dateTime: ev.end || ev.start, timeZone: tz },
  };
  const r = await fetch(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId())}/events`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('google insert failed: ' + (await r.text()).slice(0, 300));
  return normalizeGoogleEvent(await r.json());
}

export async function deleteGoogleEvent(userId, eventId) {
  const token = await getGoogleAccessToken(userId);
  if (!token) throw new Error('not_connected');
  const r = await fetch(`${CAL_BASE}/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
  });
  if (!r.ok && r.status !== 410) throw new Error('google delete failed: ' + r.status);
  return { ok: true };
}
