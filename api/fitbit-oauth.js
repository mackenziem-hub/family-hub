// Family Hub - Fitbit OAuth (PKCE). Mirrors api/google-oauth.js.
//   GET  /api/fitbit-oauth?action=start      (Bearer)  -> { url }
//   GET  /api/fitbit-oauth?action=callback&code&state  -> 302 back to the app
//   GET  /api/fitbit-oauth?action=status     (Bearer)  -> { configured, connected }
//   POST /api/fitbit-oauth?action=disconnect (Bearer)  -> { ok }
import { resolveSession } from '../lib/session.js';
import { createOAuthState, consumeOAuthState, makePkce } from '../lib/oauth-state.js';
import {
  fitbitConfigured, fitbitAuthUrl, exchangeFitbitCode, storeFitbitTokens,
  isFitbitConnected, disconnectFitbit,
} from '../lib/fitness.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const action = req.query.action;

  if (action === 'callback') {
    const { code, state, error } = req.query;
    if (error || !code || !state) return res.redirect(302, '/food.html?fitbit=error');
    try {
      const row = await consumeOAuthState(state, 'fitbit');
      if (!row || !row.code_verifier) { console.error('[fitbit-oauth callback] state not found or expired'); return res.redirect(302, '/food.html?fitbit=expired'); }
      const tok = await exchangeFitbitCode(code, row.code_verifier);
      await storeFitbitTokens(row.user_id, tok);
      return res.redirect(302, '/food.html?fitbit=connected');
    } catch (err) {
      console.error('[fitbit-oauth callback]', err.message);
      return res.redirect(302, '/food.html?fitbit=error');
    }
  }

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required' });

  if (action === 'start') {
    if (!fitbitConfigured()) return res.status(503).json({ error: 'fitbit_not_configured' });
    const { verifier, challenge } = makePkce();
    const state = await createOAuthState({ userId: session.user_id, provider: 'fitbit', codeVerifier: verifier });
    return res.json({ url: fitbitAuthUrl(state, challenge) });
  }

  if (action === 'status') {
    return res.json({ configured: fitbitConfigured(), connected: await isFitbitConnected(session.user_id) });
  }

  if (action === 'disconnect' && req.method === 'POST') {
    await disconnectFitbit(session.user_id);
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'unknown action' });
}
