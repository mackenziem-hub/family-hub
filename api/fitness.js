// Family Hub - Fitness read (Fitbit). Refresh-on-demand: syncing happens when the
// app opens this, not on a tight cron. Surfaces gentle family trends, never deficits/ranks.
//   GET /api/fitness            -> { connected, today }   (syncs today on open)
//   GET /api/fitness?trends=1   -> { connected, days: [...] } (last 7 days, this user)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readDailySummary, isFitbitConnected } from '../lib/fitness.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const userId = req.session.user_id;
  const connected = await isFitbitConnected(userId);
  if (!connected) return res.json({ connected: false });

  if (req.query.trends === '1') {
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { data } = await supabaseAdmin.from('fitness_daily')
      .select('day, steps, calories_out, active_minutes, sleep_minutes')
      .eq('user_id', userId).gte('day', since).order('day');
    return res.json({ connected: true, days: data || [] });
  }

  // Default: sync + return today.
  try {
    const today = await readDailySummary(userId);
    return res.json({ connected: true, today });
  } catch (e) {
    if (e.code === 429) return res.json({ connected: true, busy: true, message: 'Fitbit is busy, try again shortly.' });
    console.error('[fitness GET]', e.message);
    // Fall back to the last stored row so the UI still shows something.
    const { data } = await supabaseAdmin.from('fitness_daily').select('*').eq('user_id', userId).eq('provider', 'fitbit').order('day', { ascending: false }).limit(1).maybeSingle();
    return res.json({ connected: true, today: data || null, stale: true });
  }
}

export default requireSession(handler);
