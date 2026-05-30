// Family Hub - "magic capture": paste/snap anything (school email, invite, flyer,
// list) -> one Claude pass extracts MIXED items -> review -> fan out to the unified
// stores (groceries / Google Calendar). Always two-step (extract, then commit on
// confirm); never auto-writes. Mirrors api/profile-import.js.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';
import { insertGoogleEvent, isGoogleConnected } from '../lib/google.js';
import { todayLocalISODate } from '../lib/dates.js';

const EXTRACT_TOOL = {
  name: 'extracted_items',
  description: 'The actionable items found in the input.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['event', 'grocery', 'todo', 'reminder'] },
            title: { type: 'string', description: 'Event title, grocery item, or task text.' },
            date: { type: 'string', description: 'YYYY-MM-DD if known (resolve relative dates against today).' },
            time: { type: 'string', description: 'HH:MM 24h local start time if known.' },
            end_time: { type: 'string', description: 'HH:MM 24h local end time if known.' },
            all_day: { type: 'boolean' },
            quantity: { type: 'string', description: 'For grocery items only.' },
            location: { type: 'string' },
            who: { type: 'string', description: 'Person/kid it concerns, if mentioned.' },
            confidence: { type: 'number', description: '0-1.' },
          },
          required: ['type', 'title'],
        },
      },
    },
    required: ['items'],
  },
};

async function extract({ text, image_base64, media_type }) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('not configured');
  const tz = (process.env.APP_TIMEZONE || 'America/Moncton').trim();
  const today = todayLocalISODate();
  const content = [];
  if (image_base64) content.push({ type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_base64 } });
  content.push({ type: 'text', text: `Today is ${today} (timezone ${tz}). Extract every actionable item from the following (a pasted message, email, flyer, list, or photo). Classify each: event (has a date/time), grocery (a thing to buy), todo (a task), or reminder. Resolve relative dates like "next Tuesday" to YYYY-MM-DD using today's date. Use 24-hour local time. Set confidence 0-1. Do NOT invent items or details.\n\n--- INPUT ---\n${String(text || '').slice(0, 40000)}` });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, tools: [EXTRACT_TOOL], tool_choice: { type: 'tool', name: 'extracted_items' }, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error('extract ' + r.status);
  const j = await r.json();
  const blk = (j.content || []).find((b) => b.type === 'tool_use');
  return (blk && blk.input && Array.isArray(blk.input.items)) ? blk.input.items : [];
}

async function commitItems(userId, items) {
  const results = [];
  const googleOk = !!(await isGoogleConnected(userId));
  for (const it of items) {
    const title = String(it.title || '').trim();
    if (!title) { continue; }
    try {
      if (it.type === 'grocery') {
        const { error } = await supabaseAdmin.from('grocery_items').insert({ name: title.slice(0, 200), quantity: it.quantity ? String(it.quantity).slice(0, 60) : null, added_by: userId });
        results.push({ type: 'grocery', title, ok: !error });
      } else {
        // event / todo / reminder -> Google Calendar (timed event, or all-day for undated tasks)
        if (!googleOk) { results.push({ type: it.type, title, ok: false, reason: 'calendar_not_connected' }); continue; }
        const date = it.date || todayLocalISODate();
        const allDay = it.all_day || !it.time;
        const summary = it.who ? `${title} (${it.who})` : title;
        const start = allDay ? date : `${date}T${it.time}:00`;
        const end = allDay ? null : (it.end_time ? `${date}T${it.end_time}:00` : null);
        await insertGoogleEvent(userId, { summary, start, end, allDay, location: it.location || null });
        results.push({ type: it.type, title, ok: true, when: allDay ? date : `${date} ${it.time}` });
      }
    } catch (e) { console.error('[capture commit]', e.message); results.push({ type: it.type, title, ok: false }); }
  }
  return results;
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const userId = req.session.user_id;
  const body = (await readJson(req)) || {};

  if (body.action === 'extract') {
    if (!body.text && !body.image_base64) return res.status(400).json({ error: 'text or image required' });
    const b64 = String(body.image_base64 || '').replace(/^data:[^;]+;base64,/, '');
    // Guard the ENCODED size (what's actually in the request body) against Vercel's ~4.5MB
    // body cap, not the decoded image size, or this friendly 413 never fires before the platform's.
    if (b64 && b64.length > 4_000_000) return res.status(413).json({ error: 'Image too large; downscale first.' });
    try {
      const items = await extract({ text: body.text, image_base64: b64 || null, media_type: body.media_type });
      return res.json({ items });
    } catch (e) { console.error('[capture extract]', e.message); return res.status(502).json({ error: 'Could not read that.' }); }
  }

  if (body.action === 'commit') {
    const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    if (!items.length) return res.status(400).json({ error: 'no items' });
    return res.json({ results: await commitItems(userId, items) });
  }

  return res.status(400).json({ error: 'unknown action' });
}

export default requireSession(handler);
