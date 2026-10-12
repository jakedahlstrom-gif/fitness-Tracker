// Data shape, defaults and migration. normalize() turns anything we might load
// (current data, older versions, a backup file) into the current shape. It's pure
// and idempotent, so it's also how old data is migrated (tests/progress.test.js).

import { DEFAULT_REMINDER, normalizeReminder } from './reminders.js';
import { uid, clamp } from './util.js';
import { dateKey, parseKey, todayKey } from './dates.js';

export const SCHEMA_VERSION = 3;

/** Accent color names available to workout types (mapped to CSS vars --c-*). */
export const TYPE_COLORS = ['pink', 'cyan', 'purple', 'lime', 'orange', 'yellow', 'blue'];

export const DEFAULT_TYPES = [
  { id: 'ride', label: 'Ride', icon: 'bike', color: 'cyan', distance: true },
  { id: 'run', label: 'Run', icon: 'run', color: 'pink', distance: true },
  { id: 'walk', label: 'Walk', icon: 'walk', color: 'lime', distance: true },
  { id: 'strength', label: 'Strength', icon: 'dumbbell', color: 'orange', distance: false },
  { id: 'yoga', label: 'Yoga', icon: 'yoga', color: 'purple', distance: false },
  { id: 'hiit', label: 'HIIT', icon: 'bolt', color: 'yellow', distance: false },
  { id: 'other', label: 'Other', icon: 'star', color: 'blue', distance: false },
];

export const INTENSITIES = ['easy', 'medium', 'hard'];
export const TIERS = ['short', 'medium', 'long'];
export const GOAL_METRICS = ['workouts', 'minutes', 'days', 'distance', 'longestDistance'];

/** Allowed range for each weekly ring target. */
export const TARGET_LIMITS = {
  workouts: { min: 1, max: 21 },
  minutes: { min: 10, max: 2000 },
  days: { min: 1, max: 7 },
};

const DEFAULT_TARGETS = { workouts: 3, minutes: 150, days: 3 };

// ---- Small validators ----

const num = (v, fallback = null) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);

/** "2026-02-30" passes a regex but isn't a real day; this rejects it. */
export const isRealDateKey = (k) =>
  typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && dateKey(parseKey(k)) === k;

const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

export function clampTargets(t = {}) {
  const out = {};
  for (const [k, { min, max }] of Object.entries(TARGET_LIMITS)) {
    out[k] = clamp(Math.round(num(t[k], DEFAULT_TARGETS[k])), min, max);
  }
  return out;
}

const sameTargets = (a, b) => a.workouts === b.workouts && a.minutes === b.minutes && a.days === b.days;

// ---- Goals ----

/** Default target and allowed range per metric (distances in km). */
export const GOAL_LIMITS = {
  workouts: { min: 1, max: 10000, fallback: 12, int: true },
  minutes: { min: 10, max: 100000, fallback: 600, int: true },
  days: { min: 1, max: 3660, fallback: 12, int: true },
  distance: { min: 0.1, max: 100000, fallback: 20 },
  longestDistance: { min: 0.1, max: 1000, fallback: 5 },
};
const DAYS_MAX = { short: 7, medium: 31, long: 3660 };
const CHALLENGE_ID = /^[a-z0-9-]{1,24}$/;

/** Clamp a goal target for its metric and tier. */
export function clampGoalTarget(metric, tier, value) {
  const lim = GOAL_LIMITS[metric];
  let v = num(value, NaN);
  if (!(v > 0)) v = lim.fallback;
  const max = metric === 'days' ? DAYS_MAX[tier] : lim.max;
  v = clamp(v, lim.min, max);
  return lim.int ? Math.round(v) : Math.round(v * 1000) / 1000;
}

/** Repair one goal, or return null if it can't be a goal. */
export function normalizeGoal(g, today = todayKey()) {
  if (!g || typeof g !== 'object') return null;
  if (!GOAL_METRICS.includes(g.metric)) return null;
  let tier = TIERS.includes(g.tier) ? g.tier : null;
  if (g.metric === 'longestDistance') tier = 'long'; // "one 5K" only makes sense as a long-term goal
  if (!tier) return null;

  const now = new Date().toISOString();
  const createdAt = isIso(g.createdAt) ? g.createdAt : now;
  let start = null;
  let end = null;
  if (tier === 'long') {
    start = isRealDateKey(g.start) ? g.start : (isIso(g.createdAt) ? dateKey(new Date(g.createdAt)) : today);
    end = isRealDateKey(g.end) && g.end >= start ? g.end : null;
  }
  return {
    id: String(g.id || uid()),
    tier,
    metric: g.metric,
    target: clampGoalTarget(g.metric, tier, g.target),
    typeId: typeof g.typeId === 'string' && g.typeId ? g.typeId : null,
    start,
    end,
    name: typeof g.name === 'string' ? g.name.trim().slice(0, 40) : '',
    createdAt,
    updatedAt: isIso(g.updatedAt) ? g.updatedAt : createdAt,
    archivedAt: isIso(g.archivedAt) ? g.archivedAt : null,
    // Stage 5: a challenge is a long goal tagged with its preset id (or 'custom').
    ...(tier === 'long' && typeof g.challenge === 'string' && CHALLENGE_ID.test(g.challenge) ? { challenge: g.challenge } : {}),
  };
}

/** The monthly minutes goal every new install starts with (600 min with default targets). */
export function seedGoal(targets) {
  const now = new Date().toISOString();
  return {
    id: uid(), tier: 'medium', metric: 'minutes',
    target: clamp(Math.round((targets.minutes * 4) / 50) * 50, 50, 100000),
    typeId: null, start: null, end: null, name: '', createdAt: now, updatedAt: now, archivedAt: null,
  };
}

// ---- Target history (so changing a target never rewrites past weeks) ----

export function normalizeTargetHistory(history, targets, today = todayKey()) {
  const byFrom = new Map();
  for (const e of Array.isArray(history) ? history : []) {
    if (e && isRealDateKey(e.from)) byFrom.set(e.from, { from: e.from, ...clampTargets({ ...targets, ...e }) });
  }
  const list = [...byFrom.values()].sort((a, b) => a.from.localeCompare(b.from));
  if (!list.length) return [{ from: '2000-01-01', ...targets }];
  const last = list[list.length - 1];
  if (!sameTargets(last, targets)) {
    const from = today > last.from ? today : last.from;
    if (from === last.from) list[list.length - 1] = { from, ...targets };
    else list.push({ from, ...targets });
  }
  return list;
}

// ---- Workouts ----

export function normalizeWorkout(w) {
  return {
    id: String(w.id || uid()),
    type: String(w.type || 'other'),
    date: isRealDateKey(w.date) ? w.date : dateKey(),
    time: /^\d{2}:\d{2}$/.test(w.time) ? w.time : '12:00',
    duration: num(w.duration) !== null ? Math.max(0, Math.round(num(w.duration))) : null,
    distanceKm: num(w.distanceKm) !== null && num(w.distanceKm) > 0 ? num(w.distanceKm) : null,
    intensity: INTENSITIES.includes(w.intensity) ? w.intensity : null,
    feel: num(w.feel) >= 1 && num(w.feel) <= 5 ? Math.round(num(w.feel)) : null,
    mood: typeof w.mood === 'string' && w.mood ? w.mood : null,
    note: typeof w.note === 'string' ? w.note.slice(0, 1000) : '',
    photoId: w.photoId ? String(w.photoId) : null,
    createdAt: w.createdAt || new Date().toISOString(),
    updatedAt: w.updatedAt || w.createdAt || new Date().toISOString(),
  };
}

// ---- Whole state ----

function defaultSettings() {
  return {
    name: 'Melinda',
    weekStart: 1, // 0 = Sunday, 1 = Monday
    units: 'mi', // 'mi' | 'km'
    sounds: true,
    haptics: true,
    theme: 'dark', // 'dark' | 'light' | 'auto'
    targets: { ...DEFAULT_TARGETS }, // weekly ring targets (pink / purple / cyan rings on Home)
    targetHistory: [{ from: '2000-01-01', ...DEFAULT_TARGETS }],
    featuredGoalId: null, // goal pinned to the Home tile
    types: DEFAULT_TYPES.map((t) => ({ ...t })),
    palette: 'glow', // unlockable look (resolved against what's unlocked when applied)
    skin: 'classic',
    celebrations: 'full', // 'full' | 'calm'
    reminder: { ...DEFAULT_REMINDER }, // daily nudge (Stage 5)
  };
}

/** The rewards ledger: sticky wins and badges with the date they happened. */
export function defaultAwards() {
  return { wins: {}, badges: {}, unlocksSeen: [], backfilledAt: null, introPending: false };
}

const LOOK_ID = /^[a-z0-9-]{1,32}$/;
const WIN_KEY = /^[a-z][a-zA-Z]*:\S{1,200}$/;
const BADGE_ID = /^[a-z0-9-]{1,40}$/i;
const VIAS = ['live', 'quiet', 'backfill'];
const KNOWN_KINDS = { goal: 'goal', week: 'week', pr: 'pr', freeze: 'freeze' };

/** Keep only plain snapshot fields: short strings and finite numbers. */
function snapshot(entry) {
  const out = {};
  for (const [k, v] of Object.entries(entry)) {
    if (['on', 'at', 'via', 'seen'].includes(k)) continue;
    if (typeof v === 'string') out[k] = v.trim().slice(0, 80);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function normalizeAwards(raw, version = SCHEMA_VERSION) {
  const base = defaultAwards();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const stamp = (e) => ({
    on: e.on,
    at: isIso(e.at) ? e.at : `${e.on}T12:00:00.000Z`,
    via: VIAS.includes(e.via) ? e.via : 'quiet',
  });
  const wins = {};
  if (raw.wins && typeof raw.wins === 'object' && !Array.isArray(raw.wins)) {
    for (const [k, e] of Object.entries(raw.wins)) {
      if (!WIN_KEY.test(k) || !e || typeof e !== 'object' || !isRealDateKey(e.on)) continue;
      const prefix = k.slice(0, k.indexOf(':'));
      wins[k] = { ...snapshot(e), ...(KNOWN_KINDS[prefix] ? { kind: KNOWN_KINDS[prefix] } : {}), ...stamp(e) };
    }
  }
  const badges = {};
  if (raw.badges && typeof raw.badges === 'object' && !Array.isArray(raw.badges)) {
    for (const [id, e] of Object.entries(raw.badges)) {
      if (!BADGE_ID.test(id) || !e || typeof e !== 'object' || !isRealDateKey(e.on)) continue;
      badges[id] = { ...stamp(e), seen: typeof e.seen === 'boolean' ? e.seen : true };
    }
  }
  return {
    wins,
    badges,
    unlocksSeen: [...new Set((Array.isArray(raw.unlocksSeen) ? raw.unlocksSeen : []).filter((x) => typeof x === 'string'))],
    // Data from before Stage 3 (or a downgrade round trip) gets one additive backfill pass.
    backfilledAt: version >= 3 && isIso(raw.backfilledAt) ? raw.backfilledAt : null,
    introPending: raw.introPending === true,
  };
}

export function defaultState() {
  const settings = defaultSettings();
  return {
    version: SCHEMA_VERSION,
    settings,
    workouts: [],
    goals: [seedGoal(settings.targets)],
    restDays: [],
    awards: defaultAwards(),
    meta: { createdAt: new Date().toISOString(), lastBackupAt: null, backupNudgeSnoozedUntil: null },
  };
}

/**
 * Repair/migrate anything into the current shape. Unknown top-level keys are kept,
 * so data from a newer version isn't silently trimmed.
 */
export function normalize(raw, today = todayKey()) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const version = Number(raw.version) || 1;

  const s = { ...base.settings, ...(raw.settings || {}) };
  s.weekStart = Number(s.weekStart) === 0 ? 0 : 1;
  s.targets = clampTargets({ ...base.settings.targets, ...(raw.settings?.targets || {}) });
  s.types = Array.isArray(raw.settings?.types) && raw.settings.types.length
    ? raw.settings.types.map((t) => ({
      id: String(t.id || uid()),
      label: String(t.label || 'Workout').slice(0, 24),
      icon: t.icon || 'star',
      color: TYPE_COLORS.includes(t.color) ? t.color : 'pink',
      distance: !!t.distance,
      ...(t.archived ? { archived: true } : {}),
    }))
    : base.settings.types;
  s.targetHistory = normalizeTargetHistory(raw.settings?.targetHistory, s.targets, today);
  s.palette = LOOK_ID.test(s.palette) ? s.palette : 'glow';
  s.skin = LOOK_ID.test(s.skin) ? s.skin : 'classic';
  s.celebrations = s.celebrations === 'calm' ? 'calm' : 'full';
  s.reminder = normalizeReminder(raw.settings?.reminder);

  let goals;
  if (Array.isArray(raw.goals)) {
    const seen = new Set();
    goals = raw.goals.map((g) => normalizeGoal(g, today)).filter((g) => g && !seen.has(g.id) && seen.add(g.id));
  } else {
    goals = version < 2 ? [seedGoal(s.targets)] : []; // seed once on migration, never again
  }
  const pinned = raw.settings?.featuredGoalId;
  s.featuredGoalId = goals.some((g) => g.id === pinned && !g.archivedAt) ? pinned : null;

  const restDays = [...new Set((Array.isArray(raw.restDays) ? raw.restDays : []).filter(isRealDateKey))].sort();

  return {
    ...raw,
    version: SCHEMA_VERSION,
    settings: s,
    workouts: Array.isArray(raw.workouts) ? raw.workouts.filter((w) => w && typeof w === 'object').map(normalizeWorkout) : [],
    goals,
    restDays,
    awards: normalizeAwards(raw.awards, version),
    meta: { ...base.meta, ...(raw.meta || {}) },
  };
}
