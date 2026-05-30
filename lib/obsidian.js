// Family Hub - Obsidian vault mirror. The vault is a private GitHub repo; we read/write
// markdown via the GitHub Contents API (Vercel's filesystem is read-only and Obsidian's
// Local REST API isn't reachable from serverless, so GitHub-repo-as-vault is the clean
// fit). Raw fetch to match house style (no octokit). Mac clones the repo locally and
// opens it as an Obsidian vault with the Obsidian Git plugin for two-way sync.
const API = 'https://api.github.com';
const owner = () => (process.env.GITHUB_VAULT_OWNER || '').trim();
const repo = () => (process.env.GITHUB_VAULT_REPO || '').trim();
const token = () => (process.env.GITHUB_TOKEN || '').trim();

export function obsidianConfigured() { return Boolean(owner() && repo() && token()); }

function gh(path, opts = {}) {
  return fetch(`${API}/repos/${owner()}/${repo()}/contents/${path}`, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + token(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'family-hub',
      ...(opts.headers || {}),
    },
  });
}

// Confine writes to notes/, force .md, strip traversal, sanitize. Returns a safe repo path.
export function safeNotePath(p) {
  let s = String(p || '').trim().replace(/^\/+/, '').replace(/\.\.+/g, '.');
  if (!s) s = 'note';
  s = s.replace(/[^A-Za-z0-9_\-./ ]/g, '').replace(/\s+/g, '-');
  if (!/\.md$/i.test(s)) s += '.md';
  if (!s.startsWith('notes/')) s = 'notes/' + s;
  return s;
}

export async function readNote(path) {
  if (!obsidianConfigured()) return { ok: false, error: 'vault_not_configured' };
  const p = safeNotePath(path);
  const r = await gh(encodeURI(p));
  if (r.status === 404) return { ok: true, found: false, path: p };
  if (!r.ok) return { ok: false, error: 'read failed ' + r.status };
  const j = await r.json();
  return { ok: true, found: true, path: p, content: Buffer.from(j.content || '', 'base64').toString('utf8'), sha: j.sha };
}

export async function writeNote(path, body, frontmatter) {
  if (!obsidianConfigured()) return { ok: false, error: 'vault_not_configured' };
  const p = safeNotePath(path);
  let content = '';
  if (frontmatter && typeof frontmatter === 'object' && Object.keys(frontmatter).length) {
    content += '---\n' + Object.entries(frontmatter).map(([k, v]) => `${k}: ${String(v).replace(/\r?\n/g, ' ')}`).join('\n') + '\n---\n\n';
  }
  content += String(body || '');
  const encoded = Buffer.from(content, 'utf8').toString('base64');

  // Need the current blob sha to update an existing file; refetch once on 409
  // (concurrent change) and retry synchronously - never setTimeout in serverless.
  let sha;
  const ex = await gh(encodeURI(p));
  if (ex.ok) { try { sha = (await ex.json()).sha; } catch { /* new file */ } }
  const put = (s) => gh(encodeURI(p), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Update ${p} via Family Hub`, content: encoded, ...(s ? { sha: s } : {}) }),
  });
  let r = await put(sha);
  if (r.status === 409) {
    const cur = await gh(encodeURI(p));
    const s2 = cur.ok ? (await cur.json()).sha : undefined;
    r = await put(s2);
  }
  if (!r.ok) return { ok: false, error: 'write failed ' + r.status };
  return { ok: true, path: p };
}
