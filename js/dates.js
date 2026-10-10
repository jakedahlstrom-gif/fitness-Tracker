// Date helpers. Workouts are stored with a local calendar day key ("YYYY-MM-DD")
// plus a "HH:MM" time, so day/week math never drifts with time zones.

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar key for a Date: "2026-10-10". Keys sort correctly as strings. */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Key → Date at local midnight. */
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayKey = () => dateKey(new Date());

export function timeNow() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

export const addDaysKey = (key, n) => dateKey(addDays(parseKey(key), n));

/** Midnight on the first day of the week containing `date` (weekStart: 0 = Sun, 1 = Mon). */
export function startOfWeek(date, weekStart = 1) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

/** Whole days from key a to key b (b − a). */
export function daysBetween(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / 86400000);
}

// ---- Formatting ----

export const weekdayShort = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });

/** "Saturday, October 10" */
export const fmtLongDate = (d = new Date()) =>
  d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** "Oct 6" (adds the year when it isn't this year). */
export function fmtShortDate(d) {
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/** "Today", "Yesterday" or "Tue, Oct 7". */
export function fmtDayLabel(key) {
  const diff = daysBetween(key, todayKey());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = parseKey(key);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/** "Today", "Yesterday", "3d ago", "2w ago", "Mar 4". */
export function fmtAgo(key) {
  const diff = daysBetween(key, todayKey());
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  if (diff < 35) return `${Math.floor(diff / 7)}w ago`;
  return fmtShortDate(parseKey(key));
}

/** "Oct 6 – 12" or "Sep 29 – Oct 5" for a week starting at `start`. */
export function fmtWeekRange(start) {
  const end = addDays(start, 6);
  const m1 = start.toLocaleDateString(undefined, { month: 'short' });
  const m2 = end.toLocaleDateString(undefined, { month: 'short' });
  return m1 === m2
    ? `${m1} ${start.getDate()} – ${end.getDate()}`
    : `${m1} ${start.getDate()} – ${m2} ${end.getDate()}`;
}

/** "18:05" → "6:05 PM" in the device's locale. */
export function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Good morning" / "Good afternoon" / "Good evening". */
export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  return 'Good evening';
}
