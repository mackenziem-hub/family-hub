// Family Hub - OAuth state store (shared by Google + Fitbit).
// The OAuth "start" endpoint is called via fetch (Bearer auth), so we know the user
// there. The provider redirects back to "callback" as a top-level navigation with NO
// Authorization header, so we cannot identify the user from the request. We bridge that
// by storing a random `state` -> user_id row at start and looking it up on callback.
import crypto from 'node:crypto';
import { supabaseAdmin } from './supabase.js';

const STATE_TTL_MS = 10 * 60 * 1000;

export async function createOAuthState({ userId, provider, codeVerifier = null }) {
  // Opportunistic sweep of abandoned states (no completed callback) so the table
  // does not grow unbounded; there is no separate cleanup cron.
  await supabaseAdmin.from('oauth_state').delete().lt('created_at', new Date(Date.now() - STATE_TTL_MS).toISOString());
  const state = crypto.randomBytes(24).toString('hex');
  const { error } = await supabaseAdmin.from('oauth_state')
    .insert({ state, user_id: userId, provider, code_verifier: codeVerifier });
  if (error) throw new Error('oauth_state insert failed: ' + error.message);
  return state;
}

// One-time use. The delete + return is ONE atomic statement (delete ... returning),
// so two concurrent callbacks with the same state can never both succeed (no replay race).
// Validate provider + freshness after; a tampered provider still consumes the row, but the
// state value is a 24-byte secret, so that is not a practical DoS vector.
export async function consumeOAuthState(state, provider) {
  if (!state) return null;
  const { data } = await supabaseAdmin.from('oauth_state').delete().eq('state', state).select('*').maybeSingle();
  if (!data) return null;
  if (data.provider !== provider) return null;
  if (Date.now() - new Date(data.created_at).getTime() > STATE_TTL_MS) return null;
  return data; // { user_id, provider, code_verifier }
}

// PKCE helpers (Fitbit).
export function makePkce() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
