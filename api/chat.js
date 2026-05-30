// Family Hub - assistant chat (SSE streaming + tool-use loop).
//   POST /api/chat  { message }   (Bearer token)
// Streams Server-Sent Events: {type:'text',text}, {type:'tool_start',name},
// {type:'tool_end',name,ok}, {type:'error',message}, {type:'done'}.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';
import { callClaudeStream, anthropicConfigured } from '../lib/claude.js';
import { getTools, executeTool } from '../lib/tools.js';
import { PERSONA, KIDS_SYSTEM_PROMPT, buildAssistantContext } from '../lib/context.js';
import { specialistPack, SPECIALIST_SAFETY } from '../lib/specialists.js';
import { safetyPrescreen } from '../lib/safety.js';

const HISTORY_LIMIT = 20;
const MAX_TOOL_ROUNDS = 5;

// Compact, client-renderable summary of a successful tool action, so the chat UI
// can show a clean result card instead of plain text. Returns null for tools that
// don't warrant a card (reads), failures, or anything unexpected.
function toolCardData(name, result, input) {
  if (!result || result.error) return null;
  const r = result;
  if (name === 'log_meal' && r.logged) return { kind: 'meal', calories: r.logged.calories, protein_g: r.logged.protein_g, carbs_g: r.logged.carbs_g, fat_g: r.logged.fat_g };
  if (name === 'log_fitness' && r.logged) return { kind: 'fitness', steps: r.logged.steps, active_minutes: r.logged.active_minutes, sleep_minutes: r.logged.sleep_minutes };
  if (name === 'add_grocery_item' && r.added) return { kind: 'grocery', name: r.added.name, quantity: r.added.quantity };
  if (name === 'check_off_grocery' && r.checked_off) return { kind: 'grocery_check', name: r.checked_off };
  if (name === 'add_calendar_event' && r.ok && r.added) return { kind: 'event', summary: input?.summary || null, start: input?.start || null };
  if (name === 'log_play_moment' && r.celebrated) return { kind: 'play' };
  if (name === 'update_profile' && r.ok) return { kind: 'profile', updated: r.updated };
  if (name === 'remember' && r.ok) return { kind: 'memory', content: r.remembered, status: r.status };
  if (name === 'find_free_time' && r.ok && r.connected) return { kind: 'freebusy', connected: r.connected, not_connected: r.not_connected, slots: (r.free_slots || []).slice(0, 4) };
  return null;
}

async function handler(req, res) {
  // History for the chat UI on load (most recent messages, oldest first).
  if (req.method === 'GET') {
    const { data } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content, created_at')
      .eq('user_id', req.session.user_id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    return res.json({ messages: (data || []).reverse() });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const reqBody = (await readJson(req)) || {};
  const message = reqBody.message;
  const mode = reqBody.mode;
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message required' });

  // Deterministic safety gate: detection GATES generation (runs before the model).
  // Crisis / disordered-eating / clinical -> fixed safe reply, no model call.
  const screen = safetyPrescreen(message);
  if (screen.block) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.flushHeaders?.();
    const w = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    try { await supabaseAdmin.from('chat_messages').insert({ user_id: req.session.user_id, role: 'user', content: String(message).trim() }); } catch {}
    w({ type: 'text', text: screen.reply });
    try { await supabaseAdmin.from('chat_messages').insert({ user_id: req.session.user_id, role: 'assistant', content: screen.reply }); } catch {}
    w({ type: 'done' });
    return res.end();
  }

  if (!anthropicConfigured()) {
    return res.status(503).json({ error: 'assistant_not_configured', message: 'ANTHROPIC_API_KEY is not set yet.' });
  }

  const userId = req.session.user_id;
  const userName = req.session.name;

  // SSE setup.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sse = (obj) => { res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  try {
    // History (oldest -> newest), then this turn's message.
    const { data: history } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    const priorTurns = (history || []).reverse().map((m) => ({ role: m.role, content: m.content }));

    await supabaseAdmin.from('chat_messages').insert({ user_id: userId, role: 'user', content: String(message).trim() });

    const contextBlock = await buildAssistantContext(userId, userName);
    // The persona + kids block is stable, so cache it. The context block is
    // intentionally NOT cached: it holds live data (groceries, today's food,
    // calendar) that changes between turns, and caching would serve it stale.
    const system = [
      { type: 'text', text: `${PERSONA}\n\n${KIDS_SYSTEM_PROMPT}\n\n${SPECIALIST_SAFETY}`, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: contextBlock },
    ];
    const pack = specialistPack(mode);
    if (pack) system.push({ type: 'text', text: pack });
    const tools = getTools();

    let messages = [...priorTurns, { role: 'user', content: String(message).trim() }];
    const toolActions = [];
    let rounds = 0;

    let resp = await callClaudeStream({ system, messages, tools, onDelta: (kind, text) => { if (kind === 'text') sse({ type: 'text', text }); } });

    while (resp.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      messages.push({ role: 'assistant', content: resp.content });
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        sse({ type: 'tool_start', name: block.name });
        const result = await executeTool(block.name, block.input, { userId });
        toolActions.push({ tool: block.name, input: block.input, ok: !result.error });
        sse({ type: 'tool_end', name: block.name, ok: !result.error, data: toolCardData(block.name, result, block.input) });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
      resp = await callClaudeStream({ system, messages, tools, onDelta: (kind, text) => { if (kind === 'text') sse({ type: 'text', text }); } });
    }

    const finalText = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    await supabaseAdmin.from('chat_messages').insert({
      user_id: userId,
      role: 'assistant',
      content: finalText || '(no reply)',
      tool_actions: toolActions,
    });

    sse({ type: 'done' });
    res.end();
  } catch (err) {
    sse({ type: 'error', message: err.message || 'assistant error' });
    res.end();
  }
}

export default requireSession(handler);
