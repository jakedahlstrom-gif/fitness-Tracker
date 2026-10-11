// Glue between the rewards ledger and the app:
//   - the one-time backfill when Stage 3 first runs (her history earns its badges)
//   - quiet passes that catch anything a save didn't record (goal edits, a killed app)
//   - restores and Erase all
//   - the equipped look and the Profile tab's "new" dot

import { store } from './store.js';
import { collect, resolveLook } from './rewards.js';
import { applyLook, currentLook, SKINS } from './looks.js';
import { goalLabel } from './components.js';
import { icon } from './icons.js';
import { plural } from './util.js';
import { todayKey } from './dates.js';
import { toast } from './toast.js';
import { isLogSheetOpen } from './logSheet.js';
import { isCelebrating, cancelCelebrations, playIntro, revealUnseen } from './celebrate.js';

/**
 * Apply the effective look: the equipped palette and skin if they're unlocked,
 * otherwise Glow / Classic. Settings are never rewritten.
 */
export function syncLook({ force = false } = {}) {
  const look = resolveLook(store.settings, store.rewards().unlocked);
  const cur = currentLook();
  const changed = look.palette !== cur.palette || look.skin !== cur.skin;
  if (changed || force) applyLook(look);
  const plus = document.querySelector('#hold-btn .hold-plus');
  const want = SKINS[look.skin]?.icon || 'plus';
  if (plus && plus.dataset.icon !== want) {
    plus.innerHTML = icon(want);
    plus.dataset.icon = want;
  }
  return changed;
}

/** The Profile tab dot: something new is waiting in the Trophy Case or Glow Studio. */
export function syncTabDot() {
  const { unseen } = store.rewards();
  const has = unseen.badges.length + unseen.unlocks.length > 0 && !store.awards.introPending;
  document.querySelector('.tab[data-tab="profile"]')?.classList.toggle('has-new', has);
}

/**
 * First run with the rewards ledger (or after restoring an older backup): record
 * everything her history already earned. `intro` = show the gift intro for it.
 */
export function runBackfillIfNeeded({ intro = true } = {}) {
  if (store.awards.backfilledAt) return null;
  const now = new Date().toISOString();
  const today = todayKey();
  const res = collect(store.state, store.derived(), store.awards, { today, mode: 'backfill', now, label: goalLabel, seen: !intro });
  const badges = Object.keys(res.badges).length;
  const showIntro = intro && badges > 0 && store.canPersist;
  store.grant({ wins: res.wins, badges: res.badges, patch: { backfilledAt: now, introPending: showIntro } });
  return { badges, intro: showIntro };
}

/** One quiet pass: record wins and badges that are true now but not in the ledger. */
function quietPass({ announce = true } = {}) {
  const res = collect(store.state, store.derived(), store.awards, {
    today: todayKey(), mode: 'quiet', now: new Date().toISOString(), label: goalLabel,
  });
  const granted = store.grant(res);
  const n = Object.keys(res.badges).length;
  if (granted && announce && store.canPersist && (n || res.newUnlocks.length)) {
    const what = n ? (n === 1 ? 'A new badge is waiting' : `${n} new badges are waiting`) : 'A new look is unlocked';
    toast(what, { duration: 6000, action: { label: 'Open', fn: revealUnseen } });
  }
  return res;
}

let timer = 0;
/** Run a quiet pass soon (debounced). Waits while a log sheet is open or a celebration plays. */
export function reconcile(delay = 400) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (isLogSheetOpen() || isCelebrating() || document.body.classList.contains('recap-open')) { reconcile(1500); return; }
    quietPass();
  }, delay);
}

let lastReplace = null;
/** What the last restore / erase recorded (for the restore toast). */
export const replaceSummary = () => lastReplace;

function afterReplace() {
  cancelCelebrations();
  clearTimeout(timer);
  const back = runBackfillIfNeeded({ intro: false });
  quietPass({ announce: false });
  lastReplace = { badges: Object.keys(store.awards.badges).length, backfilled: back?.badges || 0 };
}

/** "Restored 120 workouts · 14 badges" style summary. */
export function restoreText(n) {
  const b = lastReplace?.badges || 0;
  return `Restored ${plural(n, 'workout')}${b ? ` · ${plural(b, 'badge')}` : ''}`;
}

/** Wire the rewards flow into the app. Call once after the first render. */
export function initRewardsFlow() {
  store.subscribe((reason) => {
    if (reason === 'replace') afterReplace();
    if (reason === 'goals' || reason === 'settings' || reason === 'rest') reconcile();
    if (reason === 'settings' || reason === 'awards' || reason === 'awards:seen' || reason === 'replace') syncLook();
    syncTabDot();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconcile(300);
  });
  syncTabDot();
  // Shortly after launch: the one-time backfill (with its tap-to-open intro), then a quiet pass.
  setTimeout(() => {
    const back = runBackfillIfNeeded({ intro: true });
    if (store.awards.introPending && store.canPersist && !isLogSheetOpen()) playIntro();
    else if (!back) quietPass();
    syncTabDot();
  }, 600);
}
