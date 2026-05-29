// One-off: insert (or update) the household users with scrypt-hashed passwords.
//
//   1. Copy family.example.json to family.local.json and fill in users (name, email, password).
//   2. Set SUPABASE_URL + SUPABASE_SERVICE_KEY in .env.local.
//   3. npm run seed
//
// Re-running is safe: it upserts on email (updates the password hash).
// Real data lives ONLY in family.local.json (gitignored), never in this file.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, loadFamilyConfig, requireSupabase } from './_family-config.mjs';

loadEnv();
const { url, key } = requireSupabase();
const cfg = loadFamilyConfig();
const users = Array.isArray(cfg.users) ? cfg.users : [];
if (!users.length) { console.error('No users in family.local.json.'); process.exit(1); }

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const supabase = createClient(url, key);

for (const u of users) {
  if (!u.name || !u.email || !u.password) {
    console.error(`Each user needs name, email, and password in family.local.json (problem near "${u.name || u.email || 'unknown'}").`);
    process.exit(1);
  }
  const password_hash = hashPassword(u.password);
  const { error } = await supabase
    .from('users')
    .upsert({ name: u.name, email: String(u.email).toLowerCase().trim(), password_hash }, { onConflict: 'email' });
  if (error) { console.error(`Failed to seed ${u.email}: ${error.message}`); process.exit(1); }
  console.log(`Seeded ${u.name} <${u.email}>`);
}

console.log('Done.');
