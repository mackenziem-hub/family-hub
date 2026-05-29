// Family Hub - Nutrition API (per-user meals + daily totals + target).
//   GET    /api/nutrition?date=YYYY-MM-DD     -> { date, entries, totals, target }
//   POST   /api/nutrition                     -> log a meal:
//            - { description, meal_slot? }                  -> AI estimate, then insert
//            - { calories, protein_g, carbs_g, fat_g, ... } -> insert a confirmed/manual entry
//   PATCH  /api/nutrition                      -> upsert daily targets
//   DELETE /api/nutrition?id=<uuid>
import { supabaseAdmin } from '../lib/supabase.js';
import { requireSession } from '../lib/session.js';
import { readJson } from '../lib/http.js';
import { todayLocalISODate } from '../lib/dates.js';
import { estimateMeal } from '../lib/nutrition.js';
import { anthropicConfigured } from '../lib/claude.js';

const ENTRY_COLS = 'id, logged_for_date, description, calories, protein_g, carbs_g, fat_g, source, confidence, meal_slot, calorie_low, calorie_high, assumptions, items, photo_path, corrected, created_at';

function sumTotals(entries) {
  return entries.reduce((a, e) => ({
    calories: a.calories + (e.calories || 0),
    protein_g: Math.round((a.protein_g + Number(e.protein_g || 0)) * 10) / 10,
    carbs_g: Math.round((a.carbs_g + Number(e.carbs_g || 0)) * 10) / 10,
    fat_g: Math.round((a.fat_g + Number(e.fat_g || 0)) * 10) / 10,
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
}

async function handler(req, res) {
  const userId = req.session.user_id;

  if (req.method === 'GET') {
    const date = (req.query.date || todayLocalISODate()).slice(0, 10);
    const [{ data: entries }, { data: target }] = await Promise.all([
      supabaseAdmin.from('nutrition_log').select(ENTRY_COLS).eq('user_id', userId).eq('logged_for_date', date).order('created_at'),
      supabaseAdmin.from('nutrition_targets').select('*').eq('user_id', userId).maybeSingle(),
    ]);
    const list = entries || [];
    return res.json({ date, entries: list, totals: sumTotals(list), target: target || null });
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    const date = (body.logged_for_date || todayLocalISODate()).slice(0, 10);

    let row;
    if (typeof body.calories === 'number') {
      // Confirmed draft (from the photo flow) or a manual entry: trust the values.
      row = {
        user_id: userId,
        logged_for_date: date,
        description: (body.description || '(meal)').toString().slice(0, 500),
        calories: Math.round(body.calories),
        protein_g: body.protein_g ?? null,
        carbs_g: body.carbs_g ?? null,
        fat_g: body.fat_g ?? null,
        source: ['photo', 'ai_estimate', 'manual'].includes(body.source) ? body.source : 'manual',
        confidence: ['low', 'med', 'high'].includes(body.confidence) ? body.confidence : null,
        meal_slot: body.meal_slot || null,
        calorie_low: body.calorie_low ?? null,
        calorie_high: body.calorie_high ?? null,
        assumptions: body.assumptions || null,
        items: Array.isArray(body.items) ? body.items : [],
        photo_path: body.photo_path || null,
        corrected: !!body.corrected,
      };
    } else if (body.description) {
      if (!anthropicConfigured()) return res.status(503).json({ error: 'estimator_not_configured' });
      let draft;
      try {
        draft = await estimateMeal({ description: String(body.description), mealSlot: body.meal_slot });
      } catch (err) {
        console.error('[nutrition estimate]', err.message);
        return res.status(502).json({ error: 'Could not estimate that meal. Try again or enter values manually.' });
      }
      row = {
        user_id: userId,
        logged_for_date: date,
        description: String(body.description).slice(0, 500),
        calories: draft.calories,
        protein_g: draft.protein_g,
        carbs_g: draft.carbs_g,
        fat_g: draft.fat_g,
        source: 'ai_estimate',
        confidence: draft.confidence,
        meal_slot: body.meal_slot || null,
        calorie_low: draft.calorie_low,
        calorie_high: draft.calorie_high,
        assumptions: draft.assumptions,
        items: draft.items,
      };
    } else {
      return res.status(400).json({ error: 'Provide a description to estimate, or explicit calories.' });
    }

    const { data, error } = await supabaseAdmin.from('nutrition_log').insert(row).select(ENTRY_COLS).single();
    if (error) { console.error('[nutrition POST]', error.message); return res.status(500).json({ error: 'Could not save the meal.' }); }
    return res.json({ entry: data });
  }

  if (req.method === 'PATCH') {
    const body = await readJson(req);
    const patch = { user_id: userId, updated_at: new Date().toISOString() };
    for (const k of ['calorie_target', 'protein_target_g', 'carb_target_g', 'fat_target_g']) {
      if (body[k] != null) patch[k] = Math.round(Number(body[k])) || null;
    }
    const { data, error } = await supabaseAdmin.from('nutrition_targets').upsert(patch, { onConflict: 'user_id' }).select('*').single();
    if (error) { console.error('[nutrition target]', error.message); return res.status(500).json({ error: 'Could not save targets.' }); }
    return res.json({ target: data });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error, count } = await supabaseAdmin.from('nutrition_log').delete({ count: 'exact' }).eq('id', id).eq('user_id', userId);
    if (error) { console.error('[nutrition DELETE]', error.message); return res.status(500).json({ error: 'Could not delete.' }); }
    if (!count) return res.status(404).json({ error: 'Entry not found.' });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireSession(handler);
