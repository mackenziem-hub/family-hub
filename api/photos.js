// Family Hub - photo bank (Phase 2.2). Private per user; best-effort Claude-vision
// caption on upload so the assistant can reference the contents later.
//   GET    /api/photos                                   -> { photos:[{...,url}] }
//   POST   /api/photos {image_base64, media_type, category} -> { photo }
//   DELETE /api/photos?id=...                            -> { ok }
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';
import { randomUUID } from 'node:crypto';

const BUCKET = 'photo-bank';
const CATS = ['pantry', 'fridge', 'meal', 'workout', 'kids_art', 'other'];

async function captionImage(base64, mediaType, category) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 140,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `This is a "${category}" photo for a family assistant. In under 40 words, list the useful, visible items/contents (foods, equipment, supplies) so the assistant can reference it later. No preamble, no markdown.` },
        ] }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j.content && j.content[0] && j.content[0].text) || '';
    return txt.trim().slice(0, 500) || null;
  } catch { return null; }
}

async function signed(path) {
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data ? data.signedUrl : null;
}

async function handler(req, res) {
  const userId = req.session.user_id;

  if (req.method === 'GET') {
    const { data } = await supabaseAdmin.from('photo_bank').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    const photos = [];
    for (const p of data || []) {
      photos.push({ id: p.id, category: p.category, caption: p.caption, tags: p.tags, created_at: p.created_at, url: await signed(p.storage_path) });
    }
    return res.json({ photos });
  }

  if (req.method === 'POST') {
    const body = (await readJson(req)) || {};
    const b64 = String(body.image_base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) return res.status(400).json({ error: 'image_base64 required' });
    const mediaType = body.media_type === 'image/png' ? 'image/png' : 'image/jpeg';
    const category = CATS.includes(body.category) ? body.category : 'other';
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 4_200_000) return res.status(413).json({ error: 'Image too large; please downscale.' });

    const ext = mediaType === 'image/png' ? 'png' : 'jpg';
    const path = `${userId}/${randomUUID()}.${ext}`;
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: mediaType, upsert: false });
    if (up.error) { console.error('[photos POST upload]', up.error.message); return res.status(500).json({ error: 'Upload failed.' }); }

    const caption = await captionImage(b64, mediaType, category);
    const { data, error } = await supabaseAdmin.from('photo_bank')
      .insert({ user_id: userId, category, storage_path: path, caption })
      .select('*').single();
    if (error) { console.error('[photos POST insert]', error.message); return res.status(500).json({ error: 'Save failed.' }); }
    return res.json({ photo: { id: data.id, category: data.category, caption: data.caption, tags: data.tags, created_at: data.created_at, url: await signed(path) } });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: row } = await supabaseAdmin.from('photo_bank').select('storage_path').eq('id', id).eq('user_id', userId).maybeSingle();
    if (row) {
      await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path]);
      await supabaseAdmin.from('photo_bank').delete().eq('id', id).eq('user_id', userId);
    }
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireSession(handler);
