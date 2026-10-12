// Stage 5 challenges: the preset catalog and helpers (pure, no DOM).
//
// A challenge is a long-term goal with a `challenge` tag (a preset id, or 'custom'),
// so progress, wins, celebrations, archiving and backups all reuse the goal machinery.
// Each preset has its own badge (`cp-<id>` in badges.js); every challenge counts
// toward the Challenge Accepted ladder.

import { addDaysKey, daysBetween, parseKey, dateKey } from './dates.js';

/** Lengths offered when she builds her own (days). */
export const LENGTHS = [7, 14, 21, 30];

/** Metrics a challenge can count. */
export const CHALLENGE_METRICS = ['workouts', 'minutes', 'days', 'distance'];

/**
 * Presets. `typeId` is the workout type it counts (null = any); `makeType` adds that
 * type when she doesn't have it. `window: 'month'` runs for a calendar month,
 * otherwise `days` from the start. Distance targets are km.
 */
export const CHALLENGES = [
  {
    id: 'core30', name: '30-Day Core', icon: 'flame', color: 'orange',
    metric: 'days', target: 20, days: 30, typeId: 'core',
    makeType: { label: 'Core', icon: 'flame', color: 'orange', distance: false },
    blurb: 'A core session on 20 of the next 30 days. Planks count!',
  },
  {
    id: 'month10', name: '10 {Things} in {Month}', icon: 'calendar', color: 'cyan',
    metric: 'workouts', target: 10, window: 'month', typeId: 'ride', pickType: true,
    makeType: { label: 'Ride', icon: 'bike', color: 'cyan', distance: true },
    blurb: 'Ten of one kind of workout in a calendar month. You pick the kind.',
  },
  {
    id: 'spark7', name: 'Seven-Day Spark', icon: 'sparkle', color: 'pink',
    metric: 'days', target: 7, days: 7, typeId: null,
    blurb: 'Move every single day for a week. Any workout counts.',
  },
  {
    id: 'min1000', name: '1,000-Minute Month', icon: 'clock', color: 'purple',
    metric: 'minutes', target: 1000, days: 30, typeId: null,
    blurb: '1,000 minutes of anything in 30 days. About 33 a day.',
  },
  {
    id: 'yoga21', name: '21 Days of Yoga', icon: 'yoga', color: 'lime',
    metric: 'days', target: 15, days: 21, typeId: 'yoga',
    makeType: { label: 'Yoga', icon: 'yoga', color: 'purple', distance: false },
    blurb: 'Yoga on 15 of the next 21 days.',
  },
  {
    id: 'hiit12', name: 'HIIT the Gas', icon: 'bolt', color: 'yellow',
    metric: 'workouts', target: 12, days: 28, typeId: 'hiit',
    makeType: { label: 'HIIT', icon: 'bolt', color: 'yellow', distance: false },
    blurb: '12 HIIT workouts in 4 weeks.',
  },
  {
    id: 'marathon', name: 'Marathon Month', icon: 'route', color: 'cyan',
    metric: 'distance', target: 42.195, days: 30, typeId: 'run',
    makeType: { label: 'Run', icon: 'run', color: 'pink', distance: true },
    blurb: 'Run a marathon (26.2 mi / 42.2 km) in 30 days, a bit at a time.',
  },
];

export const PRESET_BY_ID = new Map(CHALLENGES.map((c) => [c.id, c]));
export const isChallenge = (g) => !!g?.challenge;
export const presetBadgeId = (id) => `cp-${id}`;

const live = (types) => types.filter((t) => !t.archived);

/** "Rides", "Runs", "Strength sessions": the plural for a type in a challenge name. */
export function thingsOf(type) {
  if (!type) return 'workouts';
  return type.distance ? `${type.label}s` : `${type.label} sessions`;
}

/**
 * The type a preset counts: an existing type (by id, then label), else the one to add.
 * → { typeId, type, create } where `create` is the makeType spec when it's missing.
 */
export function resolveType(preset, types, pickedId = null) {
  const list = live(types);
  if (pickedId) {
    const t = list.find((x) => x.id === pickedId);
    if (t) return { typeId: t.id, type: t, create: null };
  }
  if (!preset.typeId) return { typeId: null, type: null, create: null };
  const want = preset.makeType?.label.toLowerCase();
  const t = list.find((x) => x.id === preset.typeId) || list.find((x) => x.label.toLowerCase() === want);
  if (t) return { typeId: t.id, type: t, create: null };
  return { typeId: null, type: null, create: preset.makeType || null };
}

/** For `window: 'month'` presets: this month, or next month when fewer than 12 days are left. */
export function defaultWhen(preset, today) {
  if (preset.window !== 'month') return 'now';
  const d = parseKey(today);
  const last = dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return daysBetween(today, last) + 1 < 12 ? 'next' : 'this';
}

/** The dates a preset runs: { start, end } (inclusive). */
export function presetWindow(preset, today, when = defaultWhen(preset, today)) {
  if (preset.window === 'month') {
    const d = parseKey(today);
    const m = d.getMonth() + (when === 'next' ? 1 : 0);
    return { start: dateKey(new Date(d.getFullYear(), m, 1)), end: dateKey(new Date(d.getFullYear(), m + 1, 0)) };
  }
  return { start: today, end: addDaysKey(today, preset.days - 1) };
}

/** The display name, with {Things} and {Month} filled in. */
export function presetName(preset, { type = null, start = null } = {}) {
  const month = start ? parseKey(start).toLocaleDateString(undefined, { month: 'long' }) : 'a month';
  return preset.name.replace('{Things}', thingsOf(type)).replace('{Month}', month);
}

/**
 * The goal spec for starting a preset (pass it to store.addGoal). Add the `create`
 * type from resolveType first and pass its id as `typeId`.
 */
export function presetSpec(preset, { today, type = null, when, target } = {}) {
  const { start, end } = presetWindow(preset, today, when);
  return {
    tier: 'long', metric: preset.metric, target: target ?? preset.target,
    typeId: type ? type.id : null, start, end,
    name: presetName(preset, { type, start }), challenge: preset.id,
  };
}

/** The goal spec for one she builds herself. */
export function customSpec({ name = '', metric = 'workouts', target, typeId = null, days = 30, start }) {
  return {
    tier: 'long', metric, target, typeId, start, end: addDaysKey(start, days - 1),
    name: String(name).trim().slice(0, 40), challenge: 'custom',
  };
}

/** Icon and color for a challenge row: the preset's, else its type's, else a medal. */
export function challengeLook(goal, typeById) {
  const p = PRESET_BY_ID.get(goal.challenge);
  if (p) return { icon: p.icon, color: p.color };
  if (goal.typeId) {
    const t = typeById(goal.typeId);
    return { icon: t.icon, color: t.color };
  }
  return { icon: 'medal', color: 'yellow' };
}
