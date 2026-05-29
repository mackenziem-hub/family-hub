// Family Hub - client-side session gate + auth-headers helper.
// Include once per app page, before any data-fetching script:
//   <script src="/assets/auth-guard.js"></script>
//
// If no token, redirects to /login.html?next=<current-url> synchronously.
// If a token is present, exposes window.FamilyAuth.
//
// This is a UX guard, not a security boundary: every /api/* route enforces
// the session server-side, so a user who skips this still gets 401s.
(function () {
  const TOKEN_KEY = 'family_token';
  const USER_KEY = 'family_user';
  const LOGIN_URL = '/login.html';

  function readToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
  }

  function redirectToLogin() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${LOGIN_URL}?next=${next}`;
  }

  function clearAndRedirect() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch { /* ignore */ }
    redirectToLogin();
  }

  function currentUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  }

  const token = readToken();
  if (!token) { redirectToLogin(); return; }

  window.FamilyAuth = Object.freeze({
    token,
    user: currentUser(),
    headers() { return { Authorization: `Bearer ${token}` }; },
    clearAndRedirect,
    redirectToLogin,
  });
})();
