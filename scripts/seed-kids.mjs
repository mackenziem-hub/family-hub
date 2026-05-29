// One-off: insert/update the kids with their affirming, interest-led, sensory-aware
// profile notes the assistant uses as context. Idempotent (matches on name).
// Real profiles live ONLY in family.local.json (gitignored), never in this file.
//
//   1. Fill the "kids" array in family.local.json (name, birthdate, notes).
//   2. Set SUPABASE_URL + SUPABASE_SERVICE_KEY in .env.local.
//   3. npm run seed:kids
import { createClient } from '@supabase/supabase-js';
import { loadEnv, loadFamilyConfig, requireSupabase } from './_family-config.mjs';

loadEnv();
const { url, key } = requireSupabase();
const cfg = loadFamilyConfig();
const kids = Array.isArray(cfg.kids) ? cfg.kids : [];
if (!kids.length) { console.error('No kids in family.local.json.'); process.exit(1); }

const supabase = createClient(url, key);

for (const kid of kids) {
  if (!kid.name) { console.error('Each kid needs a name in family.local.json.'); process.exit(1); }
  const row = { name: kid.name, birthdate: kid.birthdate || null, notes: kid.notes || null };
  const { data: existing } = await supabase.from('kids').select('id').eq('name', kid.name).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('kids').update(row).eq('id', existing.id);
    if (error) { console.error(`Update ${kid.name} failed: ${error.message}`); process.exit(1); }
    console.log(`Updated ${kid.name}`);
  } else {
    const { error } = await supabase.from('kids').insert(row);
    if (error) { console.error(`Insert ${kid.name} failed: ${error.message}`); process.exit(1); }
    console.log(`Inserted ${kid.name}`);
  }
}
console.log('Kids seeded.');
