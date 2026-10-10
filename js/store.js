// Data layer. Everything (settings, workouts, goals, rest days) lives in one
// localStorage entry. Photos are the exception: they're too big for localStorage,
// so they live in IndexedDB (see photos.js) and workouts just keep a photoId.
//
// Streaks, freezes, goal progress and records are never stored: derived() computes
// them from the data (see progress.js) and caches the result until the next change.

import { uid } from './util.js';
import { dateKey, timeNow, todayKey } from './dates.js';
import {
  SCHEMA_VERSION, TYPE_COLORS, DEFAULT_TYPES, INTENSITIES,
  defaultState, normalize, normalizeGoal, normalizeWorkout, clampTargets,
} from './schema.js';
import { derive, buildCtx, goalProgress, restCheck } from './progress.js';

export { SCHEMA_VERSION, TYPE_COLORS, DEFAULT_TYPES, INTENSITIES };

const STORAGE_KEY = 'glow-fitness:data';
const THEME_KEY = 'glow-fitness:theme'; // mirrored so index.html can set the theme before first paint

// ---- State + persistence ----

const listeners = new Set();
let errorHandler = (err) => console.error(err);
let rev = 0; // bumped on every change; derived() is cached per (rev, today)
let memo = null;

function trySet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* quota or storage blocked */ }
}

let needsSave = false;
let state = load();

function load() {
  if (typeof localStorage === 'undefined') return defaultState(); // e.g. unit tests in Node
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      const version = Number(obj?.version) || 1;
      // One-time safety copies before data from another version is rewritten.
      if (version < SCHEMA_VERSION && !localStorage.getItem(`${STORAGE_KEY}:v${version}-backup`)) {
        trySet(`${STORAGE_KEY}:v${version}-backup`, raw);
      }
      if (version > SCHEMA_VERSION) trySet(`${STORAGE_KEY}:future-backup`, raw);
      needsSave = version < SCHEMA_VERSION; // save once so the migrated data (e.g. the seeded goal's id) sticks
      return normalize(obj);
    }
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

if (needsSave) persist();

function commit(reason) {
  rev++;
  persist();
  listeners.forEach((fn) => fn(reason));
}

const newestFirst = (a, b) => (b.date + b.time).localeCompare(a.date + a.time) || b.createdAt.localeCompare(a.createdAt);
const nowIso = () => new Date().toISOString();
const LONG_RANK = { active: 0, upcoming: 0, met: 1, ended: 2 };

export const store = {
  get state() { return state; },
  get settings() { return state.settings; },
  get meta() { return state.meta; },
  get rev() { return rev; },

  /** Called with any storage error (e.g. quota exceeded). */
  onError(fn) { errorHandler = fn; },

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // ---- Derived numbers (streaks, goals, records) ----

  /** Everything computed from the data for today; cached until the data or the day changes. */
  derived() {
    const today = todayKey();
    if (!memo || memo.rev !== rev || memo.today !== today) memo = { rev, today, value: derive(state, today) };
    return memo.value;
  },

  /** derive() for a specific day (used to compare before/after a save with the same "today"). */
  derivedAt(today) {
    return today === todayKey() ? store.derived() : derive(state, today);
  },

  /** Progress for any goal, including archived ones and unsaved drafts. */
  progressFor(goal) {
    return goalProgress(goal, buildCtx(state, todayKey()));
  },

  /** Can this day be marked / unmarked as a rest day? */
  restCheck(day) {
    return restCheck(buildCtx(state, todayKey()), day);
  },

  // ---- Workouts ----

  /** All workouts, newest first. */
  workouts() { return [...state.workouts].sort(newestFirst); },

  getWorkout(id) { return state.workouts.find((w) => w.id === id) || null; },

  addWorkout(data) {
    const now = nowIso();
    const w = normalizeWorkout({ date: dateKey(), time: timeNow(), ...data, id: uid(), createdAt: now, updatedAt: now });
    state.workouts.push(w);
    commit('workout:add');
    return w;
  },

  updateWorkout(id, patch) {
    const i = state.workouts.findIndex((w) => w.id === id);
    if (i < 0) return null;
    state.workouts[i] = normalizeWorkout({ ...state.workouts[i], ...patch, id, updatedAt: nowIso() });
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

  /** Deletes an unused type; archives one that a workout or goal still refers to. */
  removeType(id) {
    const inUse = state.workouts.some((w) => w.type === id) || state.goals.some((g) => g.typeId === id);
    if (inUse) {
      const t = state.settings.types.find((x) => x.id === id);
      if (t) t.archived = true;
    } else {
      state.settings.types = state.settings.types.filter((x) => x.id !== id);
    }
    commit('types');
  },

  // ---- Goals ----

  /** Goals in display order. Long goals: active/upcoming first, then met, then ended. */
  goals({ archived = false } = {}) {
    const list = state.goals.filter((g) => !!g.archivedAt === archived);
    if (archived) return list.sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
    const status = new Map(store.derived().goals.map((p) => [p.id, p.status]));
    return list.sort((a, b) => (a.tier === 'long' && b.tier === 'long'
      ? (LONG_RANK[status.get(a.id)] ?? 0) - (LONG_RANK[status.get(b.id)] ?? 0)
      : 0) || a.createdAt.localeCompare(b.createdAt));
  },

  getGoal(id) { return state.goals.find((g) => g.id === id) || null; },

  addGoal(spec) {
    const now = nowIso();
    const g = normalizeGoal({ ...spec, id: uid(), createdAt: now, updatedAt: now, archivedAt: null });
    if (!g) return null;
    state.goals.push(g);
    commit('goals');
    return g;
  },

  updateGoal(id, patch) {
    const i = state.goals.findIndex((g) => g.id === id);
    if (i < 0) return null;
    const old = state.goals[i];
    const g = normalizeGoal({ ...old, ...patch, id, createdAt: old.createdAt, updatedAt: nowIso() });
    if (!g) return null;
    state.goals[i] = g;
    commit('goals');
    return g;
  },

  archiveGoal(id) {
    const g = store.getGoal(id);
    if (!g) return;
    g.archivedAt = nowIso();
    if (state.settings.featuredGoalId === id) state.settings.featuredGoalId = null;
    commit('goals');
  },

  unarchiveGoal(id) {
    const g = store.getGoal(id);
    if (!g) return;
    g.archivedAt = null;
    commit('goals');
  },

  /** Permanently delete a goal (only archived goals can be deleted). */
  deleteGoal(id) {
    const g = store.getGoal(id);
    if (!g || !g.archivedAt) return;
    state.goals = state.goals.filter((x) => x.id !== id);
    commit('goals');
  },

  /** Pin a goal to the Home tile (null = choose automatically). */
  setFeaturedGoal(id) {
    state.settings.featuredGoalId = id && state.goals.some((g) => g.id === id && !g.archivedAt) ? id : null;
    commit('settings');
  },

  // ---- Rest days ----

  /** Mark or unmark a rest day. Returns false if it isn't allowed (see restCheck). */
  setRestDay(day, on) {
    if (on) {
      const check = store.restCheck(day);
      if (!check.ok || check.action !== 'add') return false;
      state.restDays = [...new Set([...state.restDays, day])].sort();
    } else {
      state.restDays = state.restDays.filter((d) => d !== day);
    }
    commit('rest');
    return true;
  },

  // ---- Settings & meta ----

  updateSettings(patch) {
    Object.assign(state.settings, patch);
    commit('settings');
  },

  /**
   * Change a weekly ring target. It applies to the current week and later; finished
   * weeks keep the target they had, so past streaks don't change.
   */
  setTarget(key, value) {
    const s = state.settings;
    s.targets = clampTargets({ ...s.targets, [key]: value });
    const h = s.targetHistory;
    const last = h[h.length - 1];
    const today = todayKey();
    const from = today > last.from ? today : last.from;
    const entry = { from, ...s.targets };
    if (last.from === from) h[h.length - 1] = entry;
    else h.push(entry);
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
