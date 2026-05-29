// Family Hub - shared date helpers.

// The local calendar date in the family timezone, as YYYY-MM-DD. Used so a meal
// logged at 11pm counts toward the right day regardless of the server's UTC clock.
export function todayLocalISODate() {
  const tz = (process.env.APP_TIMEZONE || 'America/Moncton').trim();
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Whole-year age from a birthdate (string or Date), or null if unparseable.
export function computeAge(birthdate) {
  if (!birthdate) return null;
  const b = new Date(birthdate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}
