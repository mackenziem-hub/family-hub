// Family Hub - assistant tool definitions + executor.
// Phase 2 tools: groceries (add / check / list) + read the calendar.
// executeTool() shares the same Supabase logic the REST handlers use; ctx = { userId }.
import { supabaseAdmin } from './supabase.js';
import { getUpcomingEvents } from './calendarRead.js';
import { insertGoogleEvent, isGoogleConnected, combinedFreeBusy, invertBusyToFree } from './google.js';
import { estimateMeal } from './nutrition.js';
import { logManualFitness, readTodayFitness } from './fitness.js';
import { rememberFact, searchMemories } from './memory.js';
import { readNote, writeNote } from './obsidian.js';
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
    description: "Get the current user's activity logged today (steps, active minutes, sleep, etc.), from Fitbit if connected or whatever they have self-logged. Frame gently and positively, never as a deficit or a target missed.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'log_fitness',
    description: "Record the current user's activity for today (or a stated day) when they tell you their numbers, e.g. 'I walked 8,000 steps', 'slept about 7 hours', 'did 30 active minutes'. There is no Fitbit sync, so the user reads stats off their watch and tells you; log whatever they mention. Merges with anything already logged that day. Confirm briefly and gently, never as a deficit, target, or streak.",
    input_schema: {
      type: 'object',
      properties: {
        steps: { type: 'number', description: 'Step count.' },
        active_minutes: { type: 'number', description: 'Active / exercise minutes.' },
        sleep_hours: { type: 'number', description: 'Hours of sleep (stored as minutes).' },
        sleep_minutes: { type: 'number', description: 'Minutes of sleep, if given directly instead of hours.' },
        resting_hr: { type: 'number', description: 'Resting heart rate (bpm).' },
        calories_out: { type: 'number', description: 'Calories burned, if they have it.' },
        weight_kg: { type: 'number', description: 'Body weight in kilograms.' },
        weight_lb: { type: 'number', description: 'Body weight in pounds (converted to kg).' },
        day: { type: 'string', description: 'ISO date YYYY-MM-DD only if logging a day other than today.' },
      },
    },
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
  {
    name: 'update_profile',
    description: "Save facts about the CURRENT user's profile as they come up in conversation (progressive profiling). Use whenever they share a diet, allergy, dislike, interest, hobby, goal, or something about how they tick. Arrays ADD to what's there; notes append. Use naturally and sparingly; confirm briefly.",
    input_schema: {
      type: 'object',
      properties: {
        diet: { type: 'string', description: 'Overall diet, e.g. "vegetarian" or "omnivore, low-carb".' },
        add_allergies: { type: 'array', items: { type: 'string' }, description: 'Allergies to add.' },
        add_dislikes: { type: 'array', items: { type: 'string' }, description: 'Foods/things they avoid, to add.' },
        add_interests: { type: 'array', items: { type: 'string' }, description: 'Interests to add.' },
        add_hobbies: { type: 'array', items: { type: 'string' }, description: 'Hobbies to add.' },
        goals: { type: 'string', description: 'Their current goals (replaces the current-goals field).' },
        personality_note: { type: 'string', description: 'A trait or what-helps note to append.' },
        note: { type: 'string', description: 'Any other durable fact about them to append.' },
      },
    },
  },
  {
    name: 'remember',
    description: "Save a durable fact, preference, routine, event, or insight about the family to long-term memory so you recall it in future conversations (e.g. 'pizza night is Fridays', 'Jack is scared of thunder', a recurring preference, an important date). Set shared=true for household-wide facts, false for something private to the current user. Don't save trivial or one-off chatter.",
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact to remember, clear and self-contained.' },
        category: { type: 'string', enum: ['fact', 'preference', 'event', 'insight', 'routine'] },
        shared: { type: 'boolean', description: 'true = whole household (default); false = private to the current user.' },
        pinned: { type: 'boolean', description: 'true for especially important facts to always keep in mind.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'recall',
    description: "Search your long-term memory for what you know about the family on a topic, when it isn't already in the context. Use before saying you don't know or remember something.",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What to look up.' } }, required: ['query'] },
  },
  {
    name: 'find_free_time',
    description: "Find when everyone in the household is free, using each connected person's Google free/busy (only busy blocks, never event details). Use for 'when are we all free', scheduling, or before adding a shared event. Only reflects calendars that are connected; say so if someone hasn't connected.",
    input_schema: { type: 'object', properties: { days: { type: 'number', description: 'How many days ahead to search (default 7, max 14).' } } },
  },
  {
    name: 'write_note',
    description: "Save a longer-form note to the family's Obsidian vault (a markdown knowledge base) - e.g. a meal plan, trip plan, a running family log, a project page. Use for durable documents worth keeping as a file; use 'remember' for short quick facts instead. Notes are stored under notes/.",
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Note name/path, e.g. "meal-plan" or "family-log/2026-05-30". The .md extension and notes/ folder are added automatically.' },
        content: { type: 'string', description: 'The note body, in markdown.' },
        title: { type: 'string', description: 'Optional title (saved as frontmatter).' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_note',
    description: "Read a note back from the family's Obsidian vault by path (e.g. 'meal-plan'). Use to recall or update a longer-form document you saved earlier.",
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
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
      try {
        const f = await readTodayFitness(userId);
        if (!f) return { ok: true, has_data: false, message: 'Nothing logged for today yet. They can tell you their steps, sleep, or active minutes and you can log it with log_fitness.' };
        return { ok: true, has_data: true, source: f.source, fitness: { day: f.day, steps: f.steps, active_minutes: f.active_minutes, calories_out: f.calories_out, resting_hr: f.resting_hr, sleep_minutes: f.sleep_minutes, weight_kg: f.weight_kg } };
      } catch (e) {
        if (e.code === 429) return { ok: false, message: 'Fitbit is busy right now, try again shortly.' };
        console.error('[tool get_fitness_today]', e.message);
        return { error: 'Could not read activity.' };
      }
    }

    if (name === 'log_fitness') {
      if (!userId) return { error: 'Not signed in.' };
      const intOf = (v) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.max(0, x) : null; };
      const fields = {};
      if (input?.steps != null) fields.steps = intOf(input.steps);
      if (input?.active_minutes != null) fields.active_minutes = intOf(input.active_minutes);
      if (input?.calories_out != null) fields.calories_out = intOf(input.calories_out);
      if (input?.resting_hr != null) fields.resting_hr = intOf(input.resting_hr);
      if (input?.sleep_minutes != null) fields.sleep_minutes = intOf(input.sleep_minutes);
      else if (input?.sleep_hours != null) fields.sleep_minutes = intOf(Number(input.sleep_hours) * 60);
      if (input?.weight_kg != null) { const w = Number(input.weight_kg); if (Number.isFinite(w)) fields.weight_kg = Math.round(w * 100) / 100; }
      else if (input?.weight_lb != null) { const w = Number(input.weight_lb); if (Number.isFinite(w)) fields.weight_kg = Math.round(w * 0.45359237 * 100) / 100; }
      // Drop keys that normalized to null (bad input).
      for (const k of Object.keys(fields)) { if (fields[k] == null) delete fields[k]; }
      if (!Object.keys(fields).length) return { error: 'Tell me at least one stat (steps, active minutes, sleep, etc.).' };
      try {
        const row = await logManualFitness(userId, fields, input?.day);
        return { ok: true, logged: { day: row.day, steps: row.steps, active_minutes: row.active_minutes, sleep_minutes: row.sleep_minutes, calories_out: row.calories_out, resting_hr: row.resting_hr, weight_kg: row.weight_kg } };
      } catch (e) { console.error('[tool log_fitness]', e.message); return { error: 'Could not log that activity.' }; }
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

    if (name === 'update_profile') {
      if (!userId) return { error: 'Not signed in.' };
      const { data: cur } = await supabaseAdmin.from('profiles').select('*').eq('user_id', userId).maybeSingle();
      const p = cur || {};
      const mergeArr = (existing, add) => {
        const set = new Set((existing || []).map((x) => String(x)));
        for (const x of add || []) { const s = String(x).trim(); if (s) set.add(s); }
        return Array.from(set).slice(0, 60);
      };
      const patch = { user_id: userId, updated_at: new Date().toISOString() };
      if (input?.diet) patch.diet = String(input.diet).slice(0, 200);
      if (input?.goals) patch.goals = String(input.goals).slice(0, 2000);
      if (Array.isArray(input?.add_allergies)) patch.allergies = mergeArr(p.allergies, input.add_allergies);
      if (Array.isArray(input?.add_dislikes)) patch.dislikes = mergeArr(p.dislikes, input.add_dislikes);
      if (Array.isArray(input?.add_interests)) patch.interests = mergeArr(p.interests, input.add_interests);
      if (Array.isArray(input?.add_hobbies)) patch.hobbies = mergeArr(p.hobbies, input.add_hobbies);
      if (input?.personality_note) patch.personality = ((p.personality ? p.personality + ' ' : '') + String(input.personality_note)).slice(0, 4000);
      if (input?.note) patch.notes = ((p.notes ? p.notes + '\n' : '') + String(input.note)).slice(0, 6000);
      const fields = Object.keys(patch).filter((k) => k !== 'user_id' && k !== 'updated_at');
      if (!fields.length) return { error: 'Nothing to update.' };
      const { error } = await supabaseAdmin.from('profiles').upsert(patch, { onConflict: 'user_id' });
      if (error) { console.error('[tool update_profile]', error.message); return { error: 'Could not update the profile.' }; }
      return { ok: true, updated: fields };
    }

    if (name === 'remember') {
      if (!userId) return { error: 'Not signed in.' };
      if (!input?.content) return { error: 'content is required' };
      const r = await rememberFact(userId, {
        content: input.content, category: input.category,
        scope: input.shared === false ? 'me' : 'household', pinned: !!input.pinned,
      });
      if (!r.ok) { console.error('[tool remember]', r.error); return { error: 'Could not save that to memory.' }; }
      return { ok: true, remembered: String(input.content).slice(0, 120), status: r.updated ? 'updated' : (r.deduped ? 'already known' : 'saved') };
    }

    if (name === 'recall') {
      if (!userId) return { error: 'Not signed in.' };
      const hits = await searchMemories(userId, input?.query || '', 15);
      return { ok: true, memories: hits.map((m) => ({ category: m.category, content: m.content })) };
    }

    if (name === 'find_free_time') {
      if (!userId) return { error: 'Not signed in.' };
      const days = Math.min(Number(input?.days) || 7, 14);
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + days * 86400000).toISOString();
      try {
        const cfb = await combinedFreeBusy(timeMin, timeMax);
        if (!cfb.connectedCount) return { ok: true, connected: 0, message: 'No one has connected Google Calendar yet (Calendar tab -> Connect).' };
        const free = invertBusyToFree(cfb.merged, timeMin, timeMax).slice(0, 12);
        const notConnected = cfb.perPerson.filter((p) => !p.connected).map((p) => p.email);
        return { ok: true, connected: cfb.connectedCount, not_connected: notConnected, free_slots: free };
      } catch (e) { console.error('[tool find_free_time]', e.message); return { error: 'Could not read free/busy.' }; }
    }

    if (name === 'write_note') {
      if (!input?.path || !input?.content) return { error: 'path and content are required' };
      const fm = { updated: new Date().toISOString().slice(0, 10) };
      if (input.title) fm.title = String(input.title);
      const w = await writeNote(input.path, input.content, fm);
      if (!w.ok) return w.error === 'vault_not_configured' ? { ok: false, message: 'The Obsidian vault is not connected yet.' } : { error: 'Could not save the note.' };
      return { ok: true, saved: w.path };
    }

    if (name === 'read_note') {
      if (!input?.path) return { error: 'path is required' };
      const rd = await readNote(input.path);
      if (!rd.ok) return rd.error === 'vault_not_configured' ? { ok: false, message: 'The Obsidian vault is not connected yet.' } : { error: 'Could not read the note.' };
      if (!rd.found) return { ok: true, found: false, message: 'No note at ' + rd.path };
      return { ok: true, found: true, path: rd.path, content: String(rd.content).slice(0, 6000) };
    }

    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    console.error(`[tool ${name}]`, err.message);
    return { error: 'That action failed, please try again.' };
  }
}
