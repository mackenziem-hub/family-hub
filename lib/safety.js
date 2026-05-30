// Family Hub - deterministic safety pre-screen. Detection GATES generation: this runs
// BEFORE Claude is called, and on a hit returns a fixed, safe response without invoking
// the model (the Tessa/NEDA lesson - never let a model freestyle on a crisis). The
// model's SPECIALIST_SAFETY system block remains the backstop for everything else.
// Tuned for precision (avoid blocking benign family chat); the backstop covers gray areas.

const CRISIS = /\b(kill myself|suicidal|suicide|end my life|want to die|wanna die|hurt(ing)? myself|harm(ing)? myself|self[-\s]?harm|cut(ting)? myself|no reason to live|better off dead|don'?t want to be alive)\b/i;

const DISORDERED = /(\bpurge\b|purging|make myself (throw up|vomit)|throw up (my|after)|laxative|crash diet|very low calorie|starve myself|starving myself|fast(ing)? (to|so i) lose|lose \d+\s?(lbs|pounds|kg)\s+(in|by)\s+(a |this |next |\d+ )?(day|days|week|tomorrow|tonight|overnight|weekend|mon|tue|wed|thu|fri|sat|sun)|how (little|few) (can i eat|calories can i)|fewest calories i can|stop eating (to|so i) lose)/i;

const CLINICAL = /(\bdiagnose\b|what('?s| is) wrong with me|prescrib|what dose|correct dosage|how (much|many) (mg|milligrams)|drug interaction|should i (take|stop|increase|change) (my |the )?(medication|meds|pills?|insulin|antidepressant|antibiotic|dose))/i;

export function safetyPrescreen(message) {
  const m = String(message || '');
  if (CRISIS.test(m)) {
    return { block: true, kind: 'crisis', reply: "I'm really glad you told me, and I'm genuinely concerned about you. This is bigger than I can help with safely, but people who can are there right now: in Canada and the US you can call or text 988 (Suicide and Crisis Lifeline) any time, free and confidential. If you might be in immediate danger, please call 911 or go to your nearest emergency room. You deserve real support from someone trained for this, and reaching out is a strong thing to do." };
  }
  if (DISORDERED.test(m)) {
    return { block: true, kind: 'eating', reply: "I care about you, so I won't help with restricting, purging, or rapid weight loss. Those can be genuinely dangerous, and especially worth protecting the kids from. If food or body image feels really hard right now, please talk to your doctor, or reach the NEDA Helpline at 1-800-931-2237. I'm always glad to help with gentle, balanced, sustainable habits instead whenever you want." };
  }
  if (CLINICAL.test(m)) {
    return { block: true, kind: 'clinical', reply: "That's really a medical question, and I'm not able to diagnose, prescribe, or weigh in on medications or symptoms safely. Your doctor or pharmacist can look at your full picture, so please check with them. I can absolutely help with everyday wellness, meals, routines, and planning around whatever they advise." };
  }
  return { block: false };
}
