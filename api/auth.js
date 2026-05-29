// Family Hub - Auth API
//   POST /api/auth?action=login    { email, password }      -> { token, user, expiresAt }
//   POST /api/auth?action=logout                            -> { ok: true }   (Bearer token)
//   GET  /api/auth?action=me                                -> { user }       (Bearer token)
//
// Two seeded users, no registration, no tenant. Seed via scripts/seed-users.mjs.
import { supabaseAdmin } from '../lib/supabase.js';
import { verifyPassword, generateToken, SESSION_TTL_MS, DUMMY_PASSWORD_HASH } from '../lib/auth.js';
import { resolveSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;

  // ── LOGIN ──
  if (action === 'login' && req.method === 'POST') {
    const { email, password } = await readJson(req);
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, name, email, password_hash')
      .eq('email', String(email).toLowerCase().trim())
      .maybeSingle();

    // Always run scrypt (against a dummy hash when the user is missing) so the
    // response time is the same whether the email exists or not. Same error too.
    const passwordOk = verifyPassword(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken();
    const expires = new Date(Date.now() + SESSION_TTL_MS);
    const { error } = await supabaseAdmin.from('sessions').insert({
      token, user_id: user.id, expires_at: expires.toISOString(),
    });
    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
      expiresAt: expires.toISOString(),
    });
  }

  // ── LOGOUT ──
  if (action === 'logout' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (token) await supabaseAdmin.from('sessions').delete().eq('token', token);
    return res.json({ ok: true });
  }

  // ── ME ──
  if (action === 'me') {
    const session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: 'sign_in_required' });
    return res.json({
      user: { id: session.user_id, name: session.name, email: session.email },
    });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
