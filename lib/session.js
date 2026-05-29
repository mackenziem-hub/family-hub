// Family Hub - session resolution + the requireSession middleware.
// Two users, one household: no tenant scoping. A resolved session is
// { user_id, name, email }. Wrap any handler that needs auth.
import { supabaseAdmin } from './supabase.js';

export async function resolveSession(req) {
  // Bearer header ONLY. Never accept the token via query string or body, so it
  // can't end up in request-URL access logs (a token-leak vector).
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data: session } = await supabaseAdmin
    .from('sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!session || new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, name, email')
    .eq('id', session.user_id)
    .maybeSingle();
  if (!user) return null;

  return { user_id: user.id, name: user.name, email: user.email };
}

// Middleware: 401 if no valid session, else attach req.session and continue.
export function requireSession(handler) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();
    const session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: 'sign_in_required' });
    req.session = session;
    return handler(req, res);
  };
}
