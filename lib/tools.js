// Family Hub - assistant tool definitions + executor.
// Phase 2 tools: groceries (add / check / list) + read the calendar.
// executeTool() shares the same Supabase logic the REST handlers use; ctx = { userId }.
import { supabaseAdmin } from './supabase.js';
import { getUpcomingEvents } from './calendarRead.js';
import { insertGoogleEvent, isGoogleConnected } from './google.js';
import { estimateMeal } from './nutrition.js';
import { readDailySummary, isFitbitConnected } from './fitness.js';
import { todayLocalISODate } from './dates.js';
import { anthropicConfigured } from './claude.js';

const TOOL_DEFS = [
  {
    name: 'add_grocery_item',
    description: 'Add an item to the shared family grocery list. Use when the user asks to add, buy, or pick up something.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The item, e.g. "Milk" or "Bananas".' },
        quantity: { type: 'string', description: 'Optional amount, e.g. "1 dozen" or "2".' },
        category: { type: 'string', description: 'Optional aisle/category, e.g. "Produce", "Dairy".' },
      },
      required: ['name'],
    },
  },
  {
    name: 'check_off_grocery',
    description: 'Mark a grocery item as bought/done by name. Use when the user says they got or bought something.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name (or part of it) of the item to check off.' } },
      required: ['name'],
    },
  },
  {
    name: 'list_groceries',
    description: 'List the current grocery items. Defaults to items still to buy.',
    input_schema: {
      type: 'object',
      properties: { include_checked: { type: 'boolean', description: 'Include already-bought items.' } },
    },
  },
  {
    name: 'get_calendar',
    description: "Read upcoming events from the family calendar. Use to answer what's coming up or to check availability.",
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'How many days ahead to look (default 7).' } },
    },
  },
  {
    name: 'add_calendar_event',
    description: 'Add an event to the family calendar. Only works once Google Calendar is connected (on the Calendar tab).',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title.' },
        start: { type: 'string', description: 'ISO 8601 start, e.g. 2026-06-01T14:00:00 (or 2026-06-01 for all-day).' },
        end: { type: 'string', description: 'ISO 8601 end (optional).' },
        location: { type: 'string' },
        description: { type: 'string' },
        all_day: { type: 'boolean' },
      },
      required: ['summary', 'start'],
    },
  },
  {
    name: 'find_local_events',
    description: 'Find family-friendly things to do in/around Moncton, NB: curated venues + day trips (with sensory tags) plus pointers to current event listings. Use for "what can we do", trip ideas, or sensory-friendly outings.',
    input_schema: {
      type: 'object',
      properties: {
        sensory_friendly: { type: 'boolean', description: 'Only sensory-friendly options.' },
        kind: { type: 'string', enum: ['venue', 'trip'] },
      },
    },
  },
  {
    name: 'log_meal',
    description: 'Estimate and log a meal the current user describes (calories + macros). Use when they say they ate something.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What they ate, e.g. "chicken caesar wrap and a latte".' },
        meal_slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
      },
      required: ['description'],
    },
  },
  {
    name: 'get_nutrition_today',
    description: "Get the current user's calories and macros logged today versus their target.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_nutrition_target',
    description: 'Set or update the current user daily nutrition target.',
    input_schema: {
      type: 'object',
      properties: {
        calorie_target: { type: 'number' },
        protein_target_g: { type: 'number' },
        carb_target_g: { type: 'number' },
        fat_target_g: { type: 'number' },
      },
    },
  },
  {
    name: 'get_fitness_today',
    description: "Get the current user's Fitbit activity today (steps, calories burned, active minutes). Frame gently and positively, never as a deficit or a target missed.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'save_kid_item',
    description: 'Save an activity idea or conversation topic for a kid to the family library, so it can be reused.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['activity', 'topic', 'play_idea'] },
        title: { type: 'string', description: 'Short title.' },
        detail: { type: 'string', description: 'The full idea/steps or the topic prompt.' },
        kid_name: { type: 'string', description: "Which kid this is for (use a name from the household context), if specific." },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['kind', 'title'],
    },
  },
  {
    name: 'list_saved_items',
    description: 'List saved activity ideas and conversation topics from the family library.',
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['activity', 'topic', 'play_idea'] } },
    },
  },
  {
    name: 'log_play_moment',
    description: 'Record that the family did a little active/play moment together (a celebration log). Use when they say they did one. Never required, never a streak.',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string' }, kid_name: { type: 'string' } },
    },
  },
];

// Returns the tool array with cache_control on the last tool, which caches the
// whole tools block as a unit (Anthropic prompt caching).
export function getTools() {
  if (!TOOL_DEFS.length) return TOOL_DEFS;
  const tools = TOOL_DEFS.map((t) => ({ ...t }));
  tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } };
  return tools;
}

export async function executeTool(name, input, ctx) {
  const userId = ctx?.userId || null;
  try {
    if (name === 'add_grocery_item') {
      if (!input?.name) return { error: 'name is required' };
      const { data, error } = await supabaseAdmin
        .from('grocery_items')
        .insert({
          name: String(input.name).trim(),
          quantity: input.quantity ? String(input.quantity).trim() : null,
          category: input.category ? String(input.category).trim() : null,
          added_by: userId,
        })
        .select('id, name, quantity')
        .single();
      if (error) { console.error(`[tool ${name}]`, error.message); return { error: 'That did not work, please try again.' }; }
      return { ok: true, added: data };
    }

    if (name === 'check_off_grocery') {
      if (!input?.name) return { error: 'name is required' };
      const needle = String(input.name).toLowerCase().trim();
      const { data: items } = await supabaseAdmin
        .from('grocery_items')
        .select('id, name')
        .eq('checked', false);
      const match = (items || []).find((i) => {
        const n = i.name.toLowerCase();
        return n === needle || n.includes(needle) || needle.includes(n);
      });
      if (!match) return { ok: false, message: `No unchecked item matching "${input.name}".` };
      const { error } = await supabaseAdmin
        .from('grocery_items')
        .update({ checked: true, checked_at: new Date().toISOString() })
        .eq('id', match.id);
      if (error) { console.error(`[tool ${name}]`, error.message); return { error: 'That did not work, please try again.' }; }
      return { ok: true, checked_off: match.name };
    }

    if (name === 'list_groceries') {
      let q = supabaseAdmin.from('grocery_items').select('name, quantity, checked').order('checked').order('created_at');
      if (!input?.include_checked) q = q.eq('checked', false);
      const { data, error } = await q;
      if (error) { console.error(`[tool ${name}]`, error.message); return { error: 'That did not work, please try again.' }; }
      return { ok: true, items: data || [], count: (data || []).length };
    }

    if (name === 'get_calendar') {
      const cal = await getUpcomingEvents(input?.days || 7);
      if (!cal.configured) return { ok: true, configured: false, message: 'Calendar is not connected yet.', events: [] };
      return {
        ok: true,
        configured: true,
        events: (cal.events || []).map((e) => ({
          summary: e.summary, startTime: e.startTime, endTime: e.endTime, allDay: e.allDay, location: e.location,
        })),
      };
    }

    if (name === 'add_calendar_event') {
      if (!userId) return { error: 'Not signed in.' };
      if (!input?.summary || !input?.start) return { error: 'summary and start are required' };
      if (!(await isGoogleConnected(userId))) {
        return { ok: false, message: 'Calendar write is not connected yet. Connect Google Calendar on the Calendar tab first.' };
      }
      try {
        const ev = await insertGoogleEvent(userId, {
          summary: input.summary, start: input.start, end: input.end,
          location: input.location, description: input.description, allDay: !!input.all_day,
        });
        return { ok: true, added: ev };
      } catch (e) { console.error('[tool add_calendar_event]', e.message); return { error: 'Could not add the event.' }; }
    }

    if (name === 'log_meal') {
      if (!input?.description) return { error: 'description is required' };
      if (!userId) return { error: 'Not signed in.' };
      if (!anthropicConfigured()) return { error: 'The meal estimator is not configured yet.' };
      const draft = await estimateMeal({ description: String(input.description), mealSlot: input.meal_slot });
      const { data, error } = await supabaseAdmin.from('nutrition_log').insert({
        user_id: userId,
        logged_for_date: todayLocalISODate(),
        description: String(input.description).slice(0, 500),
        calories: draft.calories,
        protein_g: draft.protein_g,
        carbs_g: draft.carbs_g,
        fat_g: draft.fat_g,
        source: 'ai_estimate',
        confidence: draft.confidence,
        meal_slot: input.meal_slot || null,
        calorie_low: draft.calorie_low,
        calorie_high: draft.calorie_high,
        assumptions: draft.assumptions,
        items: draft.items,
      }).select('id').single();
      if (error) { console.error('[tool log_meal]', error.message); return { error: 'Could not log that meal.' }; }
      return { ok: true, logged: { calories: draft.calories, range: [draft.calorie_low, draft.calorie_high], protein_g: draft.protein_g, carbs_g: draft.carbs_g, fat_g: draft.fat_g, confidence: draft.confidence } };
    }

    if (name === 'get_nutrition_today') {
      if (!userId) return { error: 'Not signed in.' };
      const today = todayLocalISODate();
      const [{ data: entries }, { data: target }] = await Promise.all([
        supabaseAdmin.from('nutrition_log').select('calories, protein_g, carbs_g, fat_g').eq('user_id', userId).eq('logged_for_date', today),
        supabaseAdmin.from('nutrition_targets').select('*').eq('user_id', userId).maybeSingle(),
      ]);
      const sum = (entries || []).reduce((a, e) => ({
        calories: a.calories + (e.calories || 0),
        protein_g: a.protein_g + Number(e.protein_g || 0),
        carbs_g: a.carbs_g + Number(e.carbs_g || 0),
        fat_g: a.fat_g + Number(e.fat_g || 0),
      }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
      return { ok: true, today, totals: { calories: Math.round(sum.calories), protein_g: Math.round(sum.protein_g), carbs_g: Math.round(sum.carbs_g), fat_g: Math.round(sum.fat_g) }, target: target || null, meals_logged: (entries || []).length };
    }

    if (name === 'set_nutrition_target') {
      if (!userId) return { error: 'Not signed in.' };
      const patch = { user_id: userId, updated_at: new Date().toISOString() };
      for (const k of ['calorie_target', 'protein_target_g', 'carb_target_g', 'fat_target_g']) {
        if (input?.[k] != null) patch[k] = Math.round(Number(input[k])) || null;
      }
      const { error } = await supabaseAdmin.from('nutrition_targets').upsert(patch, { onConflict: 'user_id' });
      if (error) { console.error('[tool set_nutrition_target]', error.message); return { error: 'Could not set the target.' }; }
      return { ok: true, target: patch };
    }

    if (name === 'find_local_events') {
      let q = supabaseAdmin.from('nb_places')
        .select('name, kind, what_why, url, indoor_outdoor, crowd_level, sensory_friendly, is_seasonal, season')
        .eq('active', true);
      if (input?.sensory_friendly) q = q.eq('sensory_friendly', true);
      if (['venue', 'trip'].includes(input?.kind)) q = q.eq('kind', input.kind);
      const { data: places, error } = await q.order('kind').order('name');
      if (error) { console.error('[tool find_local_events]', error.message); return { error: 'Could not load places.' }; }
      const { data: events } = await supabaseAdmin.from('nb_event_cache').select('source, title, url').order('fetched_at', { ascending: false }).limit(8);
      return { ok: true, places: places || [], event_sources: events || [] };
    }

    if (name === 'get_fitness_today') {
      if (!userId) return { error: 'Not signed in.' };
      if (!(await isFitbitConnected(userId))) return { ok: false, message: 'Fitbit is not connected. Connect it on the Food tab.' };
      try { return { ok: true, fitness: await readDailySummary(userId) }; }
      catch (e) {
        if (e.code === 429) return { ok: false, message: 'Fitbit is busy right now, try again shortly.' };
        console.error('[tool get_fitness_today]', e.message);
        return { error: 'Could not read Fitbit.' };
      }
    }

    if (name === 'save_kid_item') {
      if (!input?.title || !['activity', 'topic', 'play_idea'].includes(input.kind)) return { error: 'kind (activity|topic|play_idea) and title are required' };
      let kidId = null;
      if (input.kid_name) {
        // limit(1) (not maybeSingle) so a duplicate kid name does not error.
        const { data: kid } = await supabaseAdmin.from('kids').select('id').ilike('name', String(input.kid_name).trim()).limit(1);
        kidId = (kid && kid[0] && kid[0].id) || null;
      }
      const { data, error } = await supabaseAdmin.from('saved_items').insert({
        kind: input.kind,
        kid_id: kidId,
        title: String(input.title).slice(0, 200),
        detail: input.detail ? String(input.detail) : null,
        tags: Array.isArray(input.tags) ? input.tags : [],
        created_by: userId,
      }).select('id, kind, title').single();
      if (error) { console.error('[tool save_kid_item]', error.message); return { error: 'Could not save that.' }; }
      return { ok: true, saved: data };
    }

    if (name === 'list_saved_items') {
      let q = supabaseAdmin.from('saved_items').select('kind, title, detail, kid_id, tags').order('created_at', { ascending: false });
      if (input?.kind) q = q.eq('kind', input.kind);
      const { data, error } = await q;
      if (error) { console.error('[tool list_saved_items]', error.message); return { error: 'Could not read the library.' }; }
      return { ok: true, items: data || [] };
    }

    if (name === 'log_play_moment') {
      if (!userId) return { error: 'Not signed in.' };
      let kidId = null;
      if (input?.kid_name) {
        const { data: kid } = await supabaseAdmin.from('kids').select('id').ilike('name', String(input.kid_name).trim()).limit(1);
        kidId = (kid && kid[0] && kid[0].id) || null;
      }
      const { error } = await supabaseAdmin.from('play_moments').insert({
        done_by: userId, kid_id: kidId, note: input?.note ? String(input.note).slice(0, 300) : null,
      });
      if (error) { console.error('[tool log_play_moment]', error.message); return { error: 'Could not log that.' }; }
      return { ok: true, celebrated: true };
    }

    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    console.error(`[tool ${name}]`, err.message);
    return { error: 'That action failed, please try again.' };
  }
}
