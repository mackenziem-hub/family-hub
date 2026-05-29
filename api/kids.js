// Family Hub - Kids API (shared profiles; age computed at read time).
//   GET    /api/kids
//   POST   /api/kids?action=add_kid  { name, birthdate?, notes? }
//   PATCH  /api/kids                 { id, name?, birthdate?, notes? }
//   DELETE /api/kids?id=<uuid>
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';
import { computeAge } from '../lib/dates.js';

async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('kids').select('id, name, birthdate, notes, created_at').order('created_at');
    if (error) { console.error('[kids GET]', error.message); return res.status(500).json({ error: 'Could not load kids.' }); }
    return res.json((data || []).map((k) => ({ ...k, age: computeAge(k.birthdate) })));
  }

  if (req.method === 'POST' && req.query.action === 'add_kid') {
    const { name, birthdate, notes } = await readJson(req);
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const { data, error } = await supabaseAdmin.from('kids')
      .insert({ name: String(name).trim(), birthdate: birthdate || null, notes: notes ? String(notes) : null })
      .select('id, name, birthdate, notes').single();
    if (error) { console.error('[kids add]', error.message); return res.status(500).json({ error: 'Could not add.' }); }
    return res.json({ ...data, age: computeAge(data.birthdate) });
  }

  if (req.method === 'PATCH') {
    const body = await readJson(req);
    if (!body.id) return res.status(400).json({ error: 'id required' });
    const patch = {};
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (body.birthdate !== undefined) patch.birthdate = body.birthdate || null;
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes) : null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    const { data, error } = await supabaseAdmin.from('kids').update(patch).eq('id', body.id).select('id, name, birthdate, notes').single();
    if (error) { console.error('[kids PATCH]', error.message); return res.status(500).json({ error: 'Could not update.' }); }
    return res.json({ ...data, age: computeAge(data.birthdate) });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin.from('kids').delete().eq('id', id);
    if (error) { console.error('[kids DELETE]', error.message); return res.status(500).json({ error: 'Could not delete.' }); }
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireSession(handler);
