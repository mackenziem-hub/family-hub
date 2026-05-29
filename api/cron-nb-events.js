// Family Hub - refresh NB event sources (Vercel Cron). NOT session-gated; it is
// machine-triggered. Auth: Vercel sets x-vercel-cron on scheduled runs; manual runs
// must send Authorization: Bearer <CRON_SECRET>.
//
// This stores a freshness "pointer" per source (a deep link to the live calendar) so the
// app can show "current events" without brittle per-event scraping. Real per-event parsing
// is a future enhancement; the curated nb_places list carries the everyday value.
import { supabaseAdmin } from '../lib/supabase.js';

const FEEDS = [
  { source: 'City of Moncton', url: 'https://www.moncton.ca/things-do/events' },
  { source: 'Tourism New Brunswick', url: 'https://tourismnewbrunswick.ca/whats-happening/' },
  { source: 'Resurgo Place', url: 'https://resurgo.ca/' },
  { source: 'Pickle Planet Moncton', url: 'https://www.pickleplanetmoncton.com/' },
];

export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || '').trim();
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const isVercelCron = Boolean(req.headers['x-vercel-cron']);
  if (!isVercelCron && (!secret || auth !== secret)) return res.status(401).json({ error: 'unauthorized' });

  const results = [];
  for (const feed of FEEDS) {
    try {
      const r = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FamilyHub/1.0; +calendar)' } });
      // Insert the new pointer first, then delete older ones for this source, so a failed
      // insert never leaves the source with no cached row.
      const { data: ins, error: insErr } = await supabaseAdmin.from('nb_event_cache').insert({
        source: feed.source,
        title: r.ok ? `${feed.source}: current events` : `${feed.source}: temporarily unreachable`,
        url: feed.url,
        raw: { status: r.status },
      }).select('id').single();
      if (!insErr && ins) await supabaseAdmin.from('nb_event_cache').delete().eq('source', feed.source).neq('id', ins.id);
      results.push({ source: feed.source, status: r.status, ok: r.ok });
    } catch (err) {
      results.push({ source: feed.source, error: err.message }); // keep prior pointer on error
    }
  }
  return res.json({ ok: true, refreshed: results, at: new Date().toISOString() });
}
