// Family Hub - unified calendar read. Prefers Google OAuth (fresh, no ~1h lag) once
// anyone has connected; otherwise falls back to the read-only ICS feed. Used by
// api/calendar.js, the assistant context, and the get_calendar tool so they agree.
import { fetchCalendarEvents } from './calendar.js';
import { googleConfigured, hasAnyGoogleToken, listGoogleEvents } from './google.js';

export async function getUpcomingEvents(days = 7) {
  if (googleConfigured()) {
    try {
      if (await hasAnyGoogleToken()) {
        const events = await listGoogleEvents(days);
        if (events) return { configured: true, source: 'google', events, total: events.length };
      }
    } catch (err) {
      console.error('[calendarRead] google read failed, falling back to ICS:', err.message);
    }
  }
  const ics = await fetchCalendarEvents(days);
  return { ...ics, source: 'ics' };
}
