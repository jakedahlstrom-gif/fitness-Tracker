// The in-app half of the daily nudge: a gentle toast when she opens the app after her
// reminder time with nothing logged today. (The phone alert comes from her calendar.)

import { store } from './store.js';
import { toast } from './toast.js';
import { todayKey, timeNow } from './dates.js';
import { pickLine } from './rewards.js';
import { plural } from './util.js';
import { isLogSheetOpen } from './logSheet.js';
import { isCelebrating } from './celebrate.js';
import { shouldNudge, NUDGE_WEEK, NUDGE_LINES } from './reminders.js';

const KEY = 'glow-fitness:nudged'; // the day she was last nudged on this device

function lastNudged() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function markNudged(day) {
  try { localStorage.setItem(KEY, day); } catch { /* private mode: she may see it twice */ }
}

/** Show today's nudge if it's due. Returns true when it showed. */
export function maybeNudge() {
  const today = todayKey();
  const s = store.settings;
  const due = shouldNudge({
    reminder: s.reminder, now: timeNow(), today, lastNudged: lastNudged(),
    loggedToday: store.state.workouts.some((w) => w.date === today),
    restToday: store.state.restDays.includes(today),
  });
  if (!due || isLogSheetOpen() || isCelebrating() || document.body.classList.contains('recap-open')) return false;
  markNudged(today);
  const left = s.targets.workouts - store.derived().week.count;
  const line = left > 0
    ? pickLine(today, NUDGE_WEEK, { name: s.name, left: plural(left, 'workout') })
    : pickLine(today, NUDGE_LINES, { name: s.name });
  toast(line, { duration: 7000 });
  return true;
}

/** Check shortly after launch (after the intro) and whenever the app comes back to the front. */
export function initReminders() {
  setTimeout(maybeNudge, 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(maybeNudge, 1200);
  });
}
