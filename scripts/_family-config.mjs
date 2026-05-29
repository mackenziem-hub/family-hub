// Shared loader for local seed data. Reads family.local.json (gitignored), which
// holds real names/emails/passwords/kid profiles. Never commit that file; the repo
// ships family.example.json as a template only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env.local loader (avoids a dotenv dependency).
export function loadEnv() {
  let raw = '';
  try { raw = readFileSync(join(root, '.env.local'), 'utf8'); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

// Load and validate family.local.json. Exits with a clear message if missing.
export function loadFamilyConfig() {
  let raw;
  try {
    raw = readFileSync(join(root, 'family.local.json'), 'utf8');
  } catch {
    console.error('family.local.json not found. Copy family.example.json to family.local.json and fill in real values.');
    process.exit(1);
  }
  try { return JSON.parse(raw); } catch (e) {
    console.error('family.local.json is not valid JSON: ' + e.message);
    process.exit(1);
  }
}

export function requireSupabase() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local first.');
    process.exit(1);
  }
  return { url, key };
}
