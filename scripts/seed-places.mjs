// One-off: seed the evergreen Moncton/NB venues + day trips with sensory tags.
//   npm run seed:places   (needs SUPABASE_URL + SUPABASE_SERVICE_KEY in .env.local)
// Idempotent (matches on name). Cape Enrage is intentionally omitted: it is CLOSED for
// the entire 2026 season (verified), so listing it would send a family to a shuttered site.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  let raw = '';
  try { raw = readFileSync(join(root, '.env.local'), 'utf8'); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv();
const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local.'); process.exit(1); }

const PLACES = [
  { name: 'Resurgo Place', kind: 'venue', url: 'https://resurgo.ca/', indoor_outdoor: 'indoor', crowd_level: 'medium', noise_level: 'medium', easy_exit: true, sensory_friendly: true, age_fit: 'all', what_why: 'Indoor hands-on science + Moncton museum. Great for over-stimulated or rainy days; has had a Dinosaurs Among Us exhibit that dinosaur-loving kids enjoy.' },
  { name: 'Magnetic Hill Zoo', kind: 'venue', url: 'https://www.moncton.ca/things-do/magnetic-hill-zoo', indoor_outdoor: 'outdoor', crowd_level: 'medium', noise_level: 'medium', easy_exit: true, sensory_friendly: false, is_seasonal: true, season: 'spring-fall', age_fit: 'all', what_why: 'Open-air zoo with lots of walking room and quiet corners; easy to leave when needed.' },
  { name: 'Magic Mountain Water Park', kind: 'venue', url: 'https://magicmountain.ca/', indoor_outdoor: 'outdoor', crowd_level: 'high', noise_level: 'high', easy_exit: false, sensory_friendly: false, is_seasonal: true, season: 'summer', age_fit: 'splash pad for little ones / tall slides for older kids', what_why: 'Waterpark; a splash pad and gentle rides for younger kids, tall slides for older ones. Loud and busy on hot days.' },
  { name: 'Centennial Park', kind: 'venue', url: 'https://www.moncton.ca/things-do/parks-trails/centennial-park', indoor_outdoor: 'outdoor', crowd_level: 'low', noise_level: 'low', easy_exit: true, sensory_friendly: true, age_fit: 'all', what_why: 'Big park with trails, beach, playground and lots of space to spread out. Low-key, easy to leave.' },
  { name: 'Tidal Bore Park', kind: 'venue', url: 'https://www.moncton.ca/things-do/tidal-bore', indoor_outdoor: 'outdoor', crowd_level: 'low', noise_level: 'low', easy_exit: true, sensory_friendly: true, age_fit: 'all', what_why: 'Short, scheduled, free: watch the tidal bore roll in. Quick visit that fits a small tolerance window. Check bore times.' },
  { name: 'Moncton Public Library', kind: 'venue', url: 'https://www2.gnb.ca/content/gnb/en/departments/nbpls.html', indoor_outdoor: 'indoor', crowd_level: 'low', noise_level: 'low', easy_exit: true, sensory_friendly: true, age_fit: 'all', what_why: 'Free kids programs and a quiet space. Good low-demand outing; call ahead for program times.' },
  { name: 'Capitol Theatre', kind: 'venue', url: 'https://capitol.nb.ca/', indoor_outdoor: 'indoor', crowd_level: 'medium', noise_level: 'medium', easy_exit: false, sensory_friendly: false, age_fit: 'all', what_why: 'Family shows downtown. Sit near an aisle for an easy exit; check for relaxed/sensory-friendly performances.' },
  { name: 'Cineplex Trinity Drive (sensory screenings)', kind: 'venue', url: 'https://www.cineplex.com/theatre/cineplex-cinemas-trinity-commons', indoor_outdoor: 'indoor', crowd_level: 'low', noise_level: 'low', easy_exit: true, sensory_friendly: true, age_fit: 'all', what_why: 'Hosts Sensory Friendly screenings (lights up, sound down) roughly every few weeks on Saturday mornings. Call or check the theatre page for the next date.' },
  { name: 'Hopewell Rocks', kind: 'trip', url: 'https://www.thehopewellrocks.ca/', indoor_outdoor: 'outdoor', crowd_level: 'medium', noise_level: 'low', easy_exit: true, sensory_friendly: false, is_seasonal: true, season: 'late spring-fall', age_fit: 'all', what_why: 'Walk the ocean floor at low tide. Two-day ticket and a shuttle so a tired kid can ride back. Plan around the tide schedule.' },
  { name: 'Parlee Beach / Shediac', kind: 'trip', url: 'https://parcsnbparks.info/parlee-beach/', indoor_outdoor: 'outdoor', crowd_level: 'high', noise_level: 'medium', easy_exit: true, sensory_friendly: false, is_seasonal: true, season: 'summer', age_fit: 'all', what_why: 'Supervised warm beach; nearby Homarus centre has a baby-lobster touch tank (about 20 min). Busy in summer.' },
  { name: 'Kouchibouguac National Park', kind: 'trip', url: 'https://parks.canada.ca/pn-np/nb/kouchibouguac', indoor_outdoor: 'outdoor', crowd_level: 'low', noise_level: 'low', easy_exit: true, sensory_friendly: true, is_seasonal: true, season: 'late spring-fall', age_fit: 'all', what_why: "Kelly's Beach boardwalk (about 1 hr) over dunes to a calm beach. Quiet, spacious, accessible." },
  { name: 'Sackville Waterfowl Park', kind: 'trip', url: 'https://sackville.com/place/sackville-waterfowl-park/', indoor_outdoor: 'outdoor', crowd_level: 'low', noise_level: 'low', easy_exit: true, sensory_friendly: true, age_fit: 'all', what_why: 'Free, accessible boardwalks through a marsh full of birds. Calm and quiet, good for a sensory-light outing. (Tours are free.)' },
  { name: 'Fundy National Park', kind: 'trip', url: 'https://parks.canada.ca/pn-np/nb/fundy', indoor_outdoor: 'outdoor', crowd_level: 'low', noise_level: 'low', easy_exit: true, sensory_friendly: true, is_seasonal: true, season: 'late spring-fall', age_fit: 'all', what_why: 'Short, easy Dickson Falls trail plus beaches and big tides. Lots of quiet space.' },
];

const supabase = createClient(url, key);
for (const p of PLACES) {
  const { data: existing } = await supabase.from('nb_places').select('id').eq('name', p.name).maybeSingle();
  if (existing) {
    const { error } = await supabase.from('nb_places').update(p).eq('id', existing.id);
    if (error) { console.error(`Update ${p.name} failed: ${error.message}`); process.exit(1); }
    console.log(`Updated ${p.name}`);
  } else {
    const { error } = await supabase.from('nb_places').insert(p);
    if (error) { console.error(`Insert ${p.name} failed: ${error.message}`); process.exit(1); }
    console.log(`Inserted ${p.name}`);
  }
}
console.log(`Seeded ${PLACES.length} NB places.`);
