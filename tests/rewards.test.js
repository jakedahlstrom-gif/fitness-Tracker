// Unit tests for the Stage 3 rewards engine, catalogs and ledger. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { derive, milestones } from '../js/progress.js';
import {
  facts, evaluate, collect, winCounts, unlockedSet, resolveLook, buildPlan, pickLine, compliment,
} from '../js/rewards.js';
import { BADGES, FAMILY_BY_ID } from '../js/badges.js';
import { PALETTES, SKINS, LADDERS } from '../js/looks.js';
import { normalize, normalizeAwards, DEFAULT_TYPES } from '../js/schema.js';
import { parseBackup } from '../js/backup.js';
import { addDaysKey } from '../js/dates.js';

const TODAY = '2026-10-10'; // Saturday; Monday-start weeks
let n = 0;
const W = (date, duration = 30, extra = {}) => ({
  id: `r${String(++n).padStart(4, '0')}`, type: 'run', date, time: '12:00', duration, distanceKm: null,
  createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}Z`, updatedAt: '2026-01-01T00:00:00Z', ...extra,
});
const fill = (mon, k, dur = 30) => Array.from({ length: k }, (_, i) => W(addDaysKey(mon, i), dur));
const S = (over = {}) => ({
  settings: {
    weekStart: 1, units: 'km', targets: { workouts: 3, minutes: 150, days: 3 },
    targetHistory: [{ from: '2000-01-01', workouts: 3, minutes: 150, days: 3 }], featuredGoalId: null,
    types: DEFAULT_TYPES.map((t) => ({ ...t })), ...(over.settings || {}),
  },
  workouts: over.workouts || [], goals: over.goals || [], restDays: over.restDays || [],
});
const EMPTY = () => ({ wins: {}, badges: {}, unlocksSeen: [], backfilledAt: null, introPending: false });
const ev = (state, wins = {}, today = TODAY) => evaluate(facts(state, derive(state, today), wins, today));
const run = (state, mode, awards = EMPTY(), extra = {}) =>
  collect(state, derive(state, extra.today || TODAY), awards, { today: TODAY, mode, now: '2026-10-10T12:00:00.000Z', label: () => 'Goal', ...extra });
const merge = (aw, res) => ({ ...aw, wins: { ...aw.wins, ...res.wins }, badges: { ...aw.badges, ...res.badges } });

test('R1 catalog integrity', () => {
  const ids = BADGES.map((b) => b.id);
  assert.equal(ids.length, 50);
  assert.equal(new Set(ids).size, 50);
  for (const b of BADGES) {
    assert.ok(b.measure && FAMILY_BY_ID.has(b.family), b.id);
    if (b.secret) assert.ok(b.hint, `${b.id} needs a hint`);
    assert.ok(b.flavor && b.flavor.length <= 60, `${b.id} flavor`);
  }
  const byKey = new Map();
  for (const b of BADGES) {
    if (!b.measure.key || !b.measure.target) continue;
    const k = `${b.measure.kind}:${b.measure.key}`;
    if (byKey.has(k)) assert.ok(b.measure.target > byKey.get(k), `${b.id} target ascends`);
    byKey.set(k, b.measure.target);
  }
  for (const l of Object.values(LADDERS)) {
    for (const r of l.rungs) for (const item of r.items) {
      const [type, id] = item.split(':');
      assert.ok(type === 'palette' ? PALETTES[id] : SKINS[id], item);
    }
  }
  const counts = BADGES.reduce((m, b) => ({ ...m, [b.rarity]: (m[b.rarity] || 0) + 1 }), {});
  assert.deepEqual(counts, { common: 16, rare: 17, epic: 12, legendary: 5 });
});

test('R2 evaluate counts and daily streak dates', () => {
  const s = S({ workouts: Array.from({ length: 12 }, (_, i) => W(addDaysKey('2026-09-01', i))) });
  const e = ev(s);
  assert.equal(e.get('w1').on, '2026-09-01');
  assert.equal(e.get('w5').on, '2026-09-05');
  assert.equal(e.get('w10').on, '2026-09-10');
  assert.deepEqual([e.get('w25').value, e.get('w25').on], [12, null]);
  assert.equal(e.get('ds7').on, '2026-09-07');
});

test('R3 cumulative minutes and single-workout length', () => {
  const e = ev(S({ workouts: [W('2026-10-01', 250), W('2026-10-02', 250), W('2026-10-03', 200)] }));
  assert.equal(e.get('m600').on, '2026-10-03');
  assert.equal(e.get('long60').on, '2026-10-01');
  assert.equal(e.get('long90').on, '2026-10-01');
  assert.equal(e.get('m3000').value, 700);
});

test('R4 weekly streak badge is dated by the workout that met the week', () => {
  const s = S({ workouts: [...fill('2026-09-07', 3), ...fill('2026-09-14', 3)] });
  const d = derive(s, TODAY);
  assert.deepEqual(d.weekly.bestReached, ['2026-09-07', '2026-09-14']);
  const e = ev(s);
  assert.equal(e.get('ws2').on, '2026-09-16');
  assert.deepEqual([e.get('ws4').on, e.get('ws4').value, e.get('ws4').target], [null, 0, 4]);
  assert.equal(e.get('r1').on, null); // 90 min < 150
});

test('R5 daily streak with a rest day', () => {
  const s = S({ workouts: [W('2026-10-01'), W('2026-10-02'), W('2026-10-04')], restDays: ['2026-10-03'] });
  assert.deepEqual(derive(s, TODAY).daily.bestReached, ['2026-10-01', '2026-10-02', '2026-10-04']);
  const e = ev(s);
  assert.equal(e.get('ds3').on, '2026-10-04');
  assert.equal(e.get('rest5').value, 1);
});

test('R6 badges are sticky after workouts are deleted', () => {
  const all = Array.from({ length: 12 }, (_, i) => W(addDaysKey('2026-09-01', i)));
  const first = run(S({ workouts: all }), 'live');
  for (const id of ['w1', 'w5', 'w10', 'ds3', 'ds7']) assert.ok(first.badges[id], id);
  const aw = merge(EMPTY(), first);
  const fewer = all.filter((w) => w.date < '2026-09-06');
  const second = run(S({ workouts: fewer }), 'live', aw);
  assert.deepEqual(second.badges, {});
  assert.deepEqual(second.wins, {});
  assert.equal(aw.badges.w10.on, '2026-09-10');
});

test('R7 collect is idempotent', () => {
  const s = S({ workouts: [...fill('2026-09-07', 3), ...fill('2026-09-14', 3), W('2026-10-01', 95)] });
  const aw = merge(EMPTY(), run(s, 'quiet'));
  const again = run(s, 'quiet', aw);
  assert.deepEqual([again.wins, again.badges, again.newUnlocks], [{}, {}, []]);
});

test('R8 weekly wins count calendar weeks once', () => {
  const wins = {
    'week:2026-09-14': { on: '2026-09-16' },
    'week:2026-09-13': { on: '2026-09-16' }, // Sunday-start key for the same week
    'goal:g:W:2026-09-14': { on: '2026-09-16' },
    'goal:g:W:2026-09-20': { on: '2026-09-22' },
  };
  assert.equal(winCounts(wins).short, 2);
});

test('R9 monthly and long-term win counts', () => {
  const wins = {
    'goal:a:M:2026-09': { on: '2026-09-20' }, 'goal:b:M:2026-09': { on: '2026-09-21' },
    'goal:a:M:2026-10': { on: '2026-10-05' }, 'goal:x:L': { on: '2026-08-01' }, 'goal:y:L': { on: '2026-09-01' },
  };
  const c = winCounts(wins);
  assert.deepEqual([c.medium, c.long], [2, 2]);
});

test('R10 unlock ladder boundaries', () => {
  const at = (short, medium, long) => unlockedSet({}, { short, medium, long, dates: { short: [], medium: [], long: [] } });
  assert.deepEqual([...at(2, 0, 0)].sort(), ['palette:glow', 'skin:classic', 'skin:heartbeat']);
  assert.ok(at(3, 0, 0).has('palette:sunset'));
  assert.ok(at(0, 1, 0).has('palette:aurora'));
  const champ = at(0, 0, 1);
  assert.ok(champ.has('palette:gold') && champ.has('skin:holo'));
});

test('R11 resolveLook falls back without rewriting settings', () => {
  const settings = { palette: 'cosmic', skin: 'holo' };
  const unlocked = at1Long();
  assert.deepEqual(resolveLook(settings, unlocked), { palette: 'glow', skin: 'holo' });
  assert.deepEqual(settings, { palette: 'cosmic', skin: 'holo' });
  assert.equal(resolveLook({ palette: 'neon-2099', skin: 'classic' }, unlocked).palette, 'glow');
  function at1Long() { return unlockedSet({}, { short: 0, medium: 0, long: 1, dates: { short: [], medium: [], long: [] } }); }
});

const goalM = (extra = {}) => ({
  id: 'g', tier: 'medium', metric: 'minutes', target: 600, typeId: null, start: null, end: null, name: '',
  createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z', archivedAt: null, ...extra,
});

test('R12 subset rule rejects a goal that was already met when it was set', () => {
  const s = S({ goals: [goalM()], workouts: [
    W('2026-10-01', 300, { updatedAt: '2026-10-01T18:00:00.000Z' }),
    W('2026-10-02', 300, { updatedAt: '2026-10-02T18:00:00.000Z' }),
  ] });
  assert.equal(run(s, 'quiet').wins['goal:g:M:2026-10'], undefined);
});

test('R13 subset rule accepts a goal finished after it was set', () => {
  const s = S({ goals: [goalM()], workouts: [
    W('2026-10-01', 300, { updatedAt: '2026-10-01T18:00:00.000Z' }),
    W('2026-10-02', 300, { updatedAt: '2026-10-09T07:00:00.000Z' }),
  ] });
  const w = run(s, 'quiet').wins['goal:g:M:2026-10'];
  assert.deepEqual(
    [w.kind, w.tier, w.on, w.via, w.value, w.target],
    ['goal', 'medium', '2026-10-02', 'quiet', 600, 600],
  );
});

test('R14 backfill records past periods after the goal was created', () => {
  const g = goalM({ createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z' });
  const s = S({ goals: [g], workouts: [W('2026-09-01', 350), W('2026-09-12', 300), W('2026-10-01', 300), W('2026-10-02', 300)] });
  const wins = run(s, 'backfill').wins;
  assert.equal(wins['goal:g:M:2026-09'].on, '2026-09-12');
  assert.equal(wins['goal:g:M:2026-10'].on, '2026-10-02');
  assert.equal(wins['goal:g:M:2026-09'].via, 'backfill');
});

test('R15 backfill ignores periods met before the goal existed', () => {
  const g = goalM({ createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z' });
  const wins = run(S({ goals: [g], workouts: [W('2026-09-01', 350), W('2026-09-02', 350)] }), 'backfill').wins;
  assert.equal(wins['goal:g:M:2026-09'], undefined);
  assert.equal(wins['goal:g:M:2026-08'], undefined);
});

const goalS = { id: 'gs', tier: 'short', metric: 'workouts', target: 3, typeId: null, start: null, end: null, name: '', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', archivedAt: null };

test('R16 a backdated log can finish last week\'s goal (catch-up)', () => {
  const T = '2026-10-05';
  const base = [W('2026-09-28'), W('2026-09-30')];
  const b = derive(S({ goals: [goalS], workouts: base }), T);
  const a = derive(S({ goals: [goalS], workouts: [...base, W('2026-10-04')] }), T);
  const evs = milestones(b, a);
  assert.deepEqual(evs.map((e) => [e.kind, e.key, !!e.catchUp]), [
    ['goal', 'goal:gs:W:2026-09-28', true],
    ['weekFilled', 'fill:2026-10-05:1', false],
  ]);
});

test('R17 live collect records the catch-up and the met week', () => {
  const T = '2026-10-05';
  const base = [W('2026-09-28'), W('2026-09-30')];
  const before = S({ goals: [goalS], workouts: base });
  const after = S({ goals: [goalS], workouts: [...base, W('2026-10-04')] });
  const events = milestones(derive(before, T), derive(after, T));
  const res = collect(after, derive(after, T), EMPTY(), { today: T, mode: 'live', events, label: () => 'G' });
  assert.equal(res.wins['goal:gs:W:2026-09-28'].on, '2026-10-04');
  assert.equal(res.wins['week:2026-09-28'].on, '2026-10-04');
});

test('R18 personal records are never minted by quiet passes', () => {
  const s = S({ workouts: [W('2026-10-01', 30), W('2026-10-02', 40), W('2026-10-03', 45), W('2026-10-04', 50), W('2026-10-05', 55)] });
  assert.equal(Object.keys(run(s, 'quiet').wins).filter((k) => k.startsWith('pr:')).length, 0);
  const d = derive(s, TODAY);
  const back = run(s, 'backfill').wins[`pr:longestWorkout:${d.records.longestWorkout.holder}`];
  assert.equal(back.on, d.records.longestWorkout.date);
});

const E = (kind, extra = {}) => ({ kind, key: `${kind}:x`, priority: { goal: 80, pr: 70, freeze: 60, allRings: 45, weekMet: 40 }[kind] || 20, ...extra });

test('R19 repeats: chips for new things, a toast when nothing is new', () => {
  const goal = E('goal', { tier: 'medium', key: 'goal:g:M:2026-10', goal: { name: 'Big month' } });
  const p = buildPlan({ fresh: [E('allRings')], repeats: [goal], badges: {}, newUnlocks: [] }, { label: (g) => g.name });
  assert.deepEqual([p.level, p.repeatToast], [1, null]);
  const q = buildPlan({ fresh: [], repeats: [goal], badges: {}, newUnlocks: [] }, { label: (g) => g.name });
  assert.deepEqual([q.level, q.headline, q.repeatToast], [0, null, 'Still crushed: Big month']);
});

test('R20 three big wins make a jackpot finale', () => {
  const p = buildPlan({ fresh: [E('freeze'), E('goal', { tier: 'medium' }), E('pr')], repeats: [], badges: {}, newUnlocks: [] });
  assert.deepEqual([p.level, p.jackpot, p.headline.kind, p.chips.map((c) => c.kind), p.reveal], [3, true, 'goal', ['pr', 'freeze'], null]);
});

test('R21 a small win folds into the badge reveal', () => {
  const p = buildPlan({ fresh: [E('weekMet')], repeats: [], badges: { w10: {} }, newUnlocks: [] });
  assert.equal(p.level, 0);
  assert.deepEqual(p.reveal.badges, ['w10']);
  assert.deepEqual(p.reveal.also.map((e) => e.kind), ['weekMet']);
});

test('R22 a long-term goal finale absorbs badges and unlocks', () => {
  const p = buildPlan({ fresh: [E('goal', { tier: 'long' })], repeats: [], badges: { gl1: {} }, newUnlocks: ['palette:gold', 'skin:holo'] });
  assert.deepEqual([p.level, p.reveal, p.alsoEarned.badges, p.alsoEarned.unlocks.length], [3, null, ['gl1'], 2]);
});

test('R23 back-to-back big celebrations are toned down', () => {
  const p = buildPlan({ fresh: [E('pr')], repeats: [], badges: {}, newUnlocks: [] }, { now: 10000, lastEndAt: 8500 });
  assert.equal(p.level, 1);
});

test('R24 v2 data migrates to v3 with an empty ledger', () => {
  const x = { version: 2, settings: { name: 'M' }, workouts: [], meta: { createdAt: '2026-01-01T00:00:00.000Z' } };
  const s = normalize(x, TODAY);
  assert.deepEqual(s.awards, { wins: {}, badges: {}, unlocksSeen: [], backfilledAt: null, introPending: false });
  assert.deepEqual([s.settings.palette, s.settings.skin, s.settings.celebrations], ['glow', 'classic', 'full']);
  assert.deepEqual(normalize(normalize(x, TODAY), TODAY), normalize(x, TODAY));
});

test('R25 the ledger is repaired, unknown keys kept', () => {
  const a = normalizeAwards({
    wins: { 'goal:a:M:2026-10': { on: '2026-02-30' }, 'zeta:x': { on: '2026-10-01' } },
    badges: { w10: { on: '2026-10-01' } },
  });
  assert.equal(a.wins['goal:a:M:2026-10'], undefined);
  assert.deepEqual([a.wins['zeta:x'].via, a.wins['zeta:x'].at], ['quiet', '2026-10-01T12:00:00.000Z']);
  assert.equal(a.badges.w10.seen, true);
});

test('R26 a downgrade round trip keeps rewards and backfills without duplicates', () => {
  const s = S({ workouts: Array.from({ length: 12 }, (_, i) => W(addDaysKey('2026-09-01', i))) });
  const aw = merge(EMPTY(), run(s, 'live'));
  const v3 = normalize({ ...s, version: 3, awards: { ...aw, backfilledAt: '2026-10-10T00:00:00.000Z' } }, TODAY);
  const v2 = normalize({ ...v3, version: 2 }, TODAY);
  assert.equal(v2.awards.backfilledAt, null);
  assert.deepEqual(Object.keys(v2.awards.badges).sort(), Object.keys(aw.badges).sort());
  const back = run(s, 'backfill', v2.awards);
  for (const k of Object.keys(back.wins)) assert.ok(!(k in v2.awards.wins), k);
  for (const k of Object.keys(back.badges)) assert.ok(!(k in v2.awards.badges), k);
});

test('R27 schema 3 backups are accepted, newer ones refused', () => {
  assert.doesNotThrow(() => parseBackup('{"app":"glow-fitness","schema":3,"data":{"workouts":[]}}'));
  assert.throws(() => parseBackup('{"app":"glow-fitness","schema":4,"data":{"workouts":[]}}'), /newer version/);
});

test('R28 Full Spectrum needs every active type (but not Other)', () => {
  const ws = ['ride', 'run', 'walk', 'strength', 'yoga'].map((type, i) => W(addDaysKey('2026-09-20', i), 30, { type }));
  let e = ev(S({ workouts: ws })).get('allTypes');
  assert.deepEqual([e.value, e.target, e.missing, e.on], [5, 6, ['HIIT'], null]);
  e = ev(S({ workouts: [...ws, W('2026-10-03', 30, { type: 'hiit' })] })).get('allTypes');
  assert.equal(e.on, '2026-10-03');
  const types = DEFAULT_TYPES.map((t) => ({ ...t, archived: ['ride', 'run', 'walk'].includes(t.id) }));
  e = ev(S({ workouts: ws, settings: { types } })).get('allTypes');
  assert.equal(e.tooFew, true);
});

test('R29 early bird and night owl windows', () => {
  const times = ['03:59', '04:00', '06:59', '07:00', '21:00'];
  const f = facts(S({ workouts: times.map((time, i) => W(addDaysKey('2026-09-01', i), 30, { time })) }), derive(S(), TODAY), {}, TODAY);
  assert.deepEqual([f.owl.length, f.early.length], [2, 2]);
  assert.deepEqual(f.early, ['2026-09-02', '2026-09-03']);
  assert.deepEqual(f.owl, ['2026-09-01', '2026-09-05']);
});

test('R30 comeback and weekend warrior', () => {
  const on = (ws, id) => ev(S({ workouts: ws })).get(id).on;
  assert.equal(on([W('2026-09-01'), W('2026-09-15')], 'comeback'), '2026-09-15');
  assert.equal(on([W('2026-09-01'), W('2026-09-14')], 'comeback'), null);
  assert.equal(on([W('2026-10-03'), W('2026-10-04')], 'weekend'), '2026-10-04');
  assert.equal(on([W('2026-09-27'), W('2026-10-03')], 'weekend'), null);
});

// WCAG contrast and hue helpers
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lum = (h) => hex(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hue = (h) => {
  const [r, g, b] = hex(h); const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const dl = mx - mn;
  if (!dl) return 0;
  const v = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
  return (v * 60 + 360) % 360;
};
const hueGap = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };

test('R31 palettes keep text readable and ring colors distinct', () => {
  for (const [id, p] of Object.entries(PALETTES)) {
    for (const mode of ['dark', 'light']) {
      const v = p[mode];
      assert.ok(contrast(v['--on-accent'], v['--pink']) >= 3.0, `${id} ${mode} on-accent contrast ${contrast(v['--on-accent'], v['--pink']).toFixed(2)}`);
      const [A, B, C] = [v['--pink'], v['--cyan'], v['--purple']];
      for (const [x, y] of [[A, B], [A, C], [B, C]]) assert.ok(hueGap(x, y) >= 30, `${id} ${mode} hues ${x} ${y}`);
    }
  }
});

test('R32 the Glow palette matches the stylesheet', () => {
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const block = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
  const read = (b, v) => (b.match(new RegExp(`${v}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1]?.toUpperCase();
  const dark = block(':root,\n[data-glow-theme="dark"]');
  const light = block('[data-glow-theme="light"] {');
  for (const v of ['--bg', '--card', '--card-2', '--card-3', '--pink', '--cyan', '--purple', '--lime']) {
    assert.equal(read(dark, v), PALETTES.glow.dark[v].toUpperCase(), `dark ${v}`);
    assert.equal(read(light, v), PALETTES.glow.light[v].toUpperCase(), `light ${v}`);
  }
});

test('R33 copy lines are stable and personal', () => {
  const pool = ['A {name}', 'B {name}', 'C {name}'];
  assert.equal(pickLine('goal:g:M:2026-10', pool, { name: 'Mel' }), pickLine('goal:g:M:2026-10', pool, { name: 'Mel' }));
  assert.match(pickLine('k', pool, { name: '  ' }), /friend$/);
});

test('R34 rewards stay fast on five years of data', () => {
  const ws = [];
  let d = '2021-10-10';
  for (let i = 0; i < 2500; i++) { ws.push(W(d, 20 + (i % 50), { distanceKm: i % 3 ? 5 : null })); d = addDaysKey(d, i % 3 === 0 ? 1 : 0); }
  const s = S({ workouts: ws, goals: [goalM({ createdAt: '2022-01-01T00:00:00.000Z', updatedAt: '2022-01-01T00:00:00.000Z' })] });
  const dd = derive(s, TODAY);
  let t = performance.now();
  collect(s, dd, EMPTY(), { today: TODAY, mode: 'backfill' });
  const back = performance.now() - t;
  t = performance.now();
  collect(s, dd, EMPTY(), { today: TODAY, mode: 'live' });
  const live = performance.now() - t;
  assert.ok(back < 300, `backfill ${back.toFixed(0)} ms`);
  assert.ok(live < 80, `live ${live.toFixed(0)} ms`);
});

test('R35 compliments', () => {
  const first = W('2026-10-01');
  assert.equal(compliment(S({ workouts: [first] }), first, TODAY, 'Mel'), 'Welcome to Glow, Mel!');
  const a = W('2026-09-28', 30, { type: 'yoga' });
  const b = W('2026-10-02', 30, { type: 'yoga' });
  assert.equal(compliment(S({ workouts: [W('2026-09-10'), a, b] }), b, TODAY, 'Mel'), 'First workout of October!');
  const c = W('2026-10-03', 30, { type: 'yoga' });
  assert.equal(compliment(S({ workouts: [W('2026-09-10'), a, b, c] }), c, TODAY, 'Mel'), 'Your 3rd yoga this week');
});
