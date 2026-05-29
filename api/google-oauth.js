// Family Hub - Google Calendar OAuth endpoints.
//   GET  /api/google-oauth?action=start      (Bearer)  -> { url }   (client then navigates there)
//   GET  /api/google-oauth?action=callback&code&state  -> 302 redirect back to the app
//   GET  /api/google-oauth?action=status     (Bearer)  -> { configured, connected, email }
//   POST /api/google-oauth?action=disconnect (Bearer)  -> { ok }
// The callback is a top-level browser redirect (no Authorization header); we identify
// the user via the one-time `state` row created at start.
import { resolveSession } from '../lib/session.js';
import { createOAuthState, consumeOAuthState, makePkce } from '../lib/oauth-state.js';
import {
  googleConfigured, googleAuthUrl, exchangeGoogleCode, storeGoogleTokens,
  isGoogleConnected, disconnectGoogle,
} from '../lib/google.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;

  // ── CALLBACK (public; identified by state) ──
  if (action === 'callback') {
    const { code, state, error } = req.query;
    if (error || !code || !state) return res.redirect(302, '/calendar.html?google=error');
    try {
      const row = await consumeOAuthState(state, 'google');
      if (!row) { console.error('[google-oauth callback] state not found or expired'); return res.redirect(302, '/calendar.html?google=expired'); }
      const tok = await exchangeGoogleCode(code, row.code_verifier);
      await storeGoogleTokens(row.user_id, tok);
      return res.redirect(302, '/calendar.html?google=connected');
    } catch (err) {
      console.error('[google-oauth callback]', err.message);
      return res.redirect(302, '/calendar.html?google=error');
    }
  }

  // ── Everything else requires a session ──
  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required' });

  if (action === 'start') {
    if (!googleConfigured()) return res.status(503).json({ error: 'google_not_configured' });
    const { verifier, challenge } = makePkce();
    const state = await createOAuthState({ userId: session.user_id, provider: 'google', codeVerifier: verifier });
    return res.json({ url: googleAuthUrl(state, challenge) });
  }

  if (action === 'status') {
    const conn = await isGoogleConnected(session.user_id);
    return res.json({ configured: googleConfigured(), connected: Boolean(conn), email: conn?.google_email || null });
  }

  if (action === 'disconnect' && req.method === 'POST') {
    await disconnectGoogle(session.user_id);
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown action' });
}
