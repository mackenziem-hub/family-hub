// Family Hub - read-only Google Calendar via its secret ICS (iCal) URL.
// Zero OAuth: the URL itself is the secret. Trade-off: Google propagates ICS
// changes with ~1h lag, so brand-new events may not appear for up to an hour.
// (Ported from the Ryujin google-cal parser; Phase 4 swaps in OAuth read/write.)

// RFC 5545 §3.1 line unfolding: a line starting with space/tab continues the prior one.
function unfold(text) {
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeIcs(s) {
  return String(s || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// DTSTART forms: 20260601T130000Z (UTC), 20260601T130000 (floating/TZID -> approximate
// via APP_TIMEZONE offset), 20260601 (all-day). Returns an ISO UTC string or null.
function parseIcsDate(value, params) {
  const m = String(value || '').trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return new Date(`${y}-${mo}-${d}T12:00:00Z`).toISOString(); // all-day, anchor noon UTC
  if (z) return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`).toISOString();
  // Floating or TZID. Without an IANA tz lib, approximate as the family's tz.
  // Off by 1h on the two DST switch days; CAL_TZ_OFFSET_HOURS env can override.
  // Signed offset: negative = west of UTC (Atlantic is -3 in daylight time).
  // Subtracting a signed offset converts wall-clock -> UTC: e.g. -3 means 2pm local
  // becomes 2pm + 3h = 5pm UTC. A positive offset (east of UTC) would subtract.
  const offset = parseFloat(process.env.CAL_TZ_OFFSET_HOURS || '-3');
  const wallClockAsUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  return new Date(wallClockAsUtc - offset * 3600 * 1000).toISOString();
}

function parseEvent(lines) {
  const ev = {};
  for (const line of lines) {
    const colonAt = line.indexOf(':');
    if (colonAt < 0) continue;
    const keyPart = line.slice(0, colonAt);
    const value = line.slice(colonAt + 1);
    const [key, ...paramsArr] = keyPart.split(';');
    const params = {};
    for (const p of paramsArr) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq)] = p.slice(eq + 1);
    }
    switch (key) {
      case 'UID': ev.uid = value; break;
      case 'SUMMARY': ev.summary = unescapeIcs(value); break;
      case 'DESCRIPTION': ev.description = unescapeIcs(value); break;
      case 'LOCATION': ev.location = unescapeIcs(value); break;
      case 'STATUS': ev.status = value; break;
      case 'DTSTART': ev.startTime = parseIcsDate(value, params); ev.allDay = params.VALUE === 'DATE'; break;
      case 'DTEND': ev.endTime = parseIcsDate(value, params); break;
    }
  }
  if (!ev.startTime) return null;
  return ev;
}

function parseIcs(text) {
  const lines = unfold(text);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = []; continue; }
    if (line === 'END:VEVENT') {
      if (cur) { const ev = parseEvent(cur); if (ev) events.push(ev); }
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  return events;
}

// 60s in-memory cache of the fetched+parsed feed. Google propagates ICS changes
// with ~1h lag, so a short cache costs no real freshness and avoids re-fetching the
// whole feed on every chat turn / page load (the assistant reads the calendar often).
let _cache = { ts: 0, all: null };

// Fetch + parse the ICS feed, returning events within [now-1d, now+days].
// { configured:false } when GOOGLE_CALENDAR_ICS_URL is unset.
export async function fetchCalendarEvents(days = 7) {
  const icsUrl = (process.env.GOOGLE_CALENDAR_ICS_URL || '').trim();
  if (!icsUrl) return { configured: false, events: [], total: 0 };

  const d = Math.max(1, Math.min(90, parseInt(days, 10) || 7));

  let all = (_cache.all && Date.now() - _cache.ts < 60000) ? _cache.all : null;
  if (!all) {
    try {
      const r = await fetch(icsUrl, { headers: { 'User-Agent': 'Family-Hub/1.0 (calendar reader)' } });
      if (!r.ok) {
        if (_cache.all) all = _cache.all; // serve stale rather than fail
        else return { configured: true, error: `ics_fetch_failed_${r.status}`, events: [], total: 0 };
      } else {
        all = parseIcs(await r.text());
        _cache = { ts: Date.now(), all };
      }
    } catch (err) {
      if (_cache.all) all = _cache.all;
      else return { configured: true, error: 'ics_fetch_failed', detail: err.message, events: [], total: 0 };
    }
  }

  const startMs = Date.now();
  const endMs = startMs + d * 86400000;
  const events = all
    .filter((ev) => {
      const t = new Date(ev.startTime).getTime();
      return Number.isFinite(t) && t >= startMs - 86400000 && t <= endMs && ev.status !== 'CANCELLED';
    })
    .sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)))
    .map((ev) => ({
      uid: ev.uid || null,
      summary: ev.summary || '(untitled)',
      location: ev.location || null,
      description: ev.description || null,
      startTime: ev.startTime,
      endTime: ev.endTime || null,
      allDay: !!ev.allDay,
    }));

  return { configured: true, events, total: events.length, window: { days: d } };
}
