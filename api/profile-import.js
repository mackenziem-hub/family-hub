// Family Hub - import profile facts from another AI's memories/exports.
// Distills durable, profile-relevant facts with Claude (never stores raw history),
// returns them for the user to review, then merges on approval.
//   POST /api/profile-import {action:'distill', text}  -> { facts }   (no save)
//   POST /api/profile-import {action:'apply', facts}   -> { profile }
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';

const FACTS_TOOL = {
  name: 'profile_facts',
  description: 'Record durable, profile-relevant facts clearly stated about the person.',
  input_schema: {
    type: 'object',
    properties: {
      diet: { type: 'string', description: 'Overall diet, if clearly stated.' },
      allergies: { type: 'array', items: { type: 'string' } },
      dislikes: { type: 'array', items: { type: 'string' } },
      interests: { type: 'array', items: { type: 'string' } },
      hobbies: { type: 'array', items: { type: 'string' } },
      goals: { type: 'string', description: 'Current goals.' },
      personality: { type: 'string', description: 'How they communicate / what helps them.' },
      north_star: { type: 'string', description: 'Long-term goals / values, if expressed.' },
      notes: { type: 'array', items: { type: 'string' }, description: 'Other durable facts about them.' },
    },
  },
};

async function distill(text) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('assistant not configured');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [FACTS_TOOL],
      tool_choice: { type: 'tool', name: 'profile_facts' },
      messages: [{ role: 'user', content: `The text below is from this person's memories or conversations with another AI assistant. Extract ONLY durable, clearly-stated facts about THIS PERSON that a family wellness + life assistant would use: diet, food allergies, food dislikes, interests, hobbies, current goals, how they communicate / what helps them, and any long-term north-star goals or values. Ignore work specifics, one-off questions, transient chatter, and anything you are not confident is about them. Be concise and do not invent.\n\n--- TEXT ---\n${String(text).slice(0, 120000)}` }],
    }),
  });
  if (!r.ok) throw new Error('distill ' + r.status);
  const j = await r.json();
  const blk = (j.content || []).find((b) => b.type === 'tool_use');
  return blk ? blk.input : {};
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const userId = req.session.user_id;
  const body = (await readJson(req)) || {};

  if (body.action === 'distill') {
    const text = String(body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    try { return res.json({ facts: await distill(text) }); }
    catch (e) { console.error('[profile-import distill]', e.message); return res.status(502).json({ error: 'Could not read that text.' }); }
  }

  if (body.action === 'apply') {
    const f = body.facts || {};
    const { data: cur } = await supabaseAdmin.from('profiles').select('*').eq('user_id', userId).maybeSingle();
    const p = cur || {};
    const mergeArr = (ex, add) => {
      const s = new Set((ex || []).map(String));
      for (const x of add || []) { const v = String(x).trim(); if (v) s.add(v); }
      return Array.from(s).slice(0, 80);
    };
    const patch = { user_id: userId, updated_at: new Date().toISOString() };
    if (f.diet) patch.diet = String(f.diet).slice(0, 300);
    if (f.goals) patch.goals = String(f.goals).slice(0, 3000);
    if (f.personality) patch.personality = ((p.personality ? p.personality + ' ' : '') + String(f.personality)).slice(0, 6000);
    if (Array.isArray(f.allergies)) patch.allergies = mergeArr(p.allergies, f.allergies);
    if (Array.isArray(f.dislikes)) patch.dislikes = mergeArr(p.dislikes, f.dislikes);
    if (Array.isArray(f.interests)) patch.interests = mergeArr(p.interests, f.interests);
    if (Array.isArray(f.hobbies)) patch.hobbies = mergeArr(p.hobbies, f.hobbies);
    if (Array.isArray(f.notes) && f.notes.length) patch.notes = ((p.notes ? p.notes + '\n' : '') + f.notes.map(String).join('\n')).slice(0, 8000);
    if (f.north_star) patch.goals_doc = ((p.goals_doc ? p.goals_doc + '\n\n' : '') + String(f.north_star)).slice(0, 8000);
    const { data, error } = await supabaseAdmin.from('profiles').upsert(patch, { onConflict: 'user_id' }).select('*').single();
    if (error) { console.error('[profile-import apply]', error.message); return res.status(500).json({ error: 'Could not save.' }); }
    return res.json({ profile: data });
  }

  return res.status(400).json({ error: 'unknown action' });
}

export default requireSession(handler);
