// Celebration lab: try every celebration, share card and the Year in Glow with sample
// data. Opened by tapping the version line on Profile five times. Nothing here is saved.

import { store } from './store.js';
import { openSheet } from './sheet.js';
import { buildPlan, collect } from './rewards.js';
import { celebrate, playIntro, openShare } from './celebrate.js';
import { unlockAudio } from './effects.js';
import { todayKey, addDaysKey, parseKey } from './dates.js';
import { defaultState } from './schema.js';
import { derive, weekKeyOf } from './progress.js';
import { buildIndex, yearRecap } from './insights.js';
import { goalLabel, toggle } from './components.js';
import { icon } from './icons.js';

const today = () => todayKey();
let n = 0;
const key = (k) => `${k}:lab${++n}`;

const SAMPLE_GOALS = {
  short: { id: 'lab-short', tier: 'short', metric: 'workouts', target: 3, name: '' },
  medium: { id: 'lab-medium', tier: 'medium', metric: 'minutes', target: 600, name: '' },
  long: { id: 'lab-long', tier: 'long', metric: 'workouts', target: 150, start: `${today().slice(0, 4)}-01-01`, end: `${today().slice(0, 4)}-12-31`, name: '' },
};

const EV = {
  ring: () => ({ kind: 'ring', ring: 'minutes', key: key('ring') }),
  weekFilled: () => ({ kind: 'weekFilled', streak: 3, key: key('fill') }),
  weekMet: () => ({ kind: 'weekMet', streak: 5, key: key('week') }),
  allRings: () => ({ kind: 'allRings', key: key('rings') }),
  short: () => ({ kind: 'goal', tier: 'short', goal: SAMPLE_GOALS.short, goalId: 'lab-short', key: key('goal:lab-short:W') }),
  medium: () => ({ kind: 'goal', tier: 'medium', goal: SAMPLE_GOALS.medium, goalId: 'lab-medium', key: `goal:lab-medium:M:${today().slice(0, 7)}:${++n}` }),
  pr: () => ({ kind: 'pr', record: 'longestWorkout', value: 95, prev: 80, key: key('pr:longestWorkout') }),
  freeze: () => ({ kind: 'freeze', freezes: 1, key: key('freeze') }),
  long: () => ({
    kind: 'goal', tier: 'long', goal: SAMPLE_GOALS.long, goalId: 'lab-long', key: key('goal:lab-long:L'),
    stats: [
      { value: 150, unit: 'workouts', label: 'LOGGED', color: 'pink' },
      { value: 112, unit: '', label: 'HOURS', color: 'purple' },
      { value: 283, unit: '', label: 'DAYS', color: 'cyan' },
    ],
  }),
};

function plan(events, { badges = [], unlocks = [] } = {}) {
  return buildPlan({ fresh: events, badges: Object.fromEntries(badges.map((id) => [id, {}])), newUnlocks: unlocks, repeats: [] }, { lastEndAt: 0, now: Date.now() });
}

const ITEMS = [
  ['Small wins', [
    ['Ring closed', () => plan([EV.ring()])],
    ['Week filled in', () => plan([EV.weekFilled()])],
    ['Week locked in', () => plan([EV.weekMet()])],
    ['All rings', () => plan([EV.allRings()])],
    ['Weekly goal', () => plan([EV.short(), EV.weekMet()])],
  ]],
  ['Big wins', [
    ['Monthly goal', () => plan([EV.medium(), EV.allRings()])],
    ['New PR', () => plan([EV.pr()])],
    ['Freeze banked', () => plan([EV.freeze()])],
    ['Monthly + badges', () => plan([EV.medium(), EV.allRings()], { badges: ['w100', 'm600'], unlocks: ['skin:lava'] })],
  ]],
  ['Finale', [
    ['Long-term goal', () => plan([EV.long(), EV.weekMet()], { badges: ['g1', 'w50'], unlocks: ['palette:gold', 'skin:holo'] })],
    ['Triple win', () => plan([EV.medium(), EV.pr(), EV.freeze()])],
  ]],
  ['Reveals', [
    ['Common badge', () => plan([], { badges: ['w5'] })],
    ['Rare badge', () => plan([], { badges: ['w25'] })],
    ['Epic badge', () => plan([], { badges: ['w100', 'ws4', 'w10'] })],
    ['Legendary badge', () => plan([], { badges: ['w250'] })],
    ['New theme', () => plan([], { unlocks: ['palette:sunset'] })],
    ['New button', () => plan([], { unlocks: ['skin:heartbeat'] })],
    ['Welcome (1st log)', () => plan([EV.weekFilled()], { badges: ['w1'] })],
  ]],
];

const SHARES = [
  ['Weekly goal card', () => ({ kind: 'goal', snapshot: { kind: 'goal', tier: 'short', on: today(), goalId: 'lab-short', label: '3 workouts this week', metric: 'workouts', target: 3, value: 4 } })],
  ['Monthly goal card', () => ({ kind: 'goal', snapshot: { kind: 'goal', tier: 'medium', on: today(), goalId: 'lab-medium', label: '600 min this month', metric: 'minutes', target: 600, value: 612 } })],
  ['Long-term card', () => ({ kind: 'goal', snapshot: { kind: 'goal', tier: 'long', on: today(), goalId: 'lab-long', label: `150 workouts in ${today().slice(0, 4)}`, metric: 'workouts', target: 150, value: 150 } })],
  ['Badge card', () => ({ kind: 'badge', id: 'w100', snapshot: { on: today() } })],
  ['PR card', () => ({ kind: 'pr', snapshot: { kind: 'pr', on: today(), record: 'longestWorkout', value: 95, prev: 80 } })],
];

// ---------------------------------------------------------------------------
// Year in Glow sample: a seeded, realistic year (pure; the store is only read for her
// name, week start, units and workout types)
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOTES = ['Sunrise loop, legs felt amazing', 'New hill, conquered', 'Rainy but did it anyway', 'Class with Jess!',
  'Felt strong today', 'Longest one yet. So proud', 'Slow and steady', 'Beach walk with the dog', 'Tried the new playlist', 'Back at it'];
const MOODS = ['💪', '💪', '🔥', '😄', '🤩', '🙂', '😮‍💨'];
const DOW_P = [0.4, 0.58, 0.36, 0.56, 0.34, 0.3, 0.72]; // Sun…Sat
const MONTH_K = [1.15, 1, 1.05, 1, 1.1, 1.15, 1, 0.55, 1.1, 1.1, 0.9, 0.85];
const DUR = { run: [25, 30], ride: [40, 50], walk: [30, 40], strength: [30, 25], yoga: [30, 35], hiit: [18, 15] };
const PACE = { run: 6.2, ride: 2.6, walk: 11 }; // minutes per km

/** PR wins as the live app would have recorded them through the year (longest workout, best week, best month). */
function samplePRs(state, ws) {
  const wins = {};
  const list = [...state.workouts].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  let best = 0;
  let seen = 0;
  for (const w of list) {
    if (!w.duration) continue;
    if (w.duration > best && seen >= 3 && best > 0) wins[`pr:longestWorkout:${w.id}`] = { kind: 'pr', on: w.date, record: 'longestWorkout', value: w.duration, prev: best };
    best = Math.max(best, w.duration);
    seen++;
  }
  for (const [record, keyOf, prior] of [['bestWeek', (d) => weekKeyOf(d, ws), 2], ['bestMonth', (d) => d.slice(0, 7), 2]]) {
    const sums = new Map();
    for (const w of list) {
      const k = keyOf(w.date);
      const e = sums.get(k) || { value: 0, on: w.date };
      e.value += w.duration || 0;
      e.on = w.date;
      sums.set(k, e);
    }
    let top = 0;
    let n = 0;
    for (const [k, e] of [...sums].sort(([a], [b]) => a.localeCompare(b))) {
      if (e.value > top && n >= prior && top > 0) wins[`pr:${record}:${k}`] = { kind: 'pr', on: e.on, record, value: e.value, prev: top };
      top = Math.max(top, e.value);
      n++;
    }
  }
  return wins;
}

/**
 * A seeded sample state for one year (about 180 workouts with types, durations, distances,
 * times, feel, moods, notes and rest days) plus a ledger of the wins and badges it earned.
 * @param {number|string} year
 */
export function sampleYearState(year) {
  const Y = Number(year);
  const rnd = mulberry32(Y * 7919);
  const base = defaultState();
  const her = store.settings;
  const types = (her.types || base.settings.types).filter((t) => !t.archived);
  const prefer = ['run', 'yoga', 'ride', 'strength', 'walk', 'hiit'];
  const ordered = [...prefer.map((id) => types.find((t) => t.id === id)).filter(Boolean), ...types.filter((t) => !prefer.includes(t.id))];
  const weights = [0.3, 0.2, 0.16, 0.14, 0.12, 0.08];
  const pickType = () => {
    let x = rnd() * weights.slice(0, ordered.length).reduce((a, b) => a + b, 0);
    for (let i = 0; i < Math.min(ordered.length, weights.length); i++) { x -= weights[i]; if (x <= 0) return ordered[i]; }
    return ordered[0];
  };
  const pad = (n) => String(n).padStart(2, '0');
  const workouts = [];
  const restDays = [];
  const add = (date, extra = {}) => {
    const t = extra.type || pickType();
    const [lo, span] = DUR[t.id] || [30, 30];
    let duration = Math.round((lo + rnd() * span) / 5) * 5;
    if (rnd() < 0.025) duration = 95 + Math.round(rnd() * 5) * 5;
    const r = rnd();
    const hh = r < 0.55 ? 6 + Math.floor(rnd() * 2) : r < 0.7 ? 12 : 18 + Math.floor(rnd() * 2);
    const time = `${pad(hh)}:${pad(Math.floor(rnd() * 4) * 15)}`;
    const f = rnd();
    const feel = rnd() < 0.72 ? (f < 0.03 ? 1 : f < 0.1 ? 2 : f < 0.3 ? 3 : f < (t.id === 'yoga' ? 0.5 : 0.68) ? 4 : 5) : null;
    workouts.push({
      id: `lab-${Y}-${workouts.length}`, type: t.id, date, time, duration,
      distanceKm: PACE[t.id] && t.distance ? Math.round((duration / PACE[t.id]) * 10) / 10 : null,
      feel, mood: rnd() < 0.4 ? MOODS[Math.floor(rnd() * MOODS.length)] : null,
      note: rnd() < 0.08 ? NOTES[Math.floor(rnd() * NOTES.length)] : '',
      createdAt: `${date}T${time}:00`, updatedAt: `${date}T${time}:00`, ...extra.patch,
    });
  };
  const end = `${Y}-12-31` < todayKey() ? `${Y}-12-31` : todayKey();
  for (let d = `${Y}-01-01`; d <= end; d = addDaysKey(d, 1)) {
    const dt = parseKey(d);
    const hot = d >= `${Y}-03-02` && d <= `${Y}-03-13`; // a 12-day run
    const p = d.endsWith('-01-01') || hot ? 1 : DOW_P[dt.getDay()] * MONTH_K[dt.getMonth()];
    if (rnd() < p) {
      add(d);
      if (rnd() < 0.05) add(d, { patch: { time: '19:30', createdAt: `${d}T19:30:00` } });
    } else if (rnd() < 0.13) restDays.push(d);
  }
  const at = `${Y}-01-01T08:00:00.000Z`;
  const settings = {
    ...base.settings, name: her.name, weekStart: her.weekStart, units: her.units, types: her.types || base.settings.types,
    targets: { ...her.targets }, targetHistory: [{ from: '2000-01-01', ...her.targets }],
  };
  const goals = [
    { id: 'lab-wk', tier: 'short', metric: 'workouts', target: 3, typeId: null, start: null, end: null, name: '', createdAt: at, updatedAt: at, archivedAt: null },
    { id: 'lab-mo', tier: 'medium', metric: 'minutes', target: 600, typeId: null, start: null, end: null, name: '', createdAt: at, updatedAt: at, archivedAt: null },
    { id: 'lab-yr', tier: 'long', metric: 'workouts', target: 150, typeId: null, start: `${Y}-01-01`, end: `${Y}-12-31`, name: '', createdAt: at, updatedAt: at, archivedAt: null },
  ];
  const state = { ...base, settings, workouts, restDays, goals, awards: { ...base.awards, wins: {}, badges: {} } };
  const today = todayKey();
  const prWins = samplePRs(state, settings.weekStart);
  const d0 = derive(state, today);
  const res = collect(state, d0, { wins: prWins, badges: {} }, { today, mode: 'backfill', now: at, label: goalLabel, seen: true });
  state.awards = { ...state.awards, wins: { ...prWins, ...res.wins }, badges: res.badges, backfilledAt: at };
  return state;
}

let sampleCache = null;

/** The yearRecap() model for a sample year (built once per session). */
export function sampleYearModel(year) {
  const Y = String(year);
  if (sampleCache?.year === Y) return sampleCache.model;
  const state = sampleYearState(Y);
  const today = todayKey();
  const d = derive(state, today);
  const model = yearRecap(state, d, Y, today, buildIndex(state, today, d));
  sampleCache = { year: Y, model };
  return model;
}

let chartsOff = false;

export function openLab() {
  const sheet = openSheet({
    title: 'Celebration lab',
    className: 'lab-sheet',
    body: `
      <p class="muted small">Try every celebration with sample data. Nothing here is saved.</p>
      ${ITEMS.map(([title, list], g) => `
        <div class="field-label lab-head">${title}</div>
        <div class="lab-grid">${list.map(([label], i) => `<button type="button" class="btn btn-secondary btn-small" data-play="${g}:${i}">${label}</button>`).join('')}</div>`).join('')}
      <div class="field-label lab-head">Intro</div>
      <div class="lab-grid"><button type="button" class="btn btn-secondary btn-small" data-intro>Trophy Case intro</button></div>
      <div class="field-label lab-head">Share cards</div>
      <div class="lab-grid">${SHARES.map(([label], i) => `<button type="button" class="btn btn-secondary btn-small" data-share="${i}">${label}</button>`).join('')}</div>
      <div class="field-label lab-head">Insights</div>
      <div class="lab-grid">
        <button type="button" class="btn btn-secondary btn-small" data-recap>Year in Glow (sample)</button>
        <button type="button" class="btn btn-secondary btn-small" data-recap-card>Year card (sample)</button>
      </div>
      <div class="set-row lab-toggle"><span class="set-label">${icon('chart')} Charts offline</span>${toggle('lab-charts', chartsOff, 'Charts offline')}</div>`,
  });
  const sampleYear = () => Number(todayKey().slice(0, 4)) - 1;
  sheet.body.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    unlockAudio();
    if (b.dataset.play) {
      const [g, i] = b.dataset.play.split(':').map(Number);
      sheet.close('lab');
      setTimeout(() => celebrate(ITEMS[g][1][i][1](), { inGesture: false, lab: true }), 350);
    } else if (b.hasAttribute('data-intro')) {
      sheet.close('lab');
      setTimeout(() => playIntro({ sample: { badges: ['w1', 'w5', 'w10', 'w25', 'ws2', 'ws4', 'f1', 'm600', 'pr1', 'g1', 'w50', 'weekend'], unlocks: ['skin:heartbeat', 'palette:sunset'] } }), 350);
    } else if (b.dataset.share) {
      openShare(SHARES[Number(b.dataset.share)][1]());
    } else if (b.hasAttribute('data-recap')) {
      const Y = sampleYear();
      const model = sampleYearModel(Y);
      sheet.close('lab');
      setTimeout(() => import('./recap.js').then((m) => m.openRecap(Y, { model, sample: true })), 350);
    } else if (b.hasAttribute('data-recap-card')) {
      const Y = String(sampleYear());
      openShare({ kind: 'recap', year: Y, snapshot: sampleYearModel(Y) });
    } else if (b.dataset.action === 'lab-charts') {
      chartsOff = !chartsOff;
      b.classList.toggle('on', chartsOff);
      b.setAttribute('aria-checked', String(chartsOff));
      import('./charts.js').then((m) => m.setChartsDisabled(chartsOff)).catch(() => {});
    }
  });
}
