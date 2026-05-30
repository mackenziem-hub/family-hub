// Family Hub - Fitness read. Refresh-on-demand: Fitbit (if ever connected) syncs when
// the app opens this; otherwise it serves whatever the user self-logged via the
// assistant. Surfaces gentle family trends, never deficits/ranks.
//   GET /api/fitness            -> { connected, today, source }   (today, fitbit-or-manual)
//   GET /api/fitness?trends=1   -> { connected, days: [...] } (last 7 days, this user, any source)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readTodayFitness, isFitbitConnected } from '../lib/fitness.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const userId = req.session.user_id;
  const connected = await isFitbitConnected(userId);

  if (req.query.trends === '1') {
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { data } = await supabaseAdmin.from('fitness_daily')
      .select('day, steps, calories_out, active_minutes, sleep_minutes')
      .eq('user_id', userId).gte('day', since).order('day');
    return res.json({ connected, days: data || [] });
  }

  // Default: today's activity from the best source (live Fitbit, else self-logged).
  try {
    const today = await readTodayFitness(userId);
    return res.json({ connected, today, source: today?.source || null });
  } catch (e) {
    if (e.code === 429) return res.json({ connected, busy: true, message: 'Fitbit is busy, try again shortly.' });
    console.error('[fitness GET]', e.message);
    // Fall back to the last stored row so the UI still shows something.
    const { data } = await supabaseAdmin.from('fitness_daily').select('*').eq('user_id', userId).order('day', { ascending: false }).limit(1).maybeSingle();
    return res.json({ connected, today: data || null, stale: true });
  }
}

export default requireSession(handler);
