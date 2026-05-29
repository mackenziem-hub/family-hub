// Family Hub - "be more active" layer. Invitation-and-celebration only: no streaks,
// no quotas, no nagging. The only write is an append-only play_moment.
//   GET  /api/active?ideas=1[&fresh=1]  -> { idea, count }   (one optional play idea)
//   GET  /api/active?trends=1           -> { days, totalSteps } (gentle family aggregate)
//   POST /api/active  { note?, kid_name? } -> log a play moment (always additive)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';

// Interest-led defaults (dinosaurs + crafts + low-exertion), used when the family has
// not saved any play ideas yet. Tiny, playful, two minutes or less.
const DEFAULT_PLAY_IDEAS = [
  'Five dinosaur stomps by the front door before shoes go on. Loud, silly, two minutes.',
  'A quick "fossil dig": hide a few small toys in cushions or a rice bin and dig them out.',
  'Crank one song for a living-room dance-and-freeze. Whoever wants to join, joins.',
  'A slow "dino walk" around the block: heavy stomps, big arm swings, count what you spot.',
  'Build a short pillow obstacle course and crawl through it once together.',
  'Stretch-and-roar: three big stretches, three little roars, done.',
];

function pickIdea(pool, fresh) {
  if (!pool.length) return null;
  if (fresh) return pool[Math.floor(Math.random() * pool.length)];
  return pool[new Date().getDate() % pool.length]; // stable through the day
}

async function handler(req, res) {
  const userId = req.session.user_id;

  if (req.method === 'GET' && req.query.trends === '1') {
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { data } = await supabaseAdmin.from('fitness_daily').select('day, steps, active_minutes').gte('day', since);
    const byDay = {};
    for (const r of data || []) {
      byDay[r.day] = byDay[r.day] || { steps: 0, active_minutes: 0 };
      byDay[r.day].steps += r.steps || 0;
      byDay[r.day].active_minutes += r.active_minutes || 0;
    }
    const days = Object.entries(byDay).map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day));
    return res.json({ days, totalSteps: days.reduce((a, d) => a + d.steps, 0) });
  }

  if (req.method === 'GET') { // ideas (default)
    const { data } = await supabaseAdmin.from('saved_items').select('title, detail').eq('kind', 'play_idea').order('created_at', { ascending: false });
    const saved = (data || []).map((s) => s.detail || s.title).filter(Boolean);
    const pool = saved.length ? saved : DEFAULT_PLAY_IDEAS;
    return res.json({ idea: pickIdea(pool, req.query.fresh === '1'), count: saved.length });
  }

  if (req.method === 'POST') {
    const { note, kid_name } = await readJson(req);
    let kidId = null;
    if (kid_name) {
      const { data: kid } = await supabaseAdmin.from('kids').select('id').ilike('name', String(kid_name).trim()).limit(1);
      kidId = (kid && kid[0] && kid[0].id) || null;
    }
    const { error } = await supabaseAdmin.from('play_moments').insert({
      done_by: userId, kid_id: kidId, note: note ? String(note).slice(0, 300) : null,
    });
    if (error) { console.error('[active POST]', error.message); return res.status(500).json({ error: 'Could not log that.' }); }
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireSession(handler);
