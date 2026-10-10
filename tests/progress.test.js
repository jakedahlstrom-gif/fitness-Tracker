// Unit tests for the Stage 2 engine and data migration. Run with: npm test
// (or: node --test tests/). No dependencies needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, milestones, restCheck, buildCtx, goalProgress } from '../js/progress.js';
import { normalize, normalizeGoal } from '../js/schema.js';
import { parseBackup } from '../js/backup.js';
import { addDaysKey } from '../js/dates.js';

const TODAY = '2026-10-10'; // Saturday; Mon-start weeks: 09-07, 09-14, 09-21, 09-28, 10-05
let n = 0;
const W = (date, duration = 30, extra = {}) => ({ id: 'w' + String(++n).padStart(4, '0'), type: 'run', date, time: '12:00', duration, distanceKm: null, createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}Z`, ...extra });
const fill = (mon, k, dur = 30) => Array.from({ length: k }, (_, i) => W(addDaysKey(mon, i), dur));
const S = (over = {}) => ({
  settings: { weekStart: 1, targets: { workouts: 3, minutes: 150, days: 3 }, targetHistory: [{ from: '2000-01-01', workouts: 3, minutes: 150, days: 3 }], featuredGoalId: null, ...(over.settings || {}) },
  workouts: over.workouts || [], goals: over.goals || [], restDays: over.restDays || [],
});
const states = (d) => d.weekly.weeks.map((x) => x.state);


test('T1 empty history', () => {
  const d = derive(S(), TODAY);
  assert.equal(d.weekly.current, 0); assert.equal(d.weekly.freezes, 0); assert.equal(d.daily.count, 0);
  assert.equal(d.records.longestWorkout.value, 0); assert.equal(d.records.longestWorkout.holder, null);
  assert.deepEqual(states(d), ['open']); assert.equal(d.weekly.thisWeek.toGo, 3); assert.equal(d.featured, null);
});
test('T2 earn freeze at 4th met week', () => {
  const d = derive(S({ workouts: [...fill('2026-09-07', 3), ...fill('2026-09-14', 3), ...fill('2026-09-21', 3), ...fill('2026-09-28', 3)] }), TODAY);
  assert.deepEqual(states(d), ['met', 'met', 'met', 'met', 'open']);
  assert.equal(d.weekly.current, 4); assert.equal(d.weekly.freezes, 1); assert.equal(d.weekly.earned, 1); assert.equal(d.weekly.toNextFreeze, 4);
});
test('T3 freeze spent on missed week, current week open', () => {
  const d = derive(S({ workouts: [...fill('2026-08-31', 3), ...fill('2026-09-07', 3), ...fill('2026-09-14', 3), ...fill('2026-09-21', 3), W('2026-09-28'), W('2026-10-05')] }), TODAY);
  assert.deepEqual(states(d), ['met', 'met', 'met', 'met', 'frozen', 'open']);
  assert.equal(d.weekly.current, 4); assert.equal(d.weekly.freezes, 0); assert.equal(d.weekly.used, 1); assert.equal(d.weekly.lastWeek.state, 'frozen');
  assert.equal(d.weekly.toNextFreeze, 4);
});
test('T4 backfill refunds the freeze', () => {
  const d = derive(S({ workouts: [...fill('2026-08-31', 3), ...fill('2026-09-07', 3), ...fill('2026-09-14', 3), ...fill('2026-09-21', 3), ...fill('2026-09-28', 3), W('2026-10-05')] }), TODAY);
  assert.equal(d.weekly.current, 5); assert.equal(d.weekly.freezes, 1); assert.equal(d.weekly.used, 0);
});
test('T5 two misses with one freeze', () => {
  const d = derive(S({ workouts: [...fill('2026-08-24', 3), ...fill('2026-08-31', 3), ...fill('2026-09-07', 3), ...fill('2026-09-14', 3), ...fill('2026-10-05', 3)] }), TODAY);
  assert.deepEqual(states(d), ['met', 'met', 'met', 'met', 'frozen', 'missed', 'met']);
  assert.equal(d.weekly.current, 1); assert.equal(d.weekly.best, 4); assert.equal(d.weekly.bestStart, '2026-08-24'); assert.equal(d.weekly.lastWeek.endedRun, 4);
});
test('T6 bank cap 2', () => {
  let ws = []; for (let i = 0; i < 12; i++) ws = ws.concat(fill(addDaysKey('2026-07-20', 7 * i), 3));
  const d = derive(S({ workouts: ws }), TODAY);
  assert.equal(d.weekly.current, 12); assert.equal(d.weekly.freezes, 2); assert.equal(d.weekly.earned, 2); assert.equal(d.weekly.toNextFreeze, null);
});
test('T7 miss with no streak spends nothing', () => {
  const d = derive(S({ workouts: [W('2026-09-21')] }), TODAY);
  assert.deepEqual(states(d), ['missed', 'missed', 'open']); assert.equal(d.weekly.used, 0); assert.equal(d.weekly.current, 0);
});
test('T8 target raised mid-week affects only current week', () => {
  const d = derive(S({ settings: { targets: { workouts: 4, minutes: 150, days: 3 }, targetHistory: [{ from: '2000-01-01', workouts: 3, minutes: 150, days: 3 }, { from: '2026-10-08', workouts: 4, minutes: 150, days: 3 }] },
    workouts: [...fill('2026-09-28', 3), ...fill('2026-10-05', 3)] }), TODAY);
  assert.deepEqual(d.weekly.weeks.map((x) => [x.target, x.state]), [[3, 'met'], [4, 'open']]);
  assert.equal(d.weekly.current, 1); assert.equal(d.weekly.thisWeek.toGo, 1);
});
test('T9 target lowered mid last week applies to that whole week', () => {
  const d = derive(S({ settings: { targets: { workouts: 2, minutes: 150, days: 3 }, targetHistory: [{ from: '2000-01-01', workouts: 3, minutes: 150, days: 3 }, { from: '2026-10-01', workouts: 2, minutes: 150, days: 3 }] },
    workouts: [...fill('2026-09-21', 2), ...fill('2026-09-28', 2)] }), TODAY);
  assert.deepEqual(d.weekly.weeks.map((x) => [x.key, x.target, x.state]), [['2026-09-21', 3, 'missed'], ['2026-09-28', 2, 'met'], ['2026-10-05', 2, 'open']]);
});
test('T10 week start change rebuckets', () => {
  const ws = [W('2026-09-27'), W('2026-09-28'), W('2026-09-29')];
  assert.equal(derive(S({ workouts: ws }), TODAY).weekly.best, 0);
  assert.equal(derive(S({ settings: { weekStart: 0 }, workouts: ws }), TODAY).weekly.best, 1);
});
test('T11 daily: rest bridges, today pending', () => {
  const d = derive(S({ workouts: [W('2026-10-05'), W('2026-10-06'), W('2026-10-08'), W('2026-10-09')], restDays: ['2026-10-07'] }), TODAY);
  assert.equal(d.daily.count, 4); assert.equal(d.daily.restUsed, 1); assert.equal(d.daily.start, '2026-10-05'); assert.equal(d.daily.includesToday, false); assert.equal(d.daily.best, 4);
});
test('T12 daily: no rest mark breaks; tie keeps earliest', () => {
  const d = derive(S({ workouts: [W('2026-10-05'), W('2026-10-06'), W('2026-10-08'), W('2026-10-09')] }), TODAY);
  assert.equal(d.daily.count, 2); assert.equal(d.daily.best, 2); assert.equal(d.daily.bestStart, '2026-10-05');
  assert.equal(d.records.dailyStreak.current, false);
});
test('T13 daily: leading rest not counted, rest-only chain is 0', () => {
  const d = derive(S({ workouts: [W('2026-10-08'), W('2026-10-09')], restDays: ['2026-10-07'] }), TODAY);
  assert.equal(d.daily.count, 2); assert.equal(d.daily.restUsed, 0);
  const e = derive(S({ restDays: ['2026-10-09', '2026-10-10'] }), TODAY);
  assert.equal(e.daily.count, 0); assert.equal(e.daily.restToday, true);
});
test('T14 rest mark on a workout day is ignored', () => {
  const d = derive(S({ workouts: [W('2026-10-09')], restDays: ['2026-10-09'] }), TODAY);
  assert.equal(d.daily.count, 1); assert.equal(d.daily.restUsed, 0);
});
test('T15 repair offer and result', () => {
  const ws = [...fill('2026-10-05', 4), W('2026-10-10')];
  const d = derive(S({ workouts: ws }), TODAY);
  assert.equal(d.daily.count, 1); assert.equal(d.daily.repairable, true); assert.equal(d.daily.repairCount, 4);
  const e = derive(S({ workouts: ws, restDays: ['2026-10-09'] }), TODAY);
  assert.equal(e.daily.count, 5); assert.equal(e.daily.restUsed, 1); assert.equal(e.daily.repairable, false);
});
test('T16 rest cap and window', () => {
  const ctx = buildCtx(S({ restDays: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'] }), TODAY);
  assert.deepEqual(restCheck(ctx, '2026-10-09'), { ok: false, reason: 'cap', used: 4, cap: 4 });
  assert.equal(restCheck(ctx, '2026-10-02').reason, 'too-old');
  assert.equal(restCheck(ctx, '2026-10-03').ok, true);
  assert.equal(restCheck(ctx, '2026-10-11').reason, 'future');
  assert.equal(restCheck(ctx, '2026-10-05').action, 'remove');
});
test('T17 longest workout tie keeps earliest holder', () => {
  const a = W('2026-10-01', 60), b = W('2026-10-05', 60);
  const d = derive(S({ workouts: [b, a] }), TODAY);
  assert.equal(d.records.longestWorkout.holder, a.id);
});
test('T18 PR on save: new longest workout', () => {
  const base = [W('2026-10-01', 30), W('2026-10-02', 40), W('2026-10-03', 45), W('2026-10-04', 50)];
  const b = derive(S({ workouts: base }), TODAY);
  const a = derive(S({ workouts: [...base, W('2026-10-10', 55)] }), TODAY);
  const ev = milestones(b, a).filter((e) => e.kind === 'pr');
  assert.deepEqual(ev.map((e) => [e.record, e.value, e.prev]), [['longestWorkout', 55, 50]]);
});
test('T19 PR suppressed: too little history, ties, same holder', () => {
  const two = [W('2026-10-01', 30), W('2026-10-02', 40)];
  assert.equal(milestones(derive(S({ workouts: two }), TODAY), derive(S({ workouts: [...two, W('2026-10-10', 50)] }), TODAY)).filter((e) => e.kind === 'pr').length, 0);
  const base = [W('2026-10-01', 30), W('2026-10-02', 40), W('2026-10-03', 45), W('2026-10-04', 50)];
  const b = derive(S({ workouts: base }), TODAY);
  assert.equal(milestones(b, derive(S({ workouts: [...base, W('2026-10-10', 50)] }), TODAY)).filter((e) => e.kind === 'pr').length, 0);
  const edited = base.map((w, i) => (i === 3 ? { ...w, duration: 70 } : w));
  assert.equal(milestones(b, derive(S({ workouts: edited }), TODAY)).filter((e) => e.kind === 'pr').length, 0);
});
test('T20 best week PR flags once', () => {
  const base = [W('2026-09-14', 100), W('2026-09-21', 120), W('2026-09-28', 150), W('2026-10-05', 140)];
  const b = derive(S({ workouts: base }), TODAY);
  const s1 = [...base, W('2026-10-10', 20)];
  const a1 = derive(S({ workouts: s1 }), TODAY);
  assert.deepEqual(milestones(b, a1).filter((e) => e.kind === 'pr').map((e) => [e.record, e.value, e.prev]), [['bestWeek', 160, 150]]);
  const a2 = derive(S({ workouts: [...s1, W('2026-10-10', 10)] }), TODAY);
  assert.equal(milestones(a1, a2).filter((e) => e.record === 'bestWeek').length, 0);
});
test('T21 monthly goal progress', () => {
  const g = { id: 'g1', tier: 'medium', metric: 'minutes', target: 600, typeId: null, start: null, end: null, createdAt: '2026-10-01T00:00:00Z', archivedAt: null };
  const d = derive(S({ goals: [g], workouts: [W('2026-09-30', 500), W('2026-10-01', 300), W('2026-10-05', 200), W('2026-10-09', 120)] }), TODAY);
  const p = d.goals[0];
  assert.deepEqual([p.value, p.met, p.achievedOn, p.status, p.periodKey, p.daysLeft], [620, true, '2026-10-09', 'met', 'M:2026-10', 22]);
});
test('T22 first 5K with 3.1 mi, not with 3.0 mi', () => {
  const g = { id: 'g5', tier: 'long', metric: 'longestDistance', target: 5, typeId: 'run', start: '2026-09-01', end: null, createdAt: '2026-09-01T00:00:00Z', archivedAt: null };
  const yes = derive(S({ goals: [g], workouts: [W('2026-09-20', 30, { distanceKm: 3.1 * 1.609344 })] }), TODAY).goals[0];
  assert.equal(yes.met, true); assert.equal(yes.achievedOn, '2026-09-20'); assert.equal(yes.daysLeft, null);
  const no = derive(S({ goals: [g], workouts: [W('2026-09-20', 30, { distanceKm: 3.0 * 1.609344 })] }), TODAY).goals[0];
  assert.equal(no.met, false); assert.equal(no.status, 'active');
  const ride = derive(S({ goals: [g], workouts: [W('2026-09-20', 30, { type: 'ride', distanceKm: 20 })] }), TODAY).goals[0];
  assert.equal(ride.met, false);
});
test('T23 long goal upcoming / ended', () => {
  const up = { id: 'u', tier: 'long', metric: 'workouts', target: 10, typeId: null, start: '2026-11-01', end: null, createdAt: 'x', archivedAt: null };
  const en = { id: 'e', tier: 'long', metric: 'workouts', target: 150, typeId: null, start: '2026-01-01', end: '2026-09-30', createdAt: 'x', archivedAt: null };
  const d = derive(S({ goals: [up, en], workouts: [W('2026-10-09'), ...fill('2026-09-01', 5)] }), TODAY);
  assert.deepEqual([d.goals[0].status, d.goals[0].value], ['upcoming', 0]);
  assert.deepEqual([d.goals[1].status, d.goals[1].value, d.goals[1].daysLeft], ['ended', 5, null]);
});
test('T24 days metric clamp in February', () => {
  const g = { id: 'd', tier: 'medium', metric: 'days', target: 31, typeId: null, start: null, end: null, createdAt: 'x', archivedAt: null };
  const p = goalProgress(g, buildCtx(S({ workouts: [] }), '2027-02-10'));
  assert.equal(p.target, 28);
});
test('T25 future-dated workouts ignored', () => {
  const d = derive(S({ workouts: [W('2026-10-12', 90)] }), TODAY);
  assert.equal(d.week.count, 0); assert.equal(d.records.longestWorkout.value, 0); assert.equal(d.daily.count, 0);
});
test('T26 milestones: freeze + weekMet sorted', () => {
  const base = [...fill('2026-09-14', 3), ...fill('2026-09-21', 3), ...fill('2026-09-28', 3), ...fill('2026-10-05', 2)];
  const b = derive(S({ workouts: base }), TODAY);
  const a = derive(S({ workouts: [...base, W('2026-10-10')] }), TODAY);
  assert.deepEqual(milestones(b, a).map((e) => e.kind + (e.ring ? ':' + e.ring : '')), ['freeze', 'weekMet', 'ring:days']);
  assert.equal(a.weekly.freezes, 1); assert.equal(a.weekly.current, 4);
});
test('T27 milestones: monthly goal done outranks ring', () => {
  const g = { id: 'g1', tier: 'medium', metric: 'minutes', target: 600, typeId: null, start: null, end: null, createdAt: 'x', archivedAt: null };
  const base = [W('2026-10-01', 300), W('2026-10-02', 150), W('2026-10-06', 100)];
  const b = derive(S({ goals: [g], workouts: base }), TODAY);
  const a = derive(S({ goals: [g], workouts: [...base, W('2026-10-10', 60)] }), TODAY);
  assert.deepEqual(milestones(b, a).map((e) => e.kind + (e.ring ? ':' + e.ring : '')), ['goal', 'ring:minutes']);
});
test('T28 pace', () => {
  const g = { id: 'g1', tier: 'medium', metric: 'minutes', target: 600, typeId: null, start: null, end: null, createdAt: 'x', archivedAt: null };
  const p = derive(S({ goals: [g], workouts: [W('2026-10-02', 150)] }), TODAY).goals[0];
  assert.equal(Math.round(p.pace.expected), 174); assert.equal(p.pace.onPace, false); assert.equal(Math.ceil(p.pace.behindBy / 5) * 5, 25);
});
test('T29 featured goal ordering and pin', () => {
  const mk = (id, tier, extra = {}) => ({ id, tier, metric: 'workouts', target: 100, typeId: null, start: tier === 'long' ? '2026-01-01' : null, end: null, createdAt: '2026-01-0' + id.length + 'T00:00:00Z', archivedAt: null, ...extra });
  const goals = [mk('s', 'short'), mk('ll', 'long'), mk('mmm', 'medium')];
  assert.equal(derive(S({ goals }), TODAY).featured.id, 'mmm');
  assert.equal(derive(S({ goals, settings: { featuredGoalId: 'll' } }), TODAY).featured.id, 'll');
});
test('T30 weekFilled on backfill', () => {
  const base = [...fill('2026-09-14', 3), ...fill('2026-09-21', 2), ...fill('2026-09-28', 3)];
  const b = derive(S({ workouts: base }), TODAY);
  const a = derive(S({ workouts: [...base, W('2026-09-26')] }), TODAY);
  assert.equal(b.weekly.current, 1); assert.equal(a.weekly.current, 3);
  assert.deepEqual(milestones(b, a).map((e) => e.kind), ['weekFilled']);
});

test('T31 daily streak PR: first run silent, beating it flags once', () => {
  const first = fill('2026-09-01', 3);
  const b0 = derive(S({ workouts: first.slice(0, 2) }), TODAY), a0 = derive(S({ workouts: first }), TODAY);
  assert.equal(milestones(b0, a0).filter((e) => e.kind === 'pr').length, 0);
  const base = [...first, ...fill('2026-10-07', 3)];
  const b = derive(S({ workouts: base }), TODAY);
  const a = derive(S({ workouts: [...base, W('2026-10-10')] }), TODAY);
  assert.deepEqual(milestones(b, a).filter((e) => e.kind === 'pr').map((e) => [e.record, e.value, e.prev]), [['dailyStreak', 4, 3]]);
  assert.equal(a.records.dailyStreak.current, true);
});
test('T32 weekly streak PR', () => {
  const base = [...fill('2026-08-03', 3), ...fill('2026-08-10', 3), ...fill('2026-09-21', 3), ...fill('2026-09-28', 3), ...fill('2026-10-05', 2)];
  const b = derive(S({ workouts: base }), TODAY);
  assert.equal(b.weekly.best, 2); assert.equal(b.weekly.current, 2);
  const a = derive(S({ workouts: [...base, W('2026-10-10')] }), TODAY);
  const prs = milestones(b, a).filter((e) => e.kind === 'pr').map((e) => [e.record, e.value, e.prev]);
  assert.deepEqual(prs, [['weeklyStreak', 3, 2]]);
});
test('P1 derive stays fast for 5 years of data', () => {
  const ws = []; let d = '2021-10-10';
  for (let i = 0; i < 2500; i++) { ws.push(W(d, 20 + (i % 50), { distanceKm: i % 3 ? 5 : null })); d = addDaysKey(d, i % 3 === 0 ? 1 : 0); }
  const goals = [{ id: 'a', tier: 'medium', metric: 'minutes', target: 600, typeId: null, start: null, end: null, createdAt: 'x', archivedAt: null }, { id: 'b', tier: 'long', metric: 'workouts', target: 150, typeId: null, start: '2026-01-01', end: '2026-12-31', createdAt: 'x', archivedAt: null }];
  const t0 = performance.now(); for (let i = 0; i < 20; i++) derive(S({ workouts: ws, goals }), TODAY); const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 200, `derive took ${ms.toFixed(1)} ms`);
});


// ---- Migration and backups ----

test('N1 v1 data migrates: seeded monthly goal, target history, empty rest days', () => {
  const s = normalize({ version: 1, settings: { targets: { workouts: 4, minutes: 200, days: 3 } }, workouts: [] }, TODAY);
  assert.equal(s.version, 2);
  assert.equal(s.goals.length, 1);
  assert.deepEqual([s.goals[0].tier, s.goals[0].metric, s.goals[0].target], ['medium', 'minutes', 800]);
  assert.deepEqual(s.restDays, []);
  assert.deepEqual(s.settings.targetHistory, [{ from: '2000-01-01', workouts: 4, minutes: 200, days: 3 }]);
  assert.equal(s.settings.featuredGoalId, null);
});

test('N2 v2 data keeps an empty goal list and unknown keys', () => {
  const s = normalize({ version: 2, goals: [], workouts: [] }, TODAY);
  assert.deepEqual(s.goals, []);
  const t = normalize({ version: 2, goals: [], workouts: [], awards: { x: 1 } }, TODAY);
  assert.deepEqual(t.awards, { x: 1 });
  assert.deepEqual(normalize(s, TODAY), s, 'normalize is idempotent');
});

test('N3 targets that differ from history get a dated entry', () => {
  const s = normalize({ version: 2, settings: { targets: { workouts: 5, minutes: 150, days: 3 }, targetHistory: [{ from: '2000-01-01', workouts: 3, minutes: 150, days: 3 }] }, goals: [] }, TODAY);
  assert.deepEqual(s.settings.targetHistory[1], { from: TODAY, workouts: 5, minutes: 150, days: 3 });
});

test('N4 goals are repaired', () => {
  const base = { id: 'g', createdAt: '2026-09-15T10:00:00.000Z' };
  assert.equal(normalizeGoal({ ...base, tier: 'short', metric: 'days', target: 10 }, TODAY).target, 7);
  const ld = normalizeGoal({ ...base, tier: 'medium', metric: 'longestDistance', target: 5 }, TODAY);
  assert.equal(ld.tier, 'long');
  assert.equal(ld.start, '2026-09-15');
  assert.equal(normalizeGoal({ ...base, tier: 'long', metric: 'workouts', target: 10, start: '2026-10-01', end: '2026-09-01' }, TODAY).end, null);
  assert.equal(normalizeGoal({ ...base, tier: 'weekly', metric: 'workouts' }, TODAY), null);
  assert.equal(normalizeGoal({ ...base, tier: 'long', metric: 'workouts', start: '2026-02-30' }, TODAY).start, '2026-09-15');
});

test('N5 backups from a newer version are refused', () => {
  assert.throws(() => parseBackup('{"app":"glow-fitness","schema":3,"data":{"workouts":[]}}'), /newer version/);
  assert.doesNotThrow(() => parseBackup('{"app":"glow-fitness","schema":1,"data":{"workouts":[]}}'));
});

// ---- Regressions found in review ----

test('R1 no freeze event when a backfilled freeze is spent at once', () => {
  // 3 met weeks, then a 4th week that becomes met by this save; the following finished week is empty,
  // so the freeze earned in the replay is spent straight away and the bank never grows.
  const base = [...fill('2026-08-03', 3), ...fill('2026-08-10', 3), ...fill('2026-08-17', 3), ...fill('2026-08-24', 2)];
  const b = derive(S({ workouts: base }), TODAY);
  const a = derive(S({ workouts: [...base, W('2026-08-26')] }), TODAY);
  assert.equal(a.weekly.earned, 1);
  assert.equal(a.weekly.freezes, 0);
  assert.equal(milestones(b, a).filter((e) => e.kind === 'freeze').length, 0);
});

test('R2 store.goals() lists long goals active first, whatever the creation order', async () => {
  const { store } = await import('../js/store.js');
  store.onError(() => {});
  store.reset();
  const long = (extra) => ({ tier: 'long', start: '2020-01-01', end: null, ...extra });
  const met = store.addGoal(long({ metric: 'longestDistance', target: 5, name: 'met 5k' }));
  store.addGoal({ tier: 'short', metric: 'workouts', target: 2, name: 'weekly' });
  const active = store.addGoal(long({ metric: 'workouts', target: 10000, name: 'active' }));
  store.addWorkout({ type: 'run', date: '2020-02-01', duration: 30, distanceKm: 5 });
  const longs = store.goals().filter((g) => g.tier === 'long').map((g) => g.id);
  assert.deepEqual(longs, [active.id, met.id]);
  // Undo of an archive can restore the Home pin
  store.setFeaturedGoal(active.id);
  assert.equal(store.archiveGoal(active.id), true);
  assert.equal(store.settings.featuredGoalId, null);
  store.unarchiveGoal(active.id);
  store.setFeaturedGoal(active.id);
  assert.equal(store.settings.featuredGoalId, active.id);
});
