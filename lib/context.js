// Family Hub - assistant persona + the live household context injected each turn.
import { supabaseAdmin } from './supabase.js';
import { getUpcomingEvents } from './calendarRead.js';
import { readTodayFitness } from './fitness.js';
import { todayLocalISODate, computeAge } from './dates.js';

// Stable persona (cacheable). Pull-only by default: the assistant responds when
// asked and does not send unprompted nudges.
export const PERSONA = `You are the family assistant for a two-parent household in the Moncton, New Brunswick area. The current user and the family's specifics (names, kids, schedule) are provided in the household context for each request. You help with groceries, the family calendar, meals and nutrition, daily activity, and ideas for the kids (activities and conversation).

Be warm, concise, and practical. Talk like a helpful partner, not a chatbot. Prefer doing over explaining: when the user asks to add groceries, log a meal, or check the schedule, use your tools and confirm briefly what you did. When you are unsure which item or person is meant, ask one short clarifying question rather than guessing on shared family data.

Ground rules: never nag or guilt-trip about food, activity, or unfinished tasks. Celebrate effort. Keep answers short on a phone screen. Do not use em dashes. You only act when asked; you do not send unprompted reminders.

On being active: only ever offer ONE small, optional, playful movement idea at a time (tied to the kids' interests when relevant), never a list, never a reminder, never a streak or a target. Celebrate any effort and never compare anyone to a goal.`;

// Neurodiversity-affirming guidance carried on every turn (kids are a core use case).
// Hard non-diagnostic guardrails; interest-led, sensory-aware, age-differentiated.
// The children's specific names, ages, interests, and any parent-described traits are
// supplied at runtime in the household context (from the database), not hardcoded here.
// This block is the general affirming approach to apply to whoever the context describes.
export const KIDS_SYSTEM_PROMPT = `You help caregivers support their children, some of whom may be neurodivergent. The specific kids, their ages, interests, and any traits their parents describe are given in the household context. Treat any parent-described diagnosis as a parent observation, not a fact: NEVER assert, imply, or interpret a diagnosis, NEVER label a child's "severity" or "functioning level," NEVER prescribe therapies, interventions, or medication, and ALWAYS defer clinical questions to professionals and to the parent, who knows the child best. Use affirming, strengths-based, identity-first-friendly language; mirror the family's chosen terms; never use "suffers from," "high/low-functioning," or deficit framing.

Treat each child's special interests as strengths and the primary engine of engagement and connection. Build EVERY activity, topic, and plan around them, and never gate an interest behind compliance or make it a reward to be earned.

Design activities with: a short plain-language preview; predictable structure; transition warnings (a 5- and 2-minute heads-up, and respect deep focus before interrupting); 2 to 4 small chunks with check-in points (fewer and shorter for younger children); a genuine two-option choice; and both a calmer "amp-down" version (quiet, fewer materials, headphones) and a "heavy-work / movement" version, plus optional regulation breaks. Scale to each child's age: younger children need short chunks, visual and song cues, parallel-play framing, and adult co-regulation; older children need autonomy, executive-function scaffolding (chunking and task-initiation help), self-esteem protection, and energy outlets before focus tasks.

For connection, use DECLARATIVE language (comments, observations, and "I wonder..." openers tied to their interests) instead of commands or stacked questions; cap yourself at one specific question and never interrogate ("how was your day?"). Offer co-regulation scripts for the caregiver (calm presence, name feelings, a safe sensory space, reflect only once calm returns) rather than expecting a child to self-soothe on demand. Praise effort over outcome. Frame everything as ideas to try and adjust together, and back off at any sign of overwhelm or shutdown.`;

// Build the <household_context> block for the given user. Reads are run in
// parallel; any single failure degrades to an empty section rather than erroring.
export async function buildAssistantContext(userId, userName) {
  const today = todayLocalISODate();

  // Note: groceries and kids are SHARED by design (no user_id column) - both parents
  // see the same list and the same kids. Only nutrition is scoped to this user. If the
  // app ever grows past this one household, kids would need a household/user scope here.
  const [groceries, nutrition, target, cal, kids, fitness, profile, photos] = await Promise.all([
    supabaseAdmin.from('grocery_items').select('name').eq('checked', false).order('created_at').then((r) => r.data || []).catch(() => []),
    supabaseAdmin.from('nutrition_log').select('calories, protein_g, carbs_g, fat_g').eq('user_id', userId).eq('logged_for_date', today).then((r) => r.data || []).catch(() => []),
    supabaseAdmin.from('nutrition_targets').select('*').eq('user_id', userId).maybeSingle().then((r) => r.data).catch(() => null),
    getUpcomingEvents(7).catch(() => ({ configured: false, events: [] })),
    supabaseAdmin.from('kids').select('name, birthdate, notes').order('birthdate', { ascending: true, nullsFirst: false }).then((r) => r.data || []).catch(() => []),
    readTodayFitness(userId).catch(() => null),
    supabaseAdmin.from('profiles').select('*').eq('user_id', userId).maybeSingle().then((r) => r.data).catch(() => null),
    supabaseAdmin.from('photo_bank').select('category, caption').eq('user_id', userId).order('created_at', { ascending: false }).limit(12).then((r) => r.data || []).catch(() => []),
  ]);

  const lines = [];
  lines.push(`Current user: ${userName || 'a parent'}. Today: ${today} (${(process.env.APP_TIMEZONE || 'America/Moncton').trim()}).`);

  // Groceries
  if (groceries.length) {
    lines.push(`Grocery list (${groceries.length} to buy): ${groceries.map((g) => g.name).slice(0, 40).join(', ')}.`);
  } else {
    lines.push('Grocery list: empty.');
  }

  // Nutrition (this user, today)
  if (nutrition.length) {
    const sum = nutrition.reduce((a, n) => ({
      cal: a.cal + (n.calories || 0),
      p: a.p + Number(n.protein_g || 0),
      c: a.c + Number(n.carbs_g || 0),
      f: a.f + Number(n.fat_g || 0),
    }), { cal: 0, p: 0, c: 0, f: 0 });
    const tgt = target?.calorie_target ? ` of a ${target.calorie_target} kcal target` : '';
    lines.push(`Today's food for ${userName || 'this user'}: ${Math.round(sum.cal)} kcal${tgt}, ${Math.round(sum.p)}g protein / ${Math.round(sum.c)}g carbs / ${Math.round(sum.f)}g fat (${nutrition.length} meal(s) logged).`);
  } else {
    lines.push(`Today's food for ${userName || 'this user'}: nothing logged yet${target?.calorie_target ? ` (target ${target.calorie_target} kcal)` : ''}.`);
  }

  // Calendar
  if (cal.configured && cal.events?.length) {
    const items = cal.events.slice(0, 12).map((e) => {
      const when = e.allDay
        ? new Date(e.startTime).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })
        : new Date(e.startTime).toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return `${when}: ${e.summary}${e.location ? ' @ ' + e.location : ''}`;
    });
    lines.push(`Upcoming calendar (next 7 days):\n  - ${items.join('\n  - ')}`);
  } else if (cal.configured) {
    lines.push('Upcoming calendar: nothing in the next 7 days.');
  } else {
    lines.push('Calendar: not connected yet.');
  }

  // Activity (this user, today) - gentle, never a target or deficit
  if (fitness) {
    const bits = [];
    if (fitness.steps != null) bits.push(`${Number(fitness.steps).toLocaleString('en-CA')} steps`);
    if (fitness.active_minutes != null) bits.push(`${fitness.active_minutes} active min`);
    if (fitness.sleep_minutes != null) bits.push(`${(fitness.sleep_minutes / 60).toFixed(1)}h sleep`);
    if (fitness.resting_hr != null) bits.push(`resting HR ${fitness.resting_hr}`);
    if (fitness.weight_kg != null) bits.push(`${fitness.weight_kg} kg`);
    const src = fitness.source === 'fitbit' ? 'from Fitbit' : 'self-logged';
    lines.push(`Today's activity for ${userName || 'this user'}: ${bits.length ? bits.join(', ') : 'logged, no numbers yet'} (${src}). Mention gently, never as a target.`);
  } else {
    lines.push(`Today's activity for ${userName || 'this user'}: nothing logged yet.`);
  }

  // Profile (this user) - feeds specialist coaching
  if (profile) {
    const bits = [];
    if (profile.diet) bits.push(`diet ${profile.diet}`);
    if (profile.allergies?.length) bits.push(`allergies ${profile.allergies.join(', ')}`);
    if (profile.dislikes?.length) bits.push(`avoids ${profile.dislikes.join(', ')}`);
    if (profile.interests?.length) bits.push(`interests ${profile.interests.join(', ')}`);
    if (profile.hobbies?.length) bits.push(`hobbies ${profile.hobbies.join(', ')}`);
    if (bits.length) lines.push(`About ${userName || 'this user'}: ${bits.join('; ')}.`);
    if (profile.personality) lines.push(`How ${userName || 'they'} tick: ${profile.personality}`);
    if (profile.goals) lines.push(`${userName || 'Their'} current goals: ${profile.goals}`);
    if (profile.notes) lines.push(`Notes learned about them: ${profile.notes}`);
    if (profile.goals_doc) lines.push(`North-star goals & values (coach toward these):\n${profile.goals_doc}`);
  }

  // Photo bank captions (grounded context for nutrition/activity suggestions)
  const captioned = (photos || []).filter((p) => p.caption);
  if (captioned.length) {
    const pl = captioned.slice(0, 8).map((p) => `${p.category}: ${p.caption}`);
    lines.push(`Photo bank (what they've shared):\n  - ${pl.join('\n  - ')}`);
  }

  // Kids
  if (kids.length) {
    const kidLines = kids.map((k) => {
      const age = computeAge(k.birthdate);
      const ageStr = age != null ? ` (age ${age})` : '';
      return `${k.name}${ageStr}: ${k.notes || 'no profile notes yet'}`;
    });
    lines.push(`Kids:\n  - ${kidLines.join('\n  - ')}`);
  }

  return `<household_context>\n${lines.join('\n')}\n</household_context>`;
}
