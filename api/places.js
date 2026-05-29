// Family Hub - Moncton/NB places + cached events (read).
//   GET /api/places?venues=1[&sensory=1][&kind=venue|trip]  -> curated evergreen list
//   GET /api/places?events=1                                -> cached dated events / source pointers
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (req.query.events === '1') {
    const { data, error } = await supabaseAdmin.from('nb_event_cache')
      .select('source, title, starts_on, ends_on, url, fetched_at')
      .order('fetched_at', { ascending: false }).limit(50);
    if (error) { console.error('[places events]', error.message); return res.status(500).json({ error: 'Could not load events.' }); }
    return res.json(data || []);
  }

  let q = supabaseAdmin.from('nb_places')
    .select('id, name, kind, what_why, address, url, season, indoor_outdoor, age_fit, crowd_level, noise_level, easy_exit, sensory_friendly, is_seasonal')
    .eq('active', true).order('kind').order('name');
  if (req.query.sensory === '1') q = q.eq('sensory_friendly', true);
  if (['venue', 'trip', 'event'].includes(req.query.kind)) q = q.eq('kind', req.query.kind);
  const { data, error } = await q;
  if (error) { console.error('[places GET]', error.message); return res.status(500).json({ error: 'Could not load places.' }); }
  return res.json(data || []);
}

export default requireSession(handler);
