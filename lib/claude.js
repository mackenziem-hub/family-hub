// Family Hub - Anthropic Messages API wrapper (raw fetch, no SDK).
// Streams the response and assembles content blocks (text + tool_use), so the
// caller can forward text deltas to the browser over SSE and then inspect
// stop_reason / tool_use blocks to run the tool loop.

export const MODEL = (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6').trim();
export const ANTHROPIC_VERSION = '2023-06-01';

export function anthropicConfigured() {
  return Boolean((process.env.ANTHROPIC_API_KEY || '').trim());
}

// callClaudeStream({ system, messages, tools, tool_choice, max_tokens, model, onDelta })
//   onDelta(kind, text): called with kind 'text' as text streams in (kind 'thinking' too if enabled).
// Returns { id, role:'assistant', content:[blocks], stop_reason, usage }.
export async function callClaudeStream({
  system, messages, tools, tool_choice, max_tokens = 1500, model = MODEL, onDelta,
}) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const body = { model, max_tokens, messages, stream: true };
  if (system) body.system = system;
  if (tools && tools.length) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;

  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (response.ok) break;
    // Backoff is awaited mid-request (before we have responded to the browser),
    // so it does not hit the "no setTimeout after response" serverless hazard.
    if ((response.status === 429 || response.status === 529) && attempt < 2) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '', 10);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : (attempt + 1) * 2000;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    const errBody = await response.text();
    throw new Error(`Anthropic ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const blocks = [];
  const builders = {};
  let stopReason = null;
  let usage = null;
  let messageMeta = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop() || '';
    for (const ev of events) {
      let dataLine = null;
      for (const l of ev.split('\n')) if (l.startsWith('data: ')) dataLine = l.slice(6);
      if (!dataLine) continue;
      let data;
      try { data = JSON.parse(dataLine); } catch { continue; }

      if (data.type === 'message_start') {
        messageMeta = data.message;
      } else if (data.type === 'content_block_start') {
        const cb = data.content_block;
        builders[data.index] = { type: cb.type };
        if (cb.type === 'text') builders[data.index].text = '';
        if (cb.type === 'tool_use') {
          builders[data.index].id = cb.id;
          builders[data.index].name = cb.name;
          builders[data.index].input_json = '';
        }
      } else if (data.type === 'content_block_delta') {
        const b = builders[data.index];
        if (!b) continue;
        if (data.delta.type === 'text_delta') {
          b.text += data.delta.text;
          if (onDelta) onDelta('text', data.delta.text);
        } else if (data.delta.type === 'input_json_delta') {
          b.input_json += data.delta.partial_json;
        }
      } else if (data.type === 'content_block_stop') {
        const b = builders[data.index];
        if (!b) continue;
        if (b.type === 'text') {
          blocks[data.index] = { type: 'text', text: b.text };
        } else if (b.type === 'tool_use') {
          let input = {};
          try { input = b.input_json ? JSON.parse(b.input_json) : {}; } catch { input = {}; }
          blocks[data.index] = { type: 'tool_use', id: b.id, name: b.name, input };
        }
        delete builders[data.index];
      } else if (data.type === 'message_delta') {
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        if (data.usage) usage = data.usage;
      } else if (data.type === 'error') {
        throw new Error('Anthropic stream error: ' + JSON.stringify(data.error || data));
      }
    }
  }

  return { id: messageMeta?.id, role: 'assistant', content: blocks.filter(Boolean), stop_reason: stopReason, usage };
}
