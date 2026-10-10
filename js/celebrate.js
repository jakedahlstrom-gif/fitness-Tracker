// The celebration director. One save can earn several things at once, so the
// director plays at most two beats:
//   Beat A, sized by the biggest event:
//     L1 "Pop"     a small win pill above the tab bar (weekly goal, rings, streak week)
//     L2 "Cannons" a banner with confetti cannons and sky pops (monthly goal, PR, freeze)
//     L3 "Finale"  full-screen fireworks and a hero card (long-term goal, or 3+ big wins)
//   Beat B: the badge / unlock reveal (a flip card with sparks and god rays).
// Celebrations never overlap: a new one while another plays is merged into one
// queued follow-up. Ordinary toasts wait until the director is idle.

import { store } from './store.js';
import { confetti, sound, haptic, hapticSeq, isCalm, accents, unlockAudio, clearConfetti } from './effects.js';
import { createShow, skyColors, GOLD, WHITE } from './fireworks.js';
import { badgeSVG, hexOf } from './badgeArt.js';
import { BADGE_BY_ID, RARITY_LABEL, badgeColors } from './badges.js';
import { unlockInfo, paletteStyle, currentLook } from './looks.js';
import { buildPlan, pickLine } from './rewards.js';
import { goalLabel, goalNum, goalUnit } from './components.js';
import { holdMiniHTML, paletteOrbHTML, bindHoldMinis, equipLook } from './lookParts.js';
import { icon } from './icons.js';
import { esc, plural, fmtNum, prefersReducedMotion } from './util.js';
import { parseKey, daysBetween } from './dates.js';
import { toast, setToastGate, flushToasts, dismissToast } from './toast.js';

const RM = () => prefersReducedMotion();
const userName = () => String(store.settings.name || '').trim() || 'friend';
const layerRoot = () => document.getElementById('celebrate-root') || document.body;
const fmtDay = (key, opts = { month: 'short', day: 'numeric' }) => parseKey(key).toLocaleDateString(undefined, opts);
const monthName = (key) => parseKey(key).toLocaleDateString(undefined, { month: 'long' });

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const POOL = {
  short: ['Week won!', 'Weekly goal: crushed.', "That's the week, {name}!"],
  medium: ['Month crushed, {name}!', '{Month}: conquered.', 'Monthly goal, done and glowing.'],
  long: ['You did it, {name}!', 'Legend behavior.', 'Dream → done.'],
  pr: ['New PR!', 'Record smashed!'],
};

export const RECORD_NAMES = {
  longestWorkout: 'Longest workout', bestWeek: 'Best week', bestMonth: 'Best month',
  dailyStreak: 'Longest daily streak', weeklyStreak: 'Longest weekly streak',
};

export function recordUnit(record, n) {
  if (record === 'dailyStreak') return n === 1 ? 'day' : 'days';
  if (record === 'weeklyStreak') return n === 1 ? 'week' : 'weeks';
  return 'min';
}

const goalOf = (e) => e.goal || store.getGoal(e.goalId);
const labelOf = (e) => { const g = goalOf(e); return g ? goalLabel(g) : 'Goal'; };

/** The headline text for an event (also used in chips). */
export function eventTitle(e) {
  switch (e.kind) {
    case 'goal': {
      const g = goalOf(e);
      const month = g && e.key ? (e.key.split(':M:')[1] || '') : '';
      if (e.catchUp) {
        return e.tier === 'short' ? "Last week's goal: done after all"
          : `${month ? monthName(`${month}-01`) : 'Last month'}'s goal: done after all`;
      }
      const pool = POOL[e.tier] || POOL.short;
      return pickLine(e.key, pool, { name: userName(), Month: month ? monthName(`${month}-01`) : 'This month' });
    }
    case 'pr': return `${RECORD_NAMES[e.record]} · ${fmtNum(e.value)} ${recordUnit(e.record, e.value)}`;
    case 'freeze': return `Streak freeze banked (${e.freezes}/2)`;
    case 'allRings': return 'All rings closed';
    case 'weekMet': return e.streak > 1 ? `Week ${e.streak} locked in` : 'Weekly goal hit · streak started';
    case 'weekFilled': return `That fills in a week · ${e.streak}-week streak`;
    case 'ring': return e.ring === 'minutes' ? 'Minutes ring closed' : 'Active days ring closed';
    default: return '';
  }
}

/** Short chip label + icon + color for an event. */
export function eventChip(e) {
  switch (e.kind) {
    case 'pr': return { icon: 'trophy', text: `New PR · ${RECORD_NAMES[e.record]}`, color: 'yellow' };
    case 'goal': return { icon: 'goals', text: labelOf(e), color: 'lime' };
    case 'freeze': return { icon: 'snowflake', text: 'Freeze banked', color: 'blue' };
    case 'allRings': return { icon: 'sparkle', text: 'All rings closed', color: 'pink' };
    case 'weekMet': return { icon: 'flame', text: `Week ${e.streak} locked in`, color: 'pink' };
    case 'weekFilled': return { icon: 'flame', text: 'Filled in a week', color: 'pink' };
    case 'ring': return e.ring === 'minutes'
      ? { icon: 'clock', text: 'Minutes ring closed', color: 'purple' }
      : { icon: 'calendar', text: 'Days ring closed', color: 'cyan' };
    default: return { icon: 'sparkle', text: '', color: 'cyan' };
  }
}

const chipHTML = (c, extra = '') => `<span class="cel-chip c-${c.color}" ${extra}>${icon(c.icon)}<span>${esc(c.text)}</span></span>`;
const colorHex = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || '#FF2D78';

// ---------------------------------------------------------------------------
// Director state
// ---------------------------------------------------------------------------

let active = null;    // the run that's playing
let queued = null;    // one merged follow-up
let lastEnd = 0;
let banner = null;    // the live L2 banner (so a new hold can dismiss it)

setToastGate(() => !!active);

export const isCelebrating = () => !!active;
export const lastCelebrationEnd = () => lastEnd;

/** A run: timers and cleanups that can be ended at once (page hidden, data replaced). */
function makeRun() {
  const timers = new Set();
  const cleanups = [];
  let done = false;
  let resolveEnd;
  const ended = new Promise((r) => { resolveEnd = r; });
  const run = {
    at(ms, fn) {
      const t = setTimeout(() => { timers.delete(t); if (!done) fn(); }, ms);
      timers.add(t);
      return t;
    },
    wait(ms) { return Promise.race([new Promise((r) => run.at(ms, r)), ended]); },
    until(promise) { return Promise.race([promise, ended]); },
    onEnd(fn) { cleanups.push(fn); },
    end() {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      timers.clear();
      for (const fn of cleanups.splice(0)) { try { fn(); } catch (err) { console.error(err); } }
      resolveEnd();
    },
    get done() { return done; },
    ended,
  };
  return run;
}

/** Badge ids and unlock uids a plan will show. */
function planItems(plan) {
  const src = plan.reveal || plan.alsoEarned || { badges: [], unlocks: [] };
  return { badges: [...(src.badges || [])], unlocks: [...(src.unlocks || [])] };
}

/** Merge two plans into one by re-planning their combined events. */
function mergePlans(a, b) {
  const events = new Map();
  for (const p of [a, b]) {
    for (const e of [p.headline, ...(p.chips || []), ...(p.reveal?.also || [])]) if (e) events.set(e.key, e);
  }
  const items = [planItems(a), planItems(b)];
  const badges = Object.fromEntries([...new Set(items.flatMap((i) => i.badges))].map((id) => [id, {}]));
  const unlocks = [...new Set(items.flatMap((i) => i.unlocks))];
  return buildPlan({ fresh: [...events.values()], badges, newUnlocks: unlocks, repeats: [] }, { lastEndAt: lastEnd, now: Date.now() });
}

/**
 * Play a plan from rewards.buildPlan().
 * @param {object} plan
 * @param {object} [opts]
 * @param {string} [opts.fallback]   toast when there's nothing to celebrate
 * @param {boolean} [opts.inGesture] still inside the user's tap (iOS haptics)
 * @param {boolean} [opts.skipConfetti] the log burst already fired (L1 skips its own)
 */
export function celebrate(plan, opts = {}) {
  if (!plan) return;
  if (!plan.level && !plan.reveal) {
    const msg = plan.repeatToast || opts.fallback;
    if (msg) toast(msg);
    return;
  }
  if (active) {
    queued = queued ? { plan: mergePlans(queued.plan, plan), opts: { ...queued.opts, inGesture: false } } : { plan, opts: { ...opts, inGesture: false } };
    return;
  }
  play(plan, opts);
}

async function play(plan, opts) {
  const run = makeRun();
  active = run;
  document.body.classList.add('celebrating');
  if (plan.level >= 2 || plan.reveal) dismissToast();
  try {
    const delay = plan.level === 2 ? 150 : (!plan.level && plan.reveal) ? 220 : 0;
    if (delay) await run.wait(delay);
    let beatA = null;
    if (plan.level === 1) beatA = playPop(plan.headline, plan.chips, opts, run);
    else if (plan.level === 2) beatA = playCannons(plan, opts, run);
    else if (plan.level === 3) beatA = playFinale(plan, opts, run);
    if (plan.reveal && !run.done) {
      if (plan.level === 2) {
        await run.wait(plan.reveal.delay || 2400);
        banner?.dismiss();
      } else if (beatA) await beatA;
      if (!run.done) await playReveal(plan.reveal, { ...opts, inGesture: opts.inGesture && !beatA }, run);
    } else if (beatA) await beatA;
  } catch (err) {
    console.error(err);
  } finally {
    run.end();
    active = null;
    lastEnd = Date.now();
    document.body.classList.remove('celebrating');
    if (queued) {
      const q = queued;
      queued = null;
      setTimeout(() => celebrate(q.plan, q.opts), 250);
    } else {
      flushToasts();
      document.dispatchEvent(new CustomEvent('glow:celebration-end'));
    }
  }
}

/** Stop everything at once (data replaced). Nothing is marked seen. */
export function cancelCelebrations() {
  queued = null;
  active?.end();
  banner?.dismiss(true);
  clearConfetti();
}

/** A new hold-to-log dismisses an L2 banner. */
export function dismissBanner() { banner?.dismiss(); }

// When the page is hidden mid-show, finish instantly (the ledger is already written).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && active) {
    queued = null;
    active.end();
    clearConfetti();
  }
});

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function shareSpec(e) {
  if (!e) return null;
  if (e.kind === 'goal') return { kind: 'goal', key: e.key, goalId: e.goalId };
  if (e.kind === 'pr') return { kind: 'pr', key: e.key };
  return null;
}

export function openShare(spec) {
  if (!spec) return;
  import('./shareCard.js').then((m) => m.openShareSheet(spec)).catch((err) => {
    console.error(err);
    toast("Couldn't open sharing");
  });
}

/** Trap Tab inside a modal layer and close on Escape. Returns a cleanup. */
function modalKeys(layer, onEscape) {
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const f = [...layer.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

/** Swipe on an element: calls fn(dy) once the finger lifts. */
function onSwipe(el, fn) {
  let y0 = null;
  el.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
  el.addEventListener('pointerup', (e) => { if (y0 != null) fn(e.clientY - y0); y0 = null; });
  el.addEventListener('pointercancel', () => { y0 = null; });
}

/** Count a number up inside el over `ms` (final value straight away under reduced motion). */
function countUp(el, to, { from = 0, ms = 800, format = fmtNum } = {}) {
  if (RM() || to === from) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const stepFn = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (to - from) * eased);
    if (k < 1 && el.isConnected) requestAnimationFrame(stepFn);
  };
  requestAnimationFrame(stepFn);
}

/** Home-screen reactions: the rings spin-glow, the streak pill wiggles. */
function homeReact(kind) {
  const home = document.getElementById('view-home');
  if (!home || home.hidden || RM()) return;
  const el = kind === 'allRings' ? home.querySelector('.rings-wrap') : home.querySelector('.pill-streak');
  if (!el) return;
  const cls = kind === 'allRings' ? 'spin-glow' : 'wiggle';
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 1200);
}

function newLayer(cls, attrs = '') {
  const layer = document.createElement('div');
  layer.className = `cel-layer ${cls}`;
  if (RM()) layer.classList.add('rm');
  if (isCalm()) layer.classList.add('calm');
  layer.innerHTML = attrs;
  layerRoot().appendChild(layer);
  return layer;
}

/** Dark-sky layers always use the palette's dark colors, even in light mode. */
const darkVars = () => paletteStyle(currentLook().palette, 'dark');

// ---------------------------------------------------------------------------
// L1 "Pop"
// ---------------------------------------------------------------------------

function popInfo(e) {
  switch (e.kind) {
    case 'goal':
      return { title: eventTitle(e), sub: labelOf(e), icon: 'goals', color: 'lime', sound: () => sound.chime(4), haptics: [0, 120, 240], count: 60, stars: 20 };
    case 'pr': return { title: pickLine(e.key, POOL.pr), sub: eventTitle(e), icon: 'trophy', color: 'yellow', sound: () => { sound.chime(3); sound.coin(0.2); }, haptics: [0, 120], count: 50 };
    case 'freeze': return { title: eventTitle(e), sub: 'A missed week won’t break your streak', icon: 'snowflake', color: 'blue', sound: () => sound.ice(), haptics: [0, 120], count: 30 };
    case 'weekMet': {
      const n = store.derived().weekly.toNextFreeze;
      return { title: eventTitle(e), sub: n ? `${plural(n, 'more week')} to a freeze` : '', icon: 'flame', color: 'pink', sound: () => sound.chime(3), haptics: [0, 120], count: 40 };
    }
    case 'weekFilled': return { title: eventTitle(e), icon: 'flame', color: 'pink', sound: () => sound.chime(2), haptics: [0], count: 24 };
    case 'allRings': return { title: eventTitle(e), icon: 'sparkle', color: 'pink', sound: () => sound.ringChord(3), haptics: [0, 120, 240], count: 0, puffs: true };
    case 'ring':
    default: return { title: eventTitle(e), icon: e.ring === 'minutes' ? 'clock' : 'calendar', color: e.ring === 'minutes' ? 'purple' : 'cyan', sound: () => sound.chime(2), haptics: [0], count: 24 };
  }
}

function playPop(e, chips = [], opts, run) {
  const info = popInfo(e);
  const also = chips.map((c) => eventChip(c).text).filter(Boolean);
  let sub = info.sub || '';
  if (also.length) sub = sub ? `${sub} · +${also.length} more` : `Also: ${also.slice(0, 2).join(' · ')}`;
  const spec = e.kind === 'goal' ? shareSpec(e) : null;
  const h = toast(info.title, {
    variant: 'win', icon: info.icon, color: info.color, sub,
    duration: spec ? 6000 : 2800,
    action: spec ? { label: 'Share', fn: () => openShare(spec) } : null,
  });
  info.sound();
  hapticSeq(info.haptics, { inGesture: !!opts.inGesture });
  if (e.kind === 'allRings' || e.kind === 'weekMet') homeReact(e.kind);
  if (!opts.skipConfetti && !RM()) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!h.el?.isConnected) return;
      const r = h.el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + 6;
      const c = colorHex(info.color);
      if (info.puffs) {
        const a = accents();
        [a.A, a.C, a.B].forEach((col, i) => setTimeout(() => confetti({ x: x + (i - 1) * 60, y, count: 16, angle: 90, spread: 60, power: 9, colors: [col, '#FFFFFF'], celebration: true }), i * 120));
      } else if (info.count) {
        confetti({ x, y, count: info.count, angle: 90, spread: 70, power: 10, colors: [c, c, '#FFFFFF', 'A', 'B'], celebration: true });
        if (info.stars) confetti({ x, y, count: info.stars, angle: 90, spread: 80, power: 11, shapes: ['star'], colors: [c, '#FFFFFF', GOLD], celebration: true });
      }
    }));
  }
  return run.wait(900);
}

// ---------------------------------------------------------------------------
// L2 "Cannons"
// ---------------------------------------------------------------------------

function bannerInfo(e) {
  if (e.kind === 'pr') {
    return { kicker: 'PERSONAL RECORD', medal: 'trophy', accent: 'yellow', cannon: ['#FFD43B', 'A', '#FFFFFF'], sound: () => { sound.fanfare(); sound.coin(0.5); } };
  }
  if (e.kind === 'freeze') {
    return { kicker: 'STREAK FREEZE', medal: 'snowflake', accent: 'blue', cannon: null, sound: () => sound.ice() };
  }
  const tier = e.tier === 'medium' ? (e.catchUp ? "LAST MONTH'S GOAL" : 'MONTHLY GOAL') : e.tier === 'short' ? 'WEEKLY GOAL' : 'GOAL';
  return { kicker: tier, medal: 'goals', accent: 'lime', cannon: ['D', 'A', 'B', '#FFFFFF'], sound: () => sound.fanfare() };
}

function playCannons(plan, opts, run) {
  const e = plan.headline;
  const info = bannerInfo(e);
  const calm = isCalm();
  const rm = RM();
  const spec = shareSpec(e);
  const chips = plan.chips.slice(0, 3).map((c) => chipHTML(eventChip(c))).join('')
    + (plan.chips.length > 3 ? `<span class="cel-chip more">+${plan.chips.length - 3} more</span>` : '');
  const title = e.kind === 'pr' ? RECORD_NAMES[e.record] : eventTitle(e);
  const sub = e.kind === 'goal' ? labelOf(e)
    : e.kind === 'freeze' ? 'Miss a week and your streak stays safe.' : '';

  const layer = newLayer(`l2 k-${e.kind}`, `
    <div class="cel-vignette"></div>
    <div class="cel-banner c-${info.accent}" role="status">
      <span class="cb-medal">${icon(info.medal)}</span>
      <span class="cb-text">
        <span class="cb-kicker">${info.kicker}</span>
        <span class="cb-title">${esc(title)}${e.kind === 'pr'
          ? ` · <b class="cb-num" aria-label="${fmtNum(e.value)} ${recordUnit(e.record, e.value)}">${fmtNum(e.prev)}</b> ${recordUnit(e.record, e.value)}` : ''}</span>
        ${e.kind === 'pr' ? `<span class="cb-delta">+${fmtNum(e.value - e.prev)} ${recordUnit(e.record, e.value - e.prev)} · ${esc(pickLine(e.key, POOL.pr))}</span>` : ''}
        ${sub ? `<span class="cb-sub">${esc(sub)}</span>` : ''}
        ${chips ? `<span class="cb-chips">${chips}</span>` : ''}
      </span>
      ${spec ? `<button type="button" class="cb-share icon-btn" aria-label="Share">${icon('share')}</button>` : ''}
    </div>`);
  const el = layer.querySelector('.cel-banner');
  let show = null;
  if (!rm && !calm && e.kind !== 'freeze') {
    const light = document.documentElement.dataset.glowTheme === 'light';
    show = createShow({ parent: layer, level: 2, blend: light ? 'source-over' : 'lighter' });
    layer.querySelector('.cel-vignette').after(show.canvas);
  }

  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  let gone = false;
  let remaining = 4200;
  let started = performance.now();
  let timer = 0;
  const dismiss = (instant = false) => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    if (banner?.el === el) banner = null;
    show?.stop(300);
    layer.classList.add('out');
    setTimeout(() => { layer.remove(); resolveDone(); }, instant ? 0 : 320);
  };
  banner = { el, dismiss };
  run.onEnd(() => dismiss(true));
  timer = setTimeout(dismiss, 4200);

  // Touch pauses the timer; a swipe up dismisses; a tap opens the share preview.
  el.addEventListener('pointerdown', () => { clearTimeout(timer); remaining -= performance.now() - started; });
  el.addEventListener('pointerup', () => { started = performance.now(); timer = setTimeout(dismiss, Math.max(1200, remaining)); });
  onSwipe(el, (dy) => { if (dy < -30) dismiss(); });
  el.addEventListener('click', (ev) => {
    if (!spec) return;
    if (ev.target.closest('.cb-share') || !ev.target.closest('button')) { dismiss(); openShare(spec); }
  });

  // Timeline
  hapticSeq([0, 640], { inGesture: !!opts.inGesture });
  info.sound();
  requestAnimationFrame(() => layer.classList.add('in'));
  if (info.cannon) {
    const W = innerWidth;
    const H = innerHeight;
    const volley = (count, power) => {
      confetti({ x: 0, y: H * 0.92, angle: 62, spread: 26, power, count, colors: info.cannon, celebration: true });
      confetti({ x: W, y: H * 0.92, angle: 118, spread: 26, power, count, colors: info.cannon, celebration: true });
    };
    volley(90, 24);
    if (!calm) run.at(160, () => volley(50, 20));
  } else if (e.kind === 'freeze' && !rm) {
    for (let i = 0; i < 70; i++) {
      run.at((i / 70) * 1200, () => confetti({ x: Math.random() * innerWidth, y: -12, count: 1, angle: 270, spread: 30, power: 2.4,
        shapes: ['snow'], colors: ['#CFE3FF'], gravity: 0.025, ttl: Math.ceil(innerHeight / 1.4), celebration: true }));
    }
  }
  if (show) {
    const sky = skyColors();
    const pop = (fx, dy, colors) => {
      const r = el.getBoundingClientRect();
      show.burst('peony', fx * innerWidth, r.bottom + dy, { colors, scale: 0.72 });
    };
    run.at(500, () => pop(0.22, 60, e.kind === 'pr' ? ['#FFD43B', WHITE] : [sky.D, sky.B]));
    run.at(640, () => pop(0.78, 40, e.kind === 'pr' ? [sky.A, '#FFD43B'] : [sky.A, WHITE]));
  }
  if (e.kind === 'pr') {
    const num = el.querySelector('.cb-num');
    run.at(400, () => {
      countUp(num, e.value, { from: e.prev, ms: 700 });
      sound.tickRoll(Math.min(14, Math.max(4, e.value - e.prev)), 0.7);
    });
  }
  return done;
}

// ---------------------------------------------------------------------------
// L3 "Finale"
// ---------------------------------------------------------------------------

const SHELLS = [
  { t: 150, x: 0.28, apex: 0.30, type: 'peony', colors: (s) => [s.A, s.W] },
  { t: 420, x: 0.72, apex: 0.26, type: 'ring', colors: (s) => [s.B, s.C] },
  { t: 800, x: 0.50, apex: 0.20, type: 'crossette', colors: (s) => [s.D, s.W] },
  { t: 1150, x: 0.18, apex: 0.36, type: 'peony', colors: (s) => [s.C, s.B], glitter: true },
  { t: 1350, x: 0.82, apex: 0.34, type: 'peony', colors: (s) => [s.A, s.W] },
  { t: 2550, x: 0.25, apex: 0.30, type: 'willow', colors: () => [GOLD] },
  { t: 2550, x: 0.75, apex: 0.30, type: 'willow', colors: () => [GOLD] },
  { t: 2650, x: 0.50, apex: 0.22, type: 'heart', colors: (s) => [s.A, s.W], scale: 1.15 },
];

function medalSVG(done = false) {
  const ring = (r, color, i) => {
    const C = (2 * Math.PI * r).toFixed(1);
    return `<circle cx="84" cy="84" r="${r}" fill="none" stroke="${color}" stroke-opacity=".16" stroke-width="14"/>
      <circle class="m-arc" style="--C:${C};--i:${i}" cx="84" cy="84" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${done ? 0 : C}" transform="rotate(-90 84 84)" filter="url(#neon-glow)"/>`;
  };
  return `<svg class="cel-medal-svg${done ? ' closed' : ''}" viewBox="0 0 168 168" width="168" height="168" aria-hidden="true">
    ${ring(70, 'var(--pink)', 0)}${ring(54, 'var(--purple)', 1)}${ring(38, 'var(--cyan)', 2)}
    <path class="m-check" d="M70 85 l10 10 l20 -22" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"
      stroke-dasharray="50" stroke-dashoffset="${done ? 0 : 50}"/>
  </svg>`;
}

function letters(text) {
  let i = 0;
  return text.split(' ').map((word) => `<span class="cl-word">${[...word].map((ch) => `<span class="cl" style="--i:${i++}">${esc(ch)}</span>`).join('')}</span>`).join(' ');
}

/** Stats for a long goal: value, workouts in the window, days since it started. */
function finaleStats(e) {
  if (e.stats) return e.stats; // sample data (Celebration lab)
  const p = store.derived().goals.find((x) => x.id === e.goalId) || store.derived().prevGoals?.find((x) => x.id === e.goalId);
  if (!p) return [];
  const g = p.goal;
  const end = p.achievedOn || store.derived().today;
  const workouts = store.state.workouts.filter((w) => w.date >= p.from && w.date <= end && (!g.typeId || w.type === g.typeId)).length;
  const start = g.start || String(g.createdAt || '').slice(0, 10) || p.from;
  const days = Math.max(1, daysBetween(start, end) + 1);
  const numeric = (v) => Number(goalNum(p.metric, v).replace(/,/g, ''));
  // A workouts goal would show the same number twice, so its middle chip shows time instead.
  let middle = { value: workouts, unit: '', label: workouts === 1 ? 'WORKOUT' : 'WORKOUTS', color: 'purple' };
  if (p.metric === 'workouts') {
    const mins = store.state.workouts.filter((w) => w.date >= p.from && w.date <= end && (!g.typeId || w.type === g.typeId))
      .reduce((sum, w) => sum + (w.duration || 0), 0);
    middle = mins >= 120 ? { value: Math.round(mins / 60), unit: '', label: 'HOURS', color: 'purple' } : { value: mins, unit: '', label: 'MINUTES', color: 'purple' };
  }
  return [
    { value: numeric(p.value), unit: goalUnit(p.metric, p.value), label: 'LOGGED', color: 'pink', decimals: p.metric === 'distance' || p.metric === 'longestDistance' },
    middle,
    { value: days, unit: '', label: days === 1 ? 'DAY' : 'DAYS', color: 'cyan' },
  ];
}

function alsoRowHTML(items, events = []) {
  const badges = (items?.badges || []).slice(0, 5).map((id) => {
    const def = BADGE_BY_ID.get(id);
    return def ? `<button type="button" class="ce-badge" data-badge="${esc(id)}" aria-label="${esc(def.name)}">${badgeSVG(def, { size: 44, className: 'no-glow' })}</button>` : '';
  }).join('');
  const unlocks = (items?.unlocks || []).map((u) => {
    const info = unlockInfo(u);
    const art = info.type === 'palette' ? paletteOrbHTML(info.id, { size: 22, theme: 'dark' }) : holdMiniHTML(info.id, { size: 26 });
    return `<span class="cel-chip unlock">${art}<span>${esc(info.name)}</span><button type="button" class="ce-equip" data-equip="${esc(u)}">Equip</button></span>`;
  }).join('');
  const chips = events.slice(0, 3).map((ev) => chipHTML(eventChip(ev))).join('');
  if (!badges && !unlocks && !chips) return '';
  return `<div class="ce-label">Also earned</div><div class="ce-row">${badges}${unlocks}${chips}</div>`;
}

function playFinale(plan, opts, run) {
  const e = plan.headline;
  const jackpot = plan.jackpot;
  const calm = isCalm();
  const rm = RM();
  const d = store.derived();
  const year = (d.goals.find((x) => x.id === e.goalId)?.achievedOn || d.today).slice(0, 4);
  const kicker = jackpot ? 'TRIPLE WIN' : e.kind === 'goal' && e.tier === 'long' ? `LONG-TERM GOAL · ${year}` : 'BIG WIN';
  const titleText = jackpot ? 'TRIPLE WIN!' : 'GOAL CRUSHED!';
  const sub = jackpot ? `${plural([e, ...plan.chips].filter((x) => x.level >= 2).length, 'big win')} in one go, ${userName()}!`
    : `${pickLine(e.key, POOL.long, { name: userName() })}`;
  const label = jackpot ? '' : labelOf(e);
  const stats = jackpot ? [] : finaleStats(e);
  const allEvents = [e, ...plan.chips];
  const spec = shareSpec(jackpot ? allEvents.find((x) => x.kind === 'goal') || allEvents.find((x) => x.kind === 'pr') : e);
  const prevFocus = document.activeElement;
  if (plan.alsoEarned && !opts.lab) store.markSeen(plan.alsoEarned);

  const layer = newLayer('l3', `
    <div class="cel-sky"><div class="cel-aurora"></div></div>
    <div class="cel-card" role="dialog" aria-modal="true" aria-labelledby="cel-title" style="${darkVars()}">
      <div class="cel-kicker">${esc(kicker)}</div>
      <div class="cel-medal">${medalSVG(calm || rm)}</div>
      <h2 id="cel-title" class="cel-title" aria-label="${esc(titleText)}"><span aria-hidden="true">${letters(titleText)}</span></h2>
      <p class="cel-sub">${esc(sub)}${label ? `<span class="cel-goal">${esc(label)}</span>` : ''}</p>
      ${stats.length ? `<div class="cel-stats">${stats.map((s, i) => `
        <div class="cel-stat c-${s.color}" style="--i:${i}"><b data-to="${s.value}" data-dec="${s.decimals ? 1 : 0}" aria-label="${fmtNum(s.value)} ${esc(s.unit)}">0</b>${s.unit ? ` <small>${esc(s.unit)}</small>` : ''}<span>${s.label}</span></div>`).join('')}</div>`
        : jackpot ? `<div class="cel-stats chips">${allEvents.filter((x) => x.level >= 2).slice(0, 3).map((x, i) => chipHTML(eventChip(x), `style="--i:${i}"`)).join('')}</div>` : ''}
      <div class="cel-also">${alsoRowHTML(plan.alsoEarned, jackpot ? allEvents.filter((x) => x.level < 2) : plan.chips)}</div>
      <div class="cel-actions">
        ${spec ? `<button type="button" class="btn btn-claim" data-act="share">${icon('share')} Share your win</button>` : ''}
        <button type="button" class="btn btn-ghost" data-act="close">Keep glowing</button>
      </div>
    </div>`);
  layer.style.setProperty('--sky-a', skyColors().A);
  const card = layer.querySelector('.cel-card');
  let show = null;
  if (!rm) {
    show = createShow({ parent: layer, level: 3, blend: 'lighter' });
    layer.querySelector('.cel-sky').after(show.canvas);
  }

  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  let closed = false;
  let heroAt = 0;
  const shellTimers = [];
  const close = (instant = false) => {
    if (closed) return;
    closed = true;
    unKeys();
    show?.stop(300);
    layer.classList.add('out');
    setTimeout(() => {
      layer.remove();
      if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
      resolveDone();
    }, instant ? 0 : 380);
  };
  run.onEnd(() => close(true));
  const unKeys = modalKeys(layer, () => close());

  // Sound + haptics
  sound.swell();
  hapticSeq([0], { inGesture: !!opts.inGesture });

  const sky = skyColors();
  const launch = (s, scale = 1) => show?.launch({ x: s.x, apexY: s.apex, type: s.type, colors: s.colors(sky), scale: (s.scale || 1) * scale, glitter: s.glitter });

  // The hero card and its staged reveal.
  const hero = () => {
    if (heroAt) return;
    heroAt = performance.now();
    layer.classList.add('hero');
    const tick = (ms, fn) => run.at(rm ? 0 : ms, fn);
    tick(900, () => {
      layer.querySelectorAll('.cel-stat b').forEach((b) => {
        const dec = b.dataset.dec === '1';
        countUp(b, Number(b.dataset.to), { ms: 800, format: (v) => (dec ? (Math.round(v * 10) / 10).toString() : fmtNum(v)) });
      });
      if (stats.length) sound.tickRoll(10, 0.8);
    });
    tick(1500, () => {
      layer.classList.add('actions');
      layer.querySelector('[data-act="share"]')?.focus({ preventScroll: true }) || layer.querySelector('[data-act="close"]')?.focus({ preventScroll: true });
    });
  };

  if (calm || rm) {
    // Calm / reduced motion: the sky and the hero card with rings already closed.
    requestAnimationFrame(() => layer.classList.add('in'));
    hero();
    if (!rm) run.at(200, () => confetti({ x: innerWidth / 2, y: -20, count: 120, angle: 270, spread: 40, power: 4, celebration: true }));
    sound.chord();
  } else {
    requestAnimationFrame(() => layer.classList.add('in'));
    for (const s of SHELLS) shellTimers.push({ s, t: run.at(s.t, () => launch(s)) });
    run.at(2000, hero);
    // Finale salutes, flash, thump, chord, confetti rain.
    run.at(3500, () => {
      show?.burst('salute', innerWidth * 0.35, innerHeight * 0.18, { colors: [WHITE, sky.B] });
      show?.burst('salute', innerWidth * 0.65, innerHeight * 0.18, { colors: [WHITE, sky.B], sound: false });
      layer.querySelector('.cel-sky')?.classList.add('flash');
      layer.querySelector('.cel-medal')?.classList.add('thump');
      sound.thump();
      sound.chord();
      hapticSeq([0, 120, 240]);
    });
    for (let b = 0; b < 4; b++) {
      run.at(3600 + b * 150, () => confetti({ x: innerWidth * (0.15 + Math.random() * 0.7), y: -20, count: 35, angle: 270, spread: 40, power: 3 + Math.random() * 2, celebration: true }));
    }
    // Ambient shells until 12 s.
    const ambient = () => {
      if (closed || performance.now() - t0 > 12000) return;
      const pick = Math.random() < 0.6 ? 'peony' : 'ring';
      launch({ x: 0.2 + Math.random() * 0.6, apex: 0.18 + Math.random() * 0.2, type: pick, colors: (s) => (Math.random() < 0.5 ? [s.A, s.W] : [s.B, s.C]) }, 0.85);
      run.at(1600 + Math.random() * 800, ambient);
    };
    const t0 = performance.now();
    run.at(3600, ambient);
  }

  // Fast-forward: a tap on the sky before the hero shows skips ahead.
  layer.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'share') { close(); openShare(spec); return; }
    if (act === 'close') { close(); return; }
    const eq = ev.target.closest('[data-equip]');
    if (eq && opts.lab) { if (eq.hasAttribute('data-and-close')) close(); return; } // sample unlocks can't be equipped
    if (eq) {
      const info = unlockInfo(eq.dataset.equip);
      equipLook({ [info.type]: info.id }, eq);
      eq.textContent = 'Equipped';
      eq.disabled = true;
      return;
    }
    const b = ev.target.closest('[data-badge]');
    if (b) { close(); import('./views/trophies.js').then((m) => m.openBadgeDetail(b.dataset.badge)).catch(() => {}); return; }
    if (ev.target.closest('.cel-card')) return;
    if (!heroAt) {
      for (const { t } of shellTimers) clearTimeout(t);
      const now = performance.now() - layer.dataset.t0;
      SHELLS.filter((s) => s.t > now).forEach((s) => launch(s, 0.5));
      hero();
    } else if (performance.now() - heroAt > 1500) {
      close();
    }
  });
  layer.dataset.t0 = performance.now();
  onSwipe(card, (dy) => { if (dy > 90 && heroAt) close(); });
  card.setAttribute('tabindex', '-1');
  card.focus({ preventScroll: true });
  return done;
}

// ---------------------------------------------------------------------------
// Beat B: the badge / unlock reveal
// ---------------------------------------------------------------------------

function workoutNumber(on) {
  return store.state.workouts.filter((w) => w.date <= on).length;
}

function badgeInfoHTML(def) {
  const rec = store.awards.badges[def.id];
  const on = rec?.on;
  const flavor = String(def.flavor || def.how || '').replace(/\{name\}/g, userName());
  const n = on ? workoutNumber(on) : 0;
  return `
    <div class="rv-rarity r-${def.rarity}">${esc(RARITY_LABEL[def.rarity].toUpperCase())} BADGE</div>
    <h2 class="rv-name" id="rv-name">${esc(def.name)}</h2>
    <p class="rv-flavor">${esc(flavor)}</p>
    ${on ? `<p class="rv-when">${esc(fmtDay(on))}${n ? ` · Workout #${fmtNum(n)}` : ''}</p>` : ''}`;
}

function unlockHeroHTML(u) {
  const info = unlockInfo(u);
  return info.type === 'palette'
    ? `<div class="rv-orb">${paletteOrbHTML(info.id, { size: 140, theme: 'dark' })}</div>`
    : `<div class="rv-mini">${holdMiniHTML(info.id, { size: 112, holdable: true, label: 'Hold to test' })}</div>`;
}

/**
 * The reveal. `items` = { badges: [ids], unlocks: [uids], also: [events] }.
 * Resolves when she closes it.
 */
function playReveal(items, opts, run) {
  const badges = (items.badges || []).map((id) => BADGE_BY_ID.get(id)).filter(Boolean);
  const unlocks = items.unlocks || [];
  const also = items.also || [];
  if (!badges.length && !unlocks.length) return Promise.resolve();
  const calm = isCalm();
  const rm = RM();
  const hero = badges[0] || null;
  const unlockOnly = !hero;
  const firstEver = hero?.id === 'w1' && store.state.workouts.length <= 1;
  const legendary = hero?.rarity === 'legendary';
  const epic = hero?.rarity === 'epic';
  const prevFocus = document.activeElement;

  // Mark everything shown as seen as soon as it opens.
  if (!opts.lab) store.markSeen({ badges: badges.map((b) => b.id), unlocks });

  const firstUnlock = unlockOnly ? unlockInfo(unlocks[0]) : null;
  const kicker = firstEver ? 'WELCOME TO GLOW' : hero ? (badges.length > 1 ? `${badges.length} NEW BADGES` : 'NEW BADGE')
    : firstUnlock.type === 'palette' ? 'NEW THEME UNLOCKED' : 'NEW BUTTON UNLOCKED';
  const rest = badges.slice(1);
  const minis = rest.slice(0, 5).map((d) => `<button type="button" class="rv-mini-badge" data-hero="${esc(d.id)}" aria-label="${esc(d.name)}">${badgeSVG(d, { size: 44, className: 'no-glow' })}</button>`).join('')
    + (rest.length > 5 ? `<button type="button" class="rv-more" data-act="case">+${rest.length - 5}</button>` : '');
  const unlockRows = (unlockOnly ? unlocks.slice(1) : unlocks).map((u) => {
    const info = unlockInfo(u);
    const art = info.type === 'palette' ? paletteOrbHTML(info.id, { size: 28, theme: 'dark' }) : holdMiniHTML(info.id, { size: 32 });
    return `<div class="rv-unlock">${art}<span>Unlocked: <b>${esc(info.name)}</b> ${info.type === 'palette' ? 'theme' : 'button'}</span><button type="button" class="btn btn-secondary btn-small" data-equip="${esc(u)}">Equip</button></div>`;
  }).join('');
  const colors = hero ? badgeColors(hero) : ['pink', 'cyan'];

  const layer = newLayer(`reveal${legendary ? ' legendary' : ''}${unlockOnly ? ' unlock-only' : ''}`, `
    <div class="rv-scrim"></div>
    <div class="rv-wrap" role="dialog" aria-modal="true" aria-labelledby="rv-name" style="${darkVars()}">
      <div class="rv-kicker">${esc(kicker)}</div>
      <div class="rv-stage">
        <div class="rv-rays"></div>
        <svg class="rv-charge" viewBox="0 0 400 400" aria-hidden="true"><circle cx="200" cy="200" r="150"/></svg>
        <div class="rv-flash"></div>
        ${hero ? `<div class="rv-card">
          <div class="rv-face rv-front">${badgeSVG(hero, { state: hero.secret ? 'secret' : 'locked', size: 176 })}</div>
          <div class="rv-face rv-back">${badgeSVG(hero, { size: 176, label: hero.name })}</div>
        </div>` : unlockHeroHTML(unlocks[0])}
      </div>
      <div class="rv-info">${hero ? badgeInfoHTML(hero) : `<h2 class="rv-name" id="rv-name">${esc(firstUnlock.name)}</h2>
        <p class="rv-flavor">${firstUnlock.type === 'palette' ? 'A whole new glow for the app.' : 'A new look for your hold button. Hold it to test.'}</p>`}</div>
      ${also.length ? `<div class="rv-also">${also.slice(0, 3).map((ev) => chipHTML(eventChip(ev))).join('')}</div>` : ''}
      ${minis ? `<div class="rv-minis">${minis}</div>` : ''}
      ${unlockRows ? `<div class="rv-unlocks">${unlockRows}</div>` : ''}
      <div class="rv-actions">
        ${unlockOnly
          ? `<button type="button" class="btn btn-ghost" data-act="close">Later</button>
             <button type="button" class="btn btn-primary" data-equip="${esc(unlocks[0])}" data-and-close>Equip now</button>`
          : `<button type="button" class="btn btn-secondary" data-act="share">${icon('share')} Share</button>
             <button type="button" class="btn btn-primary" data-act="close">Awesome</button>`}
      </div>
    </div>`);
  const wrap = layer.querySelector('.rv-wrap');
  wrap.style.setProperty('--b1', `var(--${colors[0]})`);
  wrap.style.setProperty('--b2', `var(--${colors[1]})`);
  const skyHex = (name) => hexOf(name, currentLook().palette);
  const stage = layer.querySelector('.rv-stage');
  bindHoldMinis(layer);

  let show = null;
  if (!rm) {
    show = createShow({ parent: layer, level: legendary ? 3 : 2, blend: 'lighter' });
    layer.querySelector('.rv-scrim').after(show.canvas);
  }
  const center = () => {
    const r = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  let closed = false;
  let openedAt = performance.now();
  let currentHero = hero;
  const close = (instant = false) => {
    if (closed) return;
    closed = true;
    unKeys();
    show?.stop(260);
    if (!instant && !rm && currentHero) flyToProfile(layer.querySelector('.rv-back .badge-art'));
    layer.classList.add('out');
    setTimeout(() => {
      layer.remove();
      if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
      resolveDone();
    }, instant ? 0 : 300);
  };
  run?.onEnd(() => close(true));
  const unKeys = modalKeys(layer, () => close());

  // Timeline
  const skip = calm || rm || unlockOnly ? 280 : 0; // no charge phase
  const T = (ms) => Math.max(0, ms - skip);
  const at = (ms, fn) => (run ? run.at(T(ms), fn) : setTimeout(fn, T(ms)));
  requestAnimationFrame(() => layer.classList.add('in'));
  at(60, () => layer.classList.add('enter'));
  if (!skip) {
    at(280, () => {
      layer.classList.add('charge');
      sound.sweep();
      const c = center();
      show?.sparks({ x: c.x, y: c.y, n: 18, inward: true, radius: 160, colors: [WHITE, skyHex(colors[0])] });
    });
  }
  at(560, () => layer.classList.add('flip'));
  at(820, () => {
    layer.classList.add('mid');
    const c = center();
    sound.bell();
    haptic('success');
    if (unlockOnly) sound.shimmer();
    if (!rm) {
      const b1 = skyHex(colors[0]);
      const b2 = skyHex(colors[1]);
      show?.sparks({ x: c.x, y: c.y, n: 28, colors: [b1, b2, WHITE], v: [2, 5], ttl: 40 });
      const n = { common: 40, rare: 70, epic: 110, legendary: 150 }[hero?.rarity || 'rare'];
      confetti({ x: c.x, y: c.y, count: n, angle: 90, spread: 120, power: 12, colors: [b1, b2, '#FFFFFF'], shapes: ['rect', 'circle', 'star'], celebration: true });
      if (!calm && (epic || legendary)) {
        const sky = skyColors();
        show?.burst('peony', c.x, c.y, { colors: [b1, WHITE], scale: 0.8, sound: false });
        sound.shimmer();
        if (legendary) {
          layer.classList.add('sky');
          [[-120, -80], [120, -80], [0, -150]].forEach(([dx, dy], i) => setTimeout(() => {
            if (!closed) show?.burst('peony', c.x + dx, c.y + dy, { colors: [i === 1 ? sky.B : sky.A, GOLD], scale: 0.7 });
          }, 120 + i * 180));
        }
      }
    }
  });
  at(1000, () => layer.classList.add('rays'));
  at(1080, () => layer.classList.add('info'));
  at(1400, () => layer.classList.add('minis'));
  at(1500, () => layer.classList.add('unlocks'));
  at(1600, () => {
    layer.classList.add('actions');
    layer.querySelector('.rv-actions .btn-primary')?.focus({ preventScroll: true });
  });

  layer.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') { close(); return; }
    if (act === 'share' && currentHero) { close(true); openShare({ kind: 'badge', id: currentHero.id }); return; }
    if (act === 'case') { close(true); import('./views/trophies.js').then((m) => m.openTrophyCase()).catch(() => {}); return; }
    const eq = ev.target.closest('[data-equip]');
    if (eq && opts.lab) { if (eq.hasAttribute('data-and-close')) close(); return; } // sample unlocks can't be equipped
    if (eq) {
      const info = unlockInfo(eq.dataset.equip);
      equipLook({ [info.type]: info.id }, eq);
      if (eq.hasAttribute('data-and-close')) { close(); return; }
      eq.textContent = 'Equipped';
      eq.disabled = true;
      return;
    }
    const mini = ev.target.closest('[data-hero]');
    if (mini) {
      const def = BADGE_BY_ID.get(mini.dataset.hero);
      if (!def || def === currentHero) return;
      // Swap it into the hero spot.
      mini.innerHTML = badgeSVG(currentHero, { size: 44, className: 'no-glow' });
      mini.dataset.hero = currentHero.id;
      mini.setAttribute('aria-label', currentHero.name);
      currentHero = def;
      const back = layer.querySelector('.rv-back');
      const info = layer.querySelector('.rv-info');
      back.classList.add('swap');
      info.classList.add('swap');
      setTimeout(() => {
        back.innerHTML = badgeSVG(def, { size: 176, label: def.name });
        info.innerHTML = badgeInfoHTML(def);
        const [c1, c2] = badgeColors(def);
        wrap.style.setProperty('--b1', `var(--${c1})`);
        wrap.style.setProperty('--b2', `var(--${c2})`);
        back.classList.remove('swap');
        info.classList.remove('swap');
      }, 200);
      sound.tap();
      return;
    }
    if (!ev.target.closest('.rv-wrap button, .hold-mini') && performance.now() - openedAt > 1100 - skip) close();
  });
  wrap.setAttribute('tabindex', '-1');
  wrap.focus({ preventScroll: true });
  return done;
}

/** The hero badge flies down into the Profile tab, which bounces. */
function flyToProfile(art) {
  const tab = document.querySelector('.tab[data-tab="profile"] .tab-icon');
  if (!art || !tab) return;
  const a = art.getBoundingClientRect();
  const b = tab.getBoundingClientRect();
  const ghost = art.cloneNode(true);
  ghost.classList.add('rv-ghost');
  Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.appendChild(ghost);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = ghost.animate(
    [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0.6 }],
    { duration: 520, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' },
  );
  anim.onfinish = () => {
    ghost.remove();
    tab.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
  };
}

// ---------------------------------------------------------------------------
// Unseen rewards (Home gift pill) and the one-time intro
// ---------------------------------------------------------------------------

/** Play the reveal for everything she hasn't seen yet. Call from a tap. */
export function revealUnseen() {
  unlockAudio();
  const rw = store.rewards();
  const order = { legendary: 3, epic: 2, rare: 1, common: 0 };
  const badges = [...rw.unseen.badges].sort((a, b) => order[BADGE_BY_ID.get(b).rarity] - order[BADGE_BY_ID.get(a).rarity]);
  celebrate({ level: 0, headline: null, chips: [], reveal: { badges, unlocks: rw.unseen.unlocks, also: [], delay: 0 } }, { inGesture: true });
}

/**
 * The one-time "your Trophy Case is ready" gift after the first-launch backfill.
 * Tap to open (the tap also unlocks iOS audio).
 */
export function playIntro({ sample = null } = {}) {
  if (active) return;
  const run = makeRun();
  active = run;
  const rw = store.rewards();
  const earned = sample ? sample.badges.map((id) => BADGE_BY_ID.get(id)).filter(Boolean) : Object.keys(store.awards.badges)
    .map((id) => BADGE_BY_ID.get(id)).filter(Boolean)
    .sort((a, b) => String(store.awards.badges[a.id].on).localeCompare(String(store.awards.badges[b.id].on)));
  const unlocks = sample ? sample.unlocks : rw.unseen.unlocks;
  const prevFocus = document.activeElement;
  const layer = newLayer('intro', `
    <div class="cel-sky"><div class="cel-aurora"></div></div>
    <div class="in-wrap" role="dialog" aria-modal="true" aria-labelledby="in-title" style="${darkVars()}">
      <button type="button" class="in-skip icon-btn" data-act="skip" aria-label="Skip">${icon('close')}</button>
      <button type="button" class="in-gift" data-act="open">
        <span class="in-orb">${icon('gift')}</span>
        <span class="in-title" id="in-title">${esc(userName())}, your Trophy Case is ready</span>
        <span class="in-tap">Tap to open</span>
      </button>
      <div class="in-case" hidden>
        <div class="in-count" aria-live="polite"></div>
        <div class="in-grid">${earned.map((d, i) => `<span class="in-badge" style="--i:${Math.min(i, 12)}" title="${esc(d.name)}">${badgeSVG(d, { size: 64, className: 'no-glow' })}</span>`).join('')}</div>
        ${unlocks.length ? `<div class="in-unlocks"><span>+${plural(unlocks.length, 'look')} unlocked</span>${unlocks.map((u) => {
          const info = unlockInfo(u);
          return info.type === 'palette' ? paletteOrbHTML(info.id, { size: 26, theme: 'dark' }) : holdMiniHTML(info.id, { size: 30 });
        }).join('')}</div>` : ''}
        <div class="in-actions">
          <button type="button" class="btn btn-primary" data-act="case">Open Trophy Case</button>
          ${unlocks.length ? `<button type="button" class="btn btn-secondary" data-act="studio">Try a new look</button>` : ''}
          <button type="button" class="btn btn-ghost" data-act="later">Later</button>
        </div>
      </div>
    </div>`);
  requestAnimationFrame(() => layer.classList.add('in'));
  let closed = false;
  const close = (instant = false) => {
    if (closed) return;
    closed = true;
    unKeys();
    if (!sample) store.markSeen({ badges: earned.map((d) => d.id), unlocks, intro: true });
    layer.classList.add('out');
    setTimeout(() => {
      layer.remove();
      if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
      run.end();
      active = null;
      lastEnd = Date.now();
      flushToasts();
      document.dispatchEvent(new CustomEvent('glow:celebration-end'));
    }, instant ? 0 : 320);
  };
  run.onEnd(() => close(true));
  const unKeys = modalKeys(layer, () => close());
  layer.querySelector('.in-gift').focus({ preventScroll: true });

  const open = () => {
    unlockAudio();
    const orb = layer.querySelector('.in-orb').getBoundingClientRect();
    layer.classList.add('opened');
    haptic('success');
    sound.chime(4);
    confetti({ x: orb.left + orb.width / 2, y: orb.top + orb.height / 2, count: 80, spread: 120, power: 12, celebration: true });
    setTimeout(() => {
      layer.querySelector('.in-gift').hidden = true;
      layer.querySelector('.in-case').hidden = false;
      const n = earned.length;
      const stagger = Math.min(70, 2500 / Math.max(1, n));
      layer.querySelectorAll('.in-badge').forEach((el, i) => {
        el.style.animationDelay = `${i < 12 ? i * stagger : 12 * stagger}ms`;
        if (i < 12) setTimeout(() => sound.introTick(i), i * stagger);
      });
      const count = layer.querySelector('.in-count');
      count.innerHTML = `You've already earned <b>0</b> ${n === 1 ? 'badge' : 'badges'}!`;
      countUp(count.querySelector('b'), n, { ms: Math.min(2500, 12 * stagger + 300) });
      setTimeout(() => layer.querySelector('[data-act="case"]')?.focus({ preventScroll: true }), Math.min(2500, n * stagger) + 300);
    }, RM() ? 0 : 300);
  };

  layer.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'open') open();
    else if (act === 'skip' || act === 'later') close();
    else if (act === 'case') { close(true); import('./views/trophies.js').then((m) => m.openTrophyCase()).catch(() => {}); }
    else if (act === 'studio') { close(true); import('./studio.js').then((m) => m.openStudio()).catch(() => {}); }
  });
}
