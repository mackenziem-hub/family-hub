// Family Hub - persistent assistant memory. Durable facts/events/insights the
// assistant accumulates, injected into context each turn and written via tools.
// user_id NULL = shared household memory; a user_id = private to that person.
import { supabaseAdmin } from './supabase.js';

// Memories to inject into context: all pinned + most recent, for this user PLUS
// shared household memories. Pinned first, then most-recent.
export async function recallMemories(userId, limit = 30) {
  const { data } = await supabaseAdmin
    .from('assistant_memory')
    .select('category, content, pinned, user_id, updated_at')
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// Keyword search across this user's + household memories (for the recall tool).
export async function searchMemories(userId, query, limit = 15) {
  const q = String(query || '').trim();
  let req = supabaseAdmin.from('assistant_memory')
    .select('category, content, updated_at')
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (q) req = req.ilike('content', `%${q}%`);
  const { data } = await req;
  return data || [];
}

// Save a durable memory, de-duplicated. scope 'household' (shared) or 'me' (private).
export async function rememberFact(userId, { content, category, scope, pinned, dedup_key, source } = {}) {
  content = String(content || '').trim();
  if (!content) return { ok: false, error: 'empty' };
  const owner = scope === 'household' ? null : userId;
  const ownerFilter = (q) => (owner === null ? q.is('user_id', null) : q.eq('user_id', owner));

  if (dedup_key) {
    const { data: ex } = await ownerFilter(supabaseAdmin.from('assistant_memory').select('id').eq('dedup_key', dedup_key)).limit(1);
    if (ex && ex.length) {
      await supabaseAdmin.from('assistant_memory')
        .update({ content: content.slice(0, 2000), category: category || 'fact', pinned: !!pinned, updated_at: new Date().toISOString() })
        .eq('id', ex[0].id);
      return { ok: true, updated: true };
    }
  }
  // Skip near-exact duplicates (case-insensitive) for the same owner.
  const { data: dup } = await ownerFilter(supabaseAdmin.from('assistant_memory').select('id').ilike('content', content.slice(0, 160))).limit(1);
  if (dup && dup.length) return { ok: true, deduped: true };

  const { error } = await supabaseAdmin.from('assistant_memory').insert({
    user_id: owner,
    content: content.slice(0, 2000),
    category: category || 'fact',
    source: source || 'assistant',
    pinned: !!pinned,
    dedup_key: dedup_key || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, saved: true };
}
