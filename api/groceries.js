// Family Hub - Groceries API (shared list; both users see and edit one list).
//   GET    /api/groceries[?include_checked=1]   -> [ items ]
//   POST   /api/groceries  { name, quantity?, category? }
//   PATCH  /api/groceries  { id, checked?, name?, quantity?, category? }
//   DELETE /api/groceries?id=<uuid>             (or ?clear_checked=1)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';

async function handler(req, res) {
  // ── LIST ──
  if (req.method === 'GET') {
    let q = supabaseAdmin
      .from('grocery_items')
      .select('id, name, quantity, category, checked, added_by, checked_at, created_at')
      .order('checked', { ascending: true })
      .order('created_at', { ascending: true });
    if (req.query.include_checked !== '1') q = q.eq('checked', false);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  // ── ADD ──
  if (req.method === 'POST') {
    const { name, quantity, category } = await readJson(req);
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const { data, error } = await supabaseAdmin
      .from('grocery_items')
      .insert({
        name: String(name).trim(),
        quantity: quantity ? String(quantity).trim() : null,
        category: category ? String(category).trim() : null,
        added_by: req.session.user_id,
      })
      .select('id, name, quantity, category, checked, added_by, checked_at, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── UPDATE (toggle / edit) ──
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    if (!body.id) return res.status(400).json({ error: 'id required' });
    const patch = {};
    if (typeof body.checked === 'boolean') {
      patch.checked = body.checked;
      patch.checked_at = body.checked ? new Date().toISOString() : null;
    }
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (body.quantity !== undefined) patch.quantity = body.quantity ? String(body.quantity).trim() : null;
    if (body.category !== undefined) patch.category = body.category ? String(body.category).trim() : null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    const { data, error } = await supabaseAdmin
      .from('grocery_items')
      .update(patch)
      .eq('id', body.id)
      .select('id, name, quantity, category, checked, added_by, checked_at, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── DELETE (single, or clear all checked) ──
  if (req.method === 'DELETE') {
    if (req.query.clear_checked === '1') {
      const { error } = await supabaseAdmin.from('grocery_items').delete().eq('checked', true);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    }
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin.from('grocery_items').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireSession(handler);
