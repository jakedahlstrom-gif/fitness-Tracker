// Data layer. Everything (settings + workouts) lives in one localStorage entry.
// Photos are the exception: they're too big for localStorage, so they live in
// IndexedDB (see photos.js) and workouts just keep a photoId.

import { uid } from './util.js';
import { dateKey, timeNow } from './dates.js';

const STORAGE_KEY = 'glow-fitness:data';
const THEME_KEY = 'glow-fitness:theme'; // mirrored so index.html can set the theme before first paint
export const SCHEMA_VERSION = 1;

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

function defaultSettings() {
  return {
    name: 'Melinda',
    weekStart: 1, // 0 = Sunday, 1 = Monday
    units: 'mi', // 'mi' | 'km'
    sounds: true,
    haptics: true,
    theme: 'dark', // 'dark' | 'light' | 'auto'
    // Weekly ring targets (pink / purple / cyan rings on Home)
    targets: { workouts: 3, minutes: 150, days: 3 },
    types: DEFAULT_TYPES.map((t) => ({ ...t })),
  };
}

function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: defaultSettings(),
    workouts: [],
    meta: { createdAt: new Date().toISOString(), lastBackupAt: null, backupNudgeSnoozedUntil: null },
  };
}

// ---- Normalizing (repairs partial/old data from storage or a backup file) ----

const num = (v, fallback = null) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);

function normalizeWorkout(w) {
  return {
    id: String(w.id || uid()),
    type: String(w.type || 'other'),
    date: /^\d{4}-\d{2}-\d{2}$/.test(w.date) ? w.date : dateKey(),
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

function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const s = { ...base.settings, ...(raw.settings || {}) };
  s.targets = { ...base.settings.targets, ...(raw.settings?.targets || {}) };
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
  return {
    version: SCHEMA_VERSION,
    settings: s,
    workouts: Array.isArray(raw.workouts) ? raw.workouts.map(normalizeWorkout) : [],
    meta: { ...base.meta, ...(raw.meta || {}) },
  };
}

// ---- State + persistence ----

let state = load();
const listeners = new Set();
let errorHandler = (err) => console.error(err);

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    console.warn('Could not read saved data, starting fresh', err);
  }
  return defaultState();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(THEME_KEY, state.settings.theme);
    return true;
  } catch (err) {
    errorHandler(err);
    return false;
  }
}

function commit(reason) {
  persist();
  listeners.forEach((fn) => fn(reason));
}

const newestFirst = (a, b) => (b.date + b.time).localeCompare(a.date + a.time) || b.createdAt.localeCompare(a.createdAt);

export const store = {
  get state() { return state; },
  get settings() { return state.settings; },
  get meta() { return state.meta; },

  /** Called with any storage error (e.g. quota exceeded). */
  onError(fn) { errorHandler = fn; },

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // ---- Workouts ----

  /** All workouts, newest first. */
  workouts() { return [...state.workouts].sort(newestFirst); },

  getWorkout(id) { return state.workouts.find((w) => w.id === id) || null; },

  addWorkout(data) {
    const now = new Date().toISOString();
    const w = normalizeWorkout({ date: dateKey(), time: timeNow(), ...data, id: uid(), createdAt: now, updatedAt: now });
    state.workouts.push(w);
    commit('workout:add');
    return w;
  },

  updateWorkout(id, patch) {
    const i = state.workouts.findIndex((w) => w.id === id);
    if (i < 0) return null;
    state.workouts[i] = normalizeWorkout({ ...state.workouts[i], ...patch, id, updatedAt: new Date().toISOString() });
    commit('workout:update');
    return state.workouts[i];
  },

  /** Removes a workout and returns it (so it can be restored for "Undo"). */
  deleteWorkout(id) {
    const i = state.workouts.findIndex((w) => w.id === id);
    if (i < 0) return null;
    const [removed] = state.workouts.splice(i, 1);
    commit('workout:delete');
    return removed;
  },

  restoreWorkout(w) {
    if (!w || state.workouts.some((x) => x.id === w.id)) return;
    state.workouts.push(normalizeWorkout(w));
    commit('workout:add');
  },

  // ---- Workout types ----

  /** Active (non-archived) types, in display order. */
  types() { return state.settings.types.filter((t) => !t.archived); },

  /** Any type by id, including archived ones (so old history still renders). */
  typeById(id) {
    return state.settings.types.find((t) => t.id === id)
      || { id, label: 'Workout', icon: 'star', color: 'pink', distance: false };
  },

  addType({ label, icon = 'star', color, distance = false }) {
    const used = new Set(state.settings.types.map((t) => t.color));
    const t = {
      id: uid(),
      label: label.trim().slice(0, 24) || 'Workout',
      icon,
      color: color || TYPE_COLORS.find((c) => !used.has(c)) || 'pink',
      distance,
    };
    state.settings.types.push(t);
    commit('types');
    return t;
  },

  updateType(id, patch) {
    const t = state.settings.types.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    commit('types');
  },

  /** Deletes an unused type; archives one that history still refers to. */
  removeType(id) {
    const inUse = state.workouts.some((w) => w.type === id);
    if (inUse) {
      const t = state.settings.types.find((x) => x.id === id);
      if (t) t.archived = true;
    } else {
      state.settings.types = state.settings.types.filter((x) => x.id !== id);
    }
    commit('types');
  },

  // ---- Settings & meta ----

  updateSettings(patch) {
    Object.assign(state.settings, patch);
    commit('settings');
  },

  setTarget(key, value) {
    state.settings.targets[key] = value;
    commit('settings');
  },

  updateMeta(patch) {
    Object.assign(state.meta, patch);
    commit('meta');
  },

  // ---- Whole-dataset operations (backup / reset) ----

  /** Replace everything with data from a backup file. */
  replaceAll(raw) {
    state = normalize(raw);
    commit('replace');
  },

  /** Wipe all workouts and settings back to defaults. */
  reset() {
    state = defaultState();
    commit('replace');
  },
};
