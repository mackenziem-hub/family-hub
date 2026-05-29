// Family Hub - meal nutrition estimator (Claude vision/text, forced tool output).
// Used by api/nutrition.js (text), api/meal-photo.js (photo), and the assistant's
// log_meal tool. Returns an editable DRAFT with a calorie RANGE + confidence.
import { callClaudeStream } from './claude.js';

export const LOG_MEAL_TOOL = {
  name: 'log_meal',
  description: 'Return a structured nutrition estimate for a described or photographed meal.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Every distinct food and drink item, including cooking oils/fats.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            brand_or_cuisine: { type: 'string' },
            estimated_portion_grams: { type: 'number' },
            portion_basis: { type: 'string', enum: ['reference_object', 'standard_serving', 'visual_only'] },
            assumed_cooking_fat_grams: { type: 'number' },
            calories: { type: 'number' },
            protein_g: { type: 'number' },
            carbs_g: { type: 'number' },
            fat_g: { type: 'number' },
            item_confidence: { type: 'number', description: '0 to 1' },
          },
          required: ['name', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
        },
      },
      total_calories: { type: 'number' },
      total_protein_g: { type: 'number' },
      total_carbs_g: { type: 'number' },
      total_fat_g: { type: 'number' },
      calorie_low: { type: 'number', description: 'Low end of a plausible range.' },
      calorie_high: { type: 'number', description: 'High end of a plausible range.' },
      overall_confidence: { type: 'number', description: '0 to 1' },
      assumptions: { type: 'array', items: { type: 'string' } },
      clarifying_questions: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short questions that would most improve accuracy.' },
      needs_user_input: { type: 'boolean' },
    },
    required: ['items', 'total_calories', 'total_protein_g', 'total_carbs_g', 'total_fat_g', 'overall_confidence'],
  },
};

export const MEAL_SYSTEM_PROMPT = `You are a registered dietitian estimating the nutrition of a meal from a description and/or photo, using USDA FoodData Central conventions. Work in this order: (1) enumerate every distinct food and drink item; (2) assume and itemize realistic cooking oils and fats in assumed_cooking_fat_grams, since hidden cooking fat is the most common blind spot; (3) estimate each portion using any reference object in the frame, or failing that standard North American servings; (4) do NOT round down: people and apps systematically under-estimate, so bias slightly UP for large, stacked, or partly hidden servings. Provide a calorie_low and calorie_high plausible range, per-item and overall confidence from 0 to 1, your assumptions, and up to 3 short clarifying_questions whose answers would most improve accuracy. Always call the log_meal tool. This is an informational estimate, not medical or clinical advice.`;

function round1(n) { return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null; }
function confidenceBand(c) { return c >= 0.66 ? 'high' : c >= 0.4 ? 'med' : 'low'; }

// estimateMeal({ description?, mealSlot?, referenceObject?, imageBase64?, imageMediaType? })
// Returns a normalized draft (calories already calibrated upward).
export async function estimateMeal({ description, mealSlot, referenceObject, imageBase64, imageMediaType }) {
  const calRaw = parseFloat(process.env.MEAL_CALORIE_CALIBRATION || '1.1');
  const calibration = Number.isFinite(calRaw) && calRaw > 0 ? calRaw : 1.1; // guard bad env

  const ctx = [];
  if (mealSlot) ctx.push(`Meal: ${mealSlot}.`);
  if (referenceObject) ctx.push(`Reference object in frame: ${referenceObject}.`);
  if (description) ctx.push(`What was eaten: ${description}`);
  else if (imageBase64) ctx.push('No caption was given; estimate from the photo.');
  else ctx.push('Estimate this meal.');

  const textBlock = { type: 'text', text: ctx.join('\n') };
  const content = imageBase64
    ? [{ type: 'image', source: { type: 'base64', media_type: imageMediaType || 'image/jpeg', data: imageBase64 } }, textBlock]
    : [textBlock];

  const resp = await callClaudeStream({
    system: [{ type: 'text', text: MEAL_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    tools: [LOG_MEAL_TOOL],
    tool_choice: { type: 'tool', name: 'log_meal' },
    max_tokens: 2000, // large multi-item meals need headroom; too low truncates the tool JSON
  });

  const toolUse = resp.content.find((b) => b.type === 'tool_use');
  const raw = (toolUse && toolUse.input) || {};
  // No tool block, or the JSON was truncated (required fields missing): return a safe,
  // low-confidence draft flagged for the user instead of throwing or logging zeros silently.
  if (!toolUse || !Array.isArray(raw.items) || typeof raw.total_calories !== 'number') {
    console.error('[estimateMeal] incomplete estimate from model');
    return {
      calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, calorie_low: 0, calorie_high: 0,
      confidence: 'low',
      assumptions: 'Could not fully estimate this meal; please enter or adjust the numbers.',
      clarifying_questions: [], needs_user_input: true, items: [],
    };
  }

  const calUp = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * calibration) : null);
  const calories = calUp(raw.total_calories) || 0;

  const items = (raw.items || []).map((it) => ({
    name: it.name || 'item',
    calories: calUp(it.calories),
    protein_g: round1(it.protein_g),
    carbs_g: round1(it.carbs_g),
    fat_g: round1(it.fat_g),
    portion_grams: typeof it.estimated_portion_grams === 'number' ? Math.round(it.estimated_portion_grams) : null,
    item_confidence: typeof it.item_confidence === 'number' ? it.item_confidence : null,
  }));

  const draft = {
    calories,
    protein_g: round1(raw.total_protein_g) || 0,
    carbs_g: round1(raw.total_carbs_g) || 0,
    fat_g: round1(raw.total_fat_g) || 0,
    calorie_low: calUp(raw.calorie_low) ?? Math.round(calories * 0.85),
    calorie_high: calUp(raw.calorie_high) ?? Math.round(calories * 1.2),
    confidence: confidenceBand(typeof raw.overall_confidence === 'number' ? raw.overall_confidence : 0.5),
    assumptions: (raw.assumptions || []).join(' '),
    clarifying_questions: (raw.clarifying_questions || []).slice(0, 3),
    needs_user_input: !!raw.needs_user_input,
    items,
  };

  // Macros should roughly reconcile with calories (4/4/9). Flag, do not silently fix.
  const macroKcal = 4 * draft.protein_g + 4 * draft.carbs_g + 9 * draft.fat_g;
  if (draft.calories && macroKcal && Math.abs(macroKcal - draft.calories) / draft.calories > 0.2) {
    draft.needs_user_input = true;
    draft.assumptions = `${draft.assumptions} (Calories and macros do not fully reconcile, so treat this as rough.)`.trim();
  }

  return draft;
}
