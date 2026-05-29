// Family Hub - thin fetch wrapper. Injects auth headers, parses JSON,
// and bounces to login on 401. Load after auth-guard.js.
//   const items = await api.get('/api/groceries');
//   await api.post('/api/groceries', { name: 'milk' });
window.api = (function () {
  async function request(method, path, body) {
    const opts = {
      method,
      headers: { ...(window.FamilyAuth ? window.FamilyAuth.headers() : {}) },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (res.status === 401) {
      if (window.FamilyAuth) window.FamilyAuth.clearAndRedirect();
      throw new Error('unauthorized');
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch { data = { error: 'Unexpected server response' }; }
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b ?? {}),
    patch: (p, b) => request('PATCH', p, b ?? {}),
    del: (p) => request('DELETE', p),
  };
})();
