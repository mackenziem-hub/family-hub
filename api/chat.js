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

const HISTORY_LIMIT = 20;
const MAX_TOOL_ROUNDS = 5;

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

  const { message } = await readJson(req);
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message required' });
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
      { type: 'text', text: `${PERSONA}\n\n${KIDS_SYSTEM_PROMPT}`, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: contextBlock },
    ];
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
        sse({ type: 'tool_end', name: block.name, ok: !result.error });
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
