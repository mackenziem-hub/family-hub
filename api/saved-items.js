// Family Hub - saved activities + conversation topics (shared library).
//   GET    /api/saved-items?kind=activity|topic&kid_id=<uuid>
//   POST   /api/saved-items  { kind, title, detail?, kid_id?, tags? }
//   DELETE /api/saved-items?id=<uuid>
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';

const KINDS = ['activity', 'topic'];

async function handler(req, res) {
  if (req.method === 'GET') {
    let q = supabaseAdmin.from('saved_items')
      .select('id, kind, kid_id, title, detail, tags, favorited, created_by, created_at')
      .order('created_at', { ascending: false });
    if (KINDS.includes(req.query.kind)) q = q.eq('kind', req.query.kind);
    if (req.query.kid_id) q = q.eq('kid_id', req.query.kid_id);
    const { data, error } = await q;
    if (error) { console.error('[saved GET]', error.message); return res.status(500).json({ error: 'Could not load.' }); }
    return res.json(data || []);
  }

  if (req.method === 'POST') {
    const { kind, title, detail, kid_id, tags } = await readJson(req);
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be activity or topic' });
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title required' });
    const { data, error } = await supabaseAdmin.from('saved_items').insert({
      kind,
      kid_id: kid_id || null,
      title: String(title).trim().slice(0, 200),
      detail: detail ? String(detail) : null,
      tags: Array.isArray(tags) ? tags : [],
      created_by: req.session.user_id,
    }).select('id, kind, kid_id, title, detail, tags, favorited, created_by, created_at').single();
    if (error) { console.error('[saved POST]', error.message); return res.status(500).json({ error: 'Could not save.' }); }
    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin.from('saved_items').delete().eq('id', id);
    if (error) { console.error('[saved DELETE]', error.message); return res.status(500).json({ error: 'Could not delete.' }); }
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireSession(handler);
