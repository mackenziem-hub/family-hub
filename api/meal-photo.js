// Family Hub - photo calorie estimate (Claude vision).
//   POST /api/meal-photo  { image (base64, no data: prefix), media_type?, caption?, meal_slot?, reference? }
//   -> { draft }   (an editable DRAFT; NOT yet saved; draft.photo_path holds the stored key)
// The client shows the draft, lets the user edit, then POSTs it to /api/nutrition
// with source='photo'. Photos are stored privately unless STORE_MEAL_PHOTOS=false.
import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';
import { todayLocalISODate } from '../lib/dates.js';
import { estimateMeal } from '../lib/nutrition.js';
import { anthropicConfigured } from '../lib/claude.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BASE64_CHARS = 5_500_000; // ~4MB binary, under Vercel's 4.5MB body cap

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!anthropicConfigured()) return res.status(503).json({ error: 'estimator_not_configured' });

  const body = await readJson(req);
  const image = typeof body.image === 'string' ? body.image.replace(/^data:[^,]+,/, '') : '';
  if (!image) return res.status(400).json({ error: 'image (base64) required' });
  if (image.length > MAX_BASE64_CHARS) return res.status(413).json({ error: 'Image too large; please retake (the app downsizes automatically).' });
  // Validate base64 before Buffer.from (which silently truncates on invalid chars).
  if (image.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image)) {
    return res.status(400).json({ error: 'Invalid image data; please retake the photo.' });
  }
  const mediaType = ALLOWED_TYPES.includes(body.media_type) ? body.media_type : 'image/jpeg';

  let draft;
  try {
    draft = await estimateMeal({
      description: body.caption ? String(body.caption) : undefined,
      mealSlot: body.meal_slot,
      referenceObject: body.reference,
      imageBase64: image,
      imageMediaType: mediaType,
    });
  } catch (err) {
    console.error('[meal-photo estimate]', err.message);
    return res.status(502).json({ error: 'Could not read that photo. Try again or type the meal instead.' });
  }

  // Best-effort private storage. Never block logging on it.
  let photo_path = null;
  if ((process.env.STORE_MEAL_PHOTOS || 'true').trim() !== 'false') {
    try {
      const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg';
      const path = `${req.session.user_id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabaseAdmin.storage
        .from('meal-photos')
        .upload(path, Buffer.from(image, 'base64'), { contentType: mediaType, upsert: false });
      if (error) console.error('[meal-photo storage]', error.message); // bucket may not exist yet
      else photo_path = path;
    } catch (err) {
      console.error('[meal-photo storage]', err.message);
    }
  }

  return res.json({
    draft: { ...draft, meal_slot: body.meal_slot || null, logged_for_date: todayLocalISODate(), source: 'photo', photo_path },
  });
}

export default requireSession(handler);
