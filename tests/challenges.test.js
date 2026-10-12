// Unit tests for Stage 5 challenges: presets, schema, wins and badges. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { derive } from '../js/progress.js';
import { collect, winCounts } from '../js/rewards.js';
import { BADGES, BADGE_BY_ID } from '../js/badges.js';
import { normalizeGoal, normalizeAwards, DEFAULT_TYPES } from '../js/schema.js';
import {
  CHALLENGES, PRESET_BY_ID, presetBadgeId, presetSpec, presetWindow, presetName, defaultWhen, resolveType, customSpec, thingsOf,
} from '../js/challenges.js';
import { addDaysKey, daysBetween } from '../js/dates.js';

const TODAY = '2026-10-10';
const OLD = '2025-12-01T00:00:00.000Z'; // goals made before the workouts (the subset rule)
let n = 0;
const W = (date, extra = {}) => ({
  id: `c${String(++n).padStart(4, '0')}`, type: 'run', date, time: '12:00', duration: 30, distanceKm: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
});
const S = (goals, workouts, settings = {}) => ({
  settings: {
    weekStart: 1, units: 'km', targets: { workouts: 3, minutes: 150, days: 3 },
    targetHistory: [{ from: '2000-01-01', workouts: 3, minutes: 150, days: 3 }], featuredGoalId: null,
    types: DEFAULT_TYPES.map((t) => ({ ...t })), ...settings,
  },
  workouts, goals, restDays: [],
});
const EMPTY = () => ({ wins: {}, badges: {}, unlocksSeen: [], backfilledAt: null, introPending: false });
const quiet = (state) => collect(state, derive(state, TODAY), EMPTY(), { today: TODAY, mode: 'quiet', now: '2026-10-10T12:00:00.000Z', label: () => 'C' });
const goal = (spec, id = 'g1') => normalizeGoal({ ...spec, id, createdAt: OLD, updatedAt: OLD }, TODAY);

test('C1 every preset makes a valid challenge with its own badge', () => {
  assert.equal(new Set(CHALLENGES.map((c) => c.id)).size, CHALLENGES.length);
  for (const p of CHALLENGES) {
    const { type, create } = resolveType(p, DEFAULT_TYPES);
    assert.ok(!(p.typeId && !type && !create), `${p.id} resolves a type or knows how to add one`);
    const g = goal(presetSpec(p, { today: TODAY, type }));
    assert.ok(g, p.id);
    assert.equal(g.tier, 'long');
    assert.equal(g.challenge, p.id);
    assert.equal(g.target, p.target, `${p.id} target survives clamping`);
    assert.ok(g.start && g.end && g.end >= g.start && g.start >= '2026-10-01', `${p.id} window`);
    if (p.days) assert.equal(daysBetween(g.start, g.end) + 1, p.days);
    if (p.metric === 'days') assert.ok(p.target <= (p.days || 28), `${p.id} days target fits`);
    assert.ok(g.name && g.name.length <= 40 && !g.name.includes('{'), `${p.id} name "${g.name}"`);
    const b = BADGE_BY_ID.get(presetBadgeId(p.id));
    assert.ok(b && b.family === 'challenges' && b.measure.key === `ch:${p.id}`, `${p.id} badge`);
  }
  assert.equal(BADGES.filter((b) => b.family === 'challenges').length, CHALLENGES.length + 3);
});

test('C2 the challenge tag only lives on long goals and only with a valid id', () => {
  const base = { tier: 'long', metric: 'workouts', target: 5, start: '2026-10-01', end: '2026-10-31' };
  assert.equal(goal({ ...base, challenge: 'spark7' }).challenge, 'spark7');
  assert.equal(goal({ ...base, challenge: 'custom' }).challenge, 'custom');
  assert.ok(!('challenge' in goal(base)), 'plain goals stay unchanged');
  assert.ok(!('challenge' in goal({ ...base, challenge: 'Bad id!' })));
  assert.ok(!('challenge' in goal({ ...base, challenge: 7 })));
  assert.ok(!('challenge' in goal({ ...base, tier: 'medium', challenge: 'spark7' })));
});

test('C3 month presets: this month, next month near the end, and across New Year', () => {
  const p = PRESET_BY_ID.get('month10');
  assert.equal(defaultWhen(p, '2026-10-10'), 'this');
  assert.equal(defaultWhen(p, '2026-10-25'), 'next');
  assert.equal(defaultWhen(PRESET_BY_ID.get('spark7'), '2026-10-25'), 'now');
  assert.deepEqual(presetWindow(p, '2026-10-10', 'this'), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(presetWindow(p, '2026-12-28'), { start: '2027-01-01', end: '2027-01-31' });
  assert.deepEqual(presetWindow(p, '2027-02-03', 'this'), { start: '2027-02-01', end: '2027-02-28' });
  assert.deepEqual(presetWindow(PRESET_BY_ID.get('core30'), TODAY), { start: TODAY, end: addDaysKey(TODAY, 29) });
});

test('C4 names and types', () => {
  const p = PRESET_BY_ID.get('month10');
  const ride = DEFAULT_TYPES.find((t) => t.id === 'ride');
  const strength = DEFAULT_TYPES.find((t) => t.id === 'strength');
  assert.match(presetName(p, { type: ride, start: '2026-10-01' }), /^10 Rides in \S+$/);
  assert.match(presetName(p, { type: strength, start: '2026-10-01' }), /^10 Strength sessions in /);
  assert.equal(thingsOf(null), 'workouts');

  const core = PRESET_BY_ID.get('core30');
  assert.deepEqual(resolveType(core, DEFAULT_TYPES).create, core.makeType, 'no Core type → offer to add it');
  const withCore = [...DEFAULT_TYPES, { id: 'x1', label: 'core', icon: 'flame', color: 'orange' }];
  assert.equal(resolveType(core, withCore).typeId, 'x1', 'matched by label');
  const archived = DEFAULT_TYPES.map((t) => (t.id === 'yoga' ? { ...t, archived: true } : t));
  assert.ok(resolveType(PRESET_BY_ID.get('yoga21'), archived).create, 'archived types are not reused');
  assert.equal(resolveType(p, DEFAULT_TYPES, 'walk').typeId, 'walk', 'her pick wins');
  assert.equal(resolveType(PRESET_BY_ID.get('spark7'), DEFAULT_TYPES).typeId, null);
});

test('C5 custom challenges', () => {
  const s = customSpec({ name: '  Plank party  ', metric: 'minutes', target: 200, typeId: 'yoga', days: 14, start: TODAY });
  assert.equal(s.end, addDaysKey(TODAY, 13));
  assert.equal(s.name, 'Plank party');
  assert.equal(goal(s).challenge, 'custom');
});

test('C6 finishing a challenge: its own badges, not Dream Chaser or the long-goal ladder', () => {
  const g = goal(presetSpec(PRESET_BY_ID.get('spark7'), { today: '2026-10-04' }));
  const ws = Array.from({ length: 7 }, (_, i) => W(addDaysKey('2026-10-04', i)));
  const res = quiet(S([g], ws));
  const win = res.wins['goal:g1:L'];
  assert.ok(win, 'the win is recorded');
  assert.equal(win.challenge, 'spark7');
  assert.equal(win.on, TODAY);
  for (const id of ['ch1', 'cp-spark7', 'g1']) assert.ok(res.badges[id], `${id} earned`);
  for (const id of ['gl1', 'crown', 'ch3', 'cp-core30']) assert.ok(!res.badges[id], `${id} not earned`);
  assert.equal(winCounts(res.wins).long, 0);
  // The tag survives a backup round trip.
  const back = normalizeAwards({ wins: res.wins, badges: {} });
  assert.equal(back.wins['goal:g1:L'].challenge, 'spark7');
  assert.equal(winCounts(back.wins).long, 0);
});

test('C7 one day short is not a win, and a plain long goal still counts as long', () => {
  const g = goal(presetSpec(PRESET_BY_ID.get('spark7'), { today: '2026-10-04' }));
  const ws = Array.from({ length: 7 }, (_, i) => W(addDaysKey('2026-10-04', i))).filter((w) => w.date !== '2026-10-07');
  assert.ok(!quiet(S([g], ws)).wins['goal:g1:L']);
  const plain = goal({ tier: 'long', metric: 'workouts', target: 3, start: '2026-10-01', end: null }, 'g2');
  const res = quiet(S([plain], ws));
  assert.equal(winCounts(res.wins).long, 1);
  assert.ok(res.badges.gl1 && !res.badges.ch1);
});

test('C8 the Home goal tile skips challenges unless pinned', () => {
  const ch = goal(presetSpec(PRESET_BY_ID.get('min1000'), { today: TODAY }), 'gc');
  assert.equal(derive(S([ch], [W(TODAY)]), TODAY).featured, null);
  assert.equal(derive(S([ch], [W(TODAY)], { featuredGoalId: 'gc' }), TODAY).featured.id, 'gc');
});
