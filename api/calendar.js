// Family Hub - Calendar API.
//   GET    /api/calendar?days=7   -> events (Google OAuth if connected, else read-only ICS)
//   POST   /api/calendar          -> add an event (requires the acting user to have connected Google)
//   DELETE /api/calendar?id=<id>  -> delete an event (Google)
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';
import { getUpcomingEvents } from '../lib/calendarRead.js';
import { insertGoogleEvent, deleteGoogleEvent, isGoogleConnected, combinedFreeBusy, invertBusyToFree } from '../lib/google.js';

async function handler(req, res) {
  if (req.method === 'GET') {
    if (req.query.action === 'freebusy') {
      const days = Math.min(parseInt(req.query.days, 10) || 7, 14);
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + days * 86400000).toISOString();
      try {
        const cfb = await combinedFreeBusy(timeMin, timeMax);
        const free = invertBusyToFree(cfb.merged, timeMin, timeMax).slice(0, 40);
        return res.json({ connectedCount: cfb.connectedCount, perPerson: cfb.perPerson.map((p) => ({ email: p.email, connected: p.connected, busyCount: p.busy.length })), free });
      } catch (e) { console.error('[calendar freebusy]', e.message); return res.status(502).json({ error: 'Could not read free/busy.' }); }
    }
    const days = parseInt(req.query.days, 10) || 7;
    return res.json(await getUpcomingEvents(days));
  }

  if (req.method === 'POST') {
    if (!(await isGoogleConnected(req.session.user_id))) return res.status(409).json({ error: 'google_not_connected' });
    const { summary, start, end, location, description, allDay } = await readJson(req);
    if (!summary || !start) return res.status(400).json({ error: 'summary and start required' });
    try {
      const ev = await insertGoogleEvent(req.session.user_id, { summary, start, end, location, description, allDay: !!allDay });
      return res.json(ev);
    } catch (e) { console.error('[calendar POST]', e.message); return res.status(502).json({ error: 'Could not add the event.' }); }
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (!(await isGoogleConnected(req.session.user_id))) return res.status(409).json({ error: 'google_not_connected' });
    try { await deleteGoogleEvent(req.session.user_id, id); return res.json({ ok: true }); }
    catch (e) { console.error('[calendar DELETE]', e.message); return res.status(502).json({ error: 'Could not delete the event.' }); }
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireSession(handler);
