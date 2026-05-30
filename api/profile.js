// Family Hub - per-user profile (Phase 2.2). Private to the session user; feeds the
// assistant's context + specialist coaching.
//   GET  /api/profile          -> { profile }
//   PUT  /api/profile {fields}  -> { profile }   (also accepts PATCH)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';

const STR = ['diet', 'goals', 'goals_doc', 'personality', 'notes'];
const ARR = ['allergies', 'dislikes', 'interests', 'hobbies'];

function cleanArr(v) {
  let arr;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') arr = v.split(',');
  else return undefined;
  return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 60);
}

const EMPTY = { allergies: [], dislikes: [], interests: [], hobbies: [] };

async function handler(req, res) {
  const userId = req.session.user_id;

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin.from('profiles').select('*').eq('user_id', userId).maybeSingle();
    return res.json({ profile: data || { user_id: userId, ...EMPTY } });
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const body = (await readJson(req)) || {};
    const patch = { user_id: userId, updated_at: new Date().toISOString() };
    for (const k of STR) if (k in body) patch[k] = body[k] == null ? null : String(body[k]).slice(0, 8000);
    for (const k of ARR) { const a = cleanArr(body[k]); if (a !== undefined) patch[k] = a; }
    const { data, error } = await supabaseAdmin.from('profiles').upsert(patch, { onConflict: 'user_id' }).select('*').single();
    if (error) { console.error('[profile PUT]', error.message); return res.status(500).json({ error: 'Could not save profile.' }); }
    return res.json({ profile: data });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireSession(handler);
