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

// Add one hour to a floating wall-clock 'YYYY-MM-DDTHH:MM[:SS]' string, independent of
// the process timezone (Date.UTC is used purely as a calendar/normalizer here, not for
// any real UTC conversion). Returns 'YYYY-MM-DDTHH:MM:SS'. Used to default a timed
// event's end so it is strictly after start (Google rejects zero-length timed events).
function plusOneHourWallClock(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return s;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 1, +m[5], +(m[6] || 0))).toISOString().slice(0, 19);
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
      // A timed event needs end > start, else Google rejects it (zero-length). When no end
      // was given, default to start + 1h. ev.start is a floating wall-clock string and the
      // runtime is UTC, so +1h then slice(0,19) keeps the wall-clock form (timeZone sent separately).
      : { dateTime: ev.end || plusOneHourWallClock(ev.start), timeZone: tz },
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

// ───────── Combined free/busy (multi-person "when are we all free") ─────────
// freeBusy returns ONLY busy blocks (no titles/locations) -> privacy-safe by design.
// CRITICAL: each person's busy must be queried with THAT person's own token; reusing
// one token (like the shared-calendar read path) would report one person as "everyone."

const APP_TZ = () => (process.env.APP_TIMEZONE || 'America/Moncton').trim();

// UTC instant for a given local wall-clock hour on the local day containing `dateUTC`.
function localHourUTC(dateUTC, hour, tz) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dateUTC).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const guess = new Date(`${p.year}-${p.month}-${p.day}T${String(hour).padStart(2, '0')}:00:00Z`);
  // offset (local - utc) at that instant, so we can shift the UTC guess onto the local clock
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const asUTC = Date.UTC(f.year, f.month - 1, f.day, f.hour === '24' ? 0 : f.hour, f.minute, f.second);
  return guess.getTime() - (asUTC - guess.getTime());
}

function mergeBusy(blocks) {
  const iv = blocks.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]).filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of iv) { if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e); else out.push([s, e]); }
  return out.map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }));
}

export async function queryFreeBusy(userId, timeMin, timeMax, calIds = ['primary']) {
  const token = await getGoogleAccessToken(userId);
  if (!token) return { connected: false, busy: [] };
  const r = await fetch(`${CAL_BASE}/freeBusy`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, timeZone: APP_TZ(), items: calIds.map((id) => ({ id })) }),
  });
  if (!r.ok) throw new Error('freebusy ' + r.status);
  const data = await r.json();
  const busy = [];
  for (const id of calIds) { const cal = data.calendars && data.calendars[id]; if (cal && Array.isArray(cal.busy)) busy.push(...cal.busy); }
  return { connected: true, busy };
}

// All connected users' busy, each via their OWN token (Promise.allSettled so one
// revoked token can't kill the result). Surfaces who isn't connected.
export async function combinedFreeBusy(timeMin, timeMax) {
  const { data: rows } = await supabaseAdmin.from('google_tokens').select('user_id, google_email');
  const people = rows || [];
  const results = await Promise.allSettled(people.map((p) => queryFreeBusy(p.user_id, timeMin, timeMax)));
  const perPerson = []; let allBusy = [];
  results.forEach((res, i) => {
    const email = people[i].google_email || 'someone';
    if (res.status === 'fulfilled' && res.value.connected) { perPerson.push({ email, busy: res.value.busy, connected: true }); allBusy = allBusy.concat(res.value.busy); }
    else perPerson.push({ email, busy: [], connected: false });
  });
  return { perPerson, merged: mergeBusy(allBusy), connectedCount: perPerson.filter((p) => p.connected).length };
}

// Invert merged busy into free slots, clamped to a daily local window (default 08:00-21:00).
export function invertBusyToFree(busy, windowStartISO, windowEndISO, opts = {}) {
  const startHour = opts.startHour != null ? opts.startHour : 8;
  const endHour = opts.endHour != null ? opts.endHour : 21;
  const minMs = (opts.minMinutes != null ? opts.minMinutes : 30) * 60000;
  const tz = APP_TZ();
  const wStart = new Date(windowStartISO).getTime();
  const wEnd = new Date(windowEndISO).getTime();
  const mb = [];
  for (const [s, e] of busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]).filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0])) {
    if (mb.length && s <= mb[mb.length - 1][1]) mb[mb.length - 1][1] = Math.max(mb[mb.length - 1][1], e); else mb.push([s, e]);
  }
  const free = [];
  // Pad +/- a day so the partial first/last days are scanned; the clamp drops anything
  // outside [wStart, wEnd], so the extra iterations contribute nothing on full days.
  for (let t = wStart - 86400000; t < wEnd + 86400000; t += 86400000) {
    const dayStart = Math.max(localHourUTC(new Date(t), startHour, tz), wStart);
    const dayEnd = Math.min(localHourUTC(new Date(t), endHour, tz), wEnd);
    if (dayEnd <= dayStart) continue;
    let cursor = dayStart;
    for (const [bs, be] of mb) {
      if (be <= dayStart || bs >= dayEnd) continue;
      if (bs > cursor && bs - cursor >= minMs) free.push([cursor, Math.min(bs, dayEnd)]);
      cursor = Math.max(cursor, be);
      if (cursor >= dayEnd) break;
    }
    if (dayEnd - cursor >= minMs) free.push([cursor, dayEnd]);
  }
  return free.filter(([s, e]) => e - s >= minMs).map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }));
}
