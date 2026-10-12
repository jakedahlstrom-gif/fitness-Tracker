// Unit tests for the Stage 4 Insights engine. Run with: npm test
// (and npm run test:tz, which repeats this file in two odd time zones). No dependencies needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { derive } from '../js/progress.js';
import {
  dayNum, keyOf, weekdayOf, buildIndex, heatScale, heatLevel, heatRamp, HEAT_RAMP, monthGrid, yearStrip,
  recentWeeks, rangeOf, series, avgWeek, kpis, typeMix, powerDay, feelByType, isTimed, timeBucket,
  computeInsights, highlights, recapYears, recapOffer, yearRecap,
} from '../js/insights.js';
import { PALETTES } from '../js/looks.js';
import { DEFAULT_TYPES } from '../js/schema.js';
import { addDaysKey, parseKey } from '../js/dates.js';

const TODAY = '2026-10-10'; // Saturday; Monday-start weeks: …, 09-28, 10-05
let n = 0;
const W = (date, duration = 30, extra = {}) => ({
  id: `i${String(++n).padStart(4, '0')}`, type: 'run', date, time: '12:00', duration, distanceKm: null,
  feel: null, mood: null, note: '', photoId: null,
  createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}Z`, ...extra,
});
const fill = (mon, k, dur = 30) => Array.from({ length: k }, (_, i) => W(addDaysKey(mon, i), dur));
const S = (over = {}) => ({
  settings: {
    weekStart: 1, units: 'km', targets: { workouts: 3, minutes: 150, days: 3 },
    targetHistory: [{ from: '2000-01-01', workouts: 3, minutes: 150, days: 3 }], featuredGoalId: null,
    types: DEFAULT_TYPES.map((t) => ({ ...t })), ...(over.settings || {}),
  },
  workouts: over.workouts || [], goals: over.goals || [], restDays: over.restDays || [],
  awards: { wins: {}, badges: {}, unlocksSeen: [], ...(over.awards || {}) },
});
const IX = (state, today = TODAY) => buildIndex(state, today, derive(state, today));
const recap = (state, year, today = TODAY) => yearRecap(state, derive(state, today), year, today);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-3, `${msg ?? ''} ${a} ≈ ${b}`);

test('I1 day numbers round-trip and match local dates', () => {
  for (let k = '2000-01-01'; k <= '2030-12-31'; k = addDaysKey(k, 1)) {
    const d = dayNum(k);
    assert.ok(Number.isInteger(d));
    assert.equal(keyOf(d), k);
    assert.equal(keyOf(d + 1), addDaysKey(k, 1));
    assert.equal(weekdayOf(k), parseKey(k).getDay());
  }
});

test('I2 buildIndex: days, untimed, future and rest', () => {
  const ix = IX(S({ workouts: [W('2026-10-01', 30), W('2026-10-01', null), W('2026-10-12', 40)], restDays: ['2026-10-03'] }));
  const day = ix.days.get('2026-10-01');
  assert.deepEqual([day.n, day.min, day.untimed], [2, 30, 1]);
  assert.equal(ix.days.has('2026-10-12'), false);
  assert.equal(ix.rest.has('2026-10-03'), true);
  assert.deepEqual(ix.months, ['2026-10']);
});

test('I3 heatScale follows her targets', () => {
  assert.deepEqual(heatScale({ minutes: 150, days: 3 }), [25, 50, 75]);
  assert.deepEqual(heatScale({ minutes: 60, days: 6 }), [10, 20, 30]);
  assert.deepEqual(heatScale({ minutes: 600, days: 3 }), [60, 120, 180]);
});

test('I4 heatLevel thresholds; a logged day is never blank', () => {
  const s = [25, 50, 75];
  const lv = [undefined, { n: 1, min: 0 }, 24, 25, 49, 50, 74, 75].map((x) => heatLevel(typeof x === 'number' ? { n: 1, min: x } : x, s));
  assert.deepEqual(lv, [0, 1, 1, 2, 2, 3, 3, 4]);
});

test('I5 heat ramp contrast in every palette, and CSS tokens equal HEAT_RAMP', () => {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const [id, p] of Object.entries(PALETTES)) {
    for (const theme of ['dark', 'light']) {
      const s = p[theme];
      const L = heatRamp(s['--pink'], s['--card'], s['--card-2'], theme);
      assert.equal(L.length, 5);
      for (let i = 1; i < 5; i++) assert.ok(cr(L[i], L[i - 1]) >= 1.15, `${id} ${theme} L${i - 1}/L${i}`);
      assert.ok(cr(L[4], s['--card']) >= 3, `${id} ${theme} L4 vs card`);
    }
  }
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const block = (re) => {
    const body = css.match(re)[1];
    return [1, 2, 3].map((i) => Number(body.match(new RegExp(`--h${i}:\\s*(\\d+)%`))[1]));
  };
  assert.deepEqual(block(/:root,\s*\[data-glow-theme="dark"\]\s*\{([^}]*)\}/), HEAT_RAMP.dark);
  assert.deepEqual(block(/\[data-glow-theme="light"\]\s*\{([^}]*)\}/), HEAT_RAMP.light);
});

test('I6 monthGrid layout for both week starts', () => {
  for (const [ws, c0, lead, c41] of [[1, '2026-09-28', 3, '2026-11-08'], [0, '2026-09-27', 4, '2026-11-07']]) {
    const g = monthGrid(IX(S({ settings: { weekStart: ws }, workouts: [W('2026-10-01')] })), '2026-10');
    assert.equal(g.cells.length, 42);
    assert.equal(g.cells[0].key, c0);
    assert.equal(g.cells[0].inMonth, false);
    assert.equal(g.lead, lead);
    assert.equal(g.cells[41].key, c41);
    const at = (k) => g.cells.find((c) => c.key === k);
    assert.equal(at('2026-10-10').today, true);
    assert.deepEqual([at('2026-10-11').future, at('2026-10-11').level], [true, 0]);
    assert.equal(at('2026-10-01').level, 2);
  }
});

test('I7 monthGrid month lengths and leads', () => {
  const ix1 = IX(S());
  const ix0 = IX(S({ settings: { weekStart: 0 } }));
  assert.deepEqual([monthGrid(ix1, '2026-02').lead, monthGrid(ix1, '2026-02').len], [6, 28]);
  assert.deepEqual([monthGrid(ix0, '2026-02').lead, monthGrid(ix0, '2026-02').len], [0, 28]);
  assert.equal(monthGrid(ix1, '2024-02').len, 29);
});

test('I8 monthGrid rest, workout-wins and record flags', () => {
  const ix = IX(S({
    workouts: [W('2026-10-02'), W('2026-10-04')], restDays: ['2026-10-02', '2026-10-03'],
    awards: { wins: { 'pr:longestWorkout:x': { kind: 'pr', on: '2026-10-04', record: 'longestWorkout', value: 30 } } },
  }));
  const g = monthGrid(ix, '2026-10');
  const at = (k) => g.cells.find((c) => c.key === k);
  assert.deepEqual([at('2026-10-03').rest, at('2026-10-03').level], [true, 0]);
  assert.equal(at('2026-10-02').rest, false);
  assert.ok(at('2026-10-02').level >= 1);
  assert.equal(at('2026-10-04').pr, true);
  assert.deepEqual(g.totals, { n: 2, min: 60, active: 2, rest: 1 });
});

test('I9 monthGrid best month needs 2 prior months', () => {
  const big = [W('2026-07-06', 100), W('2026-08-03', 100), W('2026-09-07', 100), W('2026-10-05', 200)];
  const g = monthGrid(IX(S({ workouts: big })), '2026-10');
  assert.equal(g.best, true);
  assert.equal(g.prevMin, 100);
  assert.equal(monthGrid(IX(S({ workouts: [W('2026-09-07', 100), W('2026-10-05', 200)] })), '2026-10').best, false);
  assert.equal(monthGrid(IX(S({ workouts: [W('2026-10-05', 200)] })), '2026-10').prevMin, null);
});

test('I10 yearStrip columns, outside and future cells', () => {
  const s = yearStrip(IX(S({ workouts: [W('2026-01-02', 80)] })), 2026);
  assert.equal(s.cols.length, 53);
  assert.equal(s.cols[0].wk, '2025-12-29');
  assert.equal(s.cols[0].mark, 'J');
  assert.deepEqual(s.cols[0].levels.slice(0, 3), [-1, -1, -1]);
  assert.ok(s.cols[0].levels.slice(3).every((l) => l >= 0));
  assert.equal(s.cols[0].levels[4], 4);
  assert.equal(s.cols.filter((c) => c.mark).map((c) => c.mark).join(''), 'JFMAMJJASOND');
  assert.equal(s.cols[52].levels[0], -2);
  assert.equal(s.cols[52].levels[4], -1);
  assert.equal(yearStrip(IX(S({ settings: { weekStart: 0 } })), 2028).cols.length, 54);
});

test('I11 recentWeeks', () => {
  const r = recentWeeks(IX(S({ workouts: [W('2026-10-09')] })), 26);
  assert.equal(r.length, 26);
  const last = r[25];
  assert.equal(last.wk, '2026-10-05');
  assert.deepEqual([last.cells[5].key, last.cells[5].today], ['2026-10-10', true]);
  assert.deepEqual([last.cells[6].key, last.cells[6].future], ['2026-10-11', true]);
  assert.equal(last.cells[4].level, 2);
});

test('I12 rangeOf weekly ranges', () => {
  const r1 = rangeOf('3m', IX(S({ workouts: [W('2025-01-06')] })));
  assert.deepEqual([r1.from, r1.to, r1.end, r1.unit, r1.keys.length, r1.weeks], ['2026-07-13', '2026-10-12', '2026-10-11', 'week', 13, 13]);
  assert.deepEqual(r1.prev, { from: '2026-04-13', to: '2026-07-12' });
  const r0 = rangeOf('3m', IX(S({ settings: { weekStart: 0 }, workouts: [W('2025-01-06')] })));
  assert.deepEqual([r0.from, r0.to, r0.keys.length], ['2026-07-12', '2026-10-11', 13]);
  assert.deepEqual(r0.prev, { from: '2026-04-12', to: '2026-07-12' });
});

test('I13 rangeOf clips to her first week', () => {
  const r = rangeOf('3m', IX(S({ workouts: [W('2026-09-30')] })));
  assert.deepEqual([r.from, r.keys], ['2026-09-28', ['2026-09-28', '2026-10-05']]);
  assert.equal(r.prev, null);
});

test('I14 rangeOf all: monthly beyond 52 weeks', () => {
  const m = rangeOf('all', IX(S({ workouts: [W('2024-03-02')] })));
  assert.deepEqual([m.unit, m.keys.length, m.from, m.keys[0], m.to, m.prev], ['month', 32, '2024-03-01', '2024-03', '2026-11-01', null]);
  const w = rangeOf('all', IX(S({ workouts: [W('2026-01-15')] })));
  assert.deepEqual([w.unit, w.from, w.prev], ['week', '2026-01-12', null]);
  const e = rangeOf('all', IX(S()));
  assert.deepEqual([e.unit, e.keys], ['week', ['2026-10-05']]);
});

test('I15 series keeps the target in effect each week', () => {
  const ix = IX(S({
    settings: { targets: { workouts: 3, minutes: 200, days: 3 }, targetHistory: [{ from: '2000-01-01', workouts: 3, minutes: 150, days: 3 }, { from: '2026-09-21', workouts: 3, minutes: 200, days: 3 }] },
    workouts: [W('2026-09-14', 160), W('2026-09-21', 180), W('2026-09-28', 200), W('2026-10-05', 50)],
  }));
  const b = series(ix, rangeOf('3m', ix));
  assert.deepEqual(b.map((x) => [x.key, x.min, x.target, x.met, x.partial]), [
    ['2026-09-14', 160, 150, true, false], ['2026-09-21', 180, 200, false, false],
    ['2026-09-28', 200, 200, true, false], ['2026-10-05', 50, 200, false, true],
  ]);
  assert.deepEqual(b.map((x) => x.best), [false, false, true, false]);
});

test('I16 series best and avgWeek', () => {
  const ix = IX(S({ workouts: [W('2026-09-28', 120), W('2026-10-01', 60), W('2026-10-06', 50)] }));
  const r = rangeOf('3m', ix);
  const b = series(ix, r);
  assert.deepEqual(b.map((x) => [x.key, x.min, x.partial, x.best]), [['2026-09-28', 180, false, false], ['2026-10-05', 50, true, false]]);
  assert.equal(avgWeek(ix, r), 180);
  assert.equal(avgWeek(IX(S({ workouts: [W('2026-10-06', 50)] })), rangeOf('3m', IX(S({ workouts: [W('2026-10-06', 50)] })))), null);
});

test('I17 kpis delta against the previous window', () => {
  const ix = IX(S({ workouts: [W('2026-01-05', 10), W('2026-05-01', 100), W('2026-08-01', 112)] }));
  const k = kpis(ix, rangeOf('3m', ix));
  assert.deepEqual([k.count, k.min, k.active, k.prev], [1, 112, 1, { count: 1, min: 100, active: 1 }]);
  near(k.delta.min, 0.12);
  assert.equal(k.delta.count, 0);
  const iy = IX(S({ workouts: [W('2026-05-01', 100), W('2026-08-01', 112)] }));
  const j = kpis(iy, rangeOf('3m', iy));
  assert.equal(j.prev, null);
  assert.equal(j.delta.min, null);
});

test('I18 typeMix by count and by time', () => {
  const ws = [W('2026-10-01', 30), W('2026-10-02', 30), W('2026-10-03', 30),
    W('2026-10-04', 60, { type: 'ride' }), W('2026-10-05', 60, { type: 'ride' }), W('2026-10-06', null, { type: 'yoga' })];
  const ix = IX(S({ workouts: ws }));
  const c = typeMix(ix, '2026-09-28', '2026-10-11', 'count');
  assert.deepEqual(c.rows.map((x) => x.typeId), ['run', 'ride', 'yoga']);
  [0.5, 1 / 3, 1 / 6].forEach((v, i) => near(c.rows[i].share, v));
  assert.equal(c.canTime, true);
  const m = typeMix(ix, '2026-09-28', '2026-10-11', 'min');
  assert.deepEqual([m.by, m.total, m.rows.map((x) => x.typeId)], ['min', 210, ['ride', 'run']]);
  near(m.rows[0].share, 4 / 7);
  near(m.rows[1].share, 3 / 7);
  const z = typeMix(IX(S({ workouts: [W('2026-10-01', null), W('2026-10-02', null)] })), '2026-09-28', '2026-10-11', 'min');
  assert.deepEqual([z.by, z.canTime, z.total], ['count', false, 2]);
});

test('I19 typeMix overflow: top 5 + __more; unknown ids merge; other stays separate', () => {
  const plan = [['ride', 8], ['run', 7], ['other', 6], ['zz', 3], ['yy', 2], ['walk', 4], ['strength', 3], ['yoga', 2], ['hiit', 1]];
  const ws = [];
  let i = 0;
  for (const [type, k] of plan) for (let j = 0; j < k; j++) ws.push(W(addDaysKey('2026-10-01', i++ % 10), 30, { type }));
  const m = typeMix(IX(S({ workouts: ws })), '2026-09-28', '2026-10-11');
  assert.deepEqual(m.rows.map((x) => [x.typeId, x.n]), [['ride', 8], ['run', 7], ['other', 6], ['__unknown', 5], ['walk', 4], ['__more', 6]]);
  assert.deepEqual(m.rows[5].ids, ['strength', 'yoga', 'hiit']);
  near(m.rows.reduce((s, x) => s + x.share, 0), 1);
});

const ANCHOR = () => W('2026-01-07', 30); // a first workout well before the 3M window

test('I20 powerDay: average minutes per occurrence', () => {
  const ws = [ANCHOR()];
  for (let k = '2026-08-08'; k <= '2026-10-03'; k = addDaysKey(k, 7)) ws.push(W(k, 60));
  for (let k = '2026-09-14'; k <= '2026-10-05'; k = addDaysKey(k, 7)) ws.push(W(k, 30));
  const ix = IX(S({ workouts: ws }));
  const r = rangeOf('3m', ix);
  const p = powerDay(ix, r.from, r.end);
  const sat = p.days.find((x) => x.dow === 6);
  assert.deepEqual([sat.occ, sat.active, sat.score, sat.rank, sat.frac], [12, 9, 45, 0, 1]);
  assert.equal(p.days.find((x) => x.dow === 1).occ, 13);
  assert.deepEqual(p.days.map((x) => x.dow), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual([p.best, p.show, p.tie, p.need, p.activeDays], [6, true, false, 0, 13]);
  assert.equal(p.top, sat);
  // Today counts once she has logged
  const q = powerDay(IX(S({ workouts: [...ws, W(TODAY, 60)] })), r.from, r.end);
  assert.equal(q.days.find((x) => x.dow === 6).occ, 13);
});

test('I21 powerDay tie', () => {
  const ws = [ANCHOR(), W('2026-09-12'), W('2026-09-19'), W('2026-09-26'), W('2026-10-03'),
    W('2026-09-14'), W('2026-09-21'), W('2026-09-28'), W('2026-10-05', 40)];
  const ix = IX(S({ workouts: ws }));
  const r = rangeOf('3m', ix);
  const p = powerDay(ix, r.from, r.end);
  assert.deepEqual([p.days.find((x) => x.dow === 6).score, p.days.find((x) => x.dow === 1).score], [10, 10]);
  assert.equal(p.tie, true);
  assert.equal(p.show, true);
});

test('I22 powerDay needs 8 active days', () => {
  const ix = IX(S({ workouts: fill('2026-09-28', 7) }));
  const r = rangeOf('3m', ix);
  const p = powerDay(ix, r.from, r.end);
  assert.deepEqual([p.show, p.need], [false, 1]);
  const e = powerDay(IX(S()), '2026-07-13', '2026-10-12');
  assert.deepEqual([e.best, e.show, e.need, e.tie], [null, false, 8, false]);
});

test('I23 feelByType', () => {
  const f = (type, feels) => feels.map((feel, i) => W(addDaysKey('2026-10-01', i), 30, { type, feel }));
  const base = [...f('yoga', [5, 5, 4]), ...f('hiit', [5, 5]), W('2026-10-08', 30, { feel: null })];
  const a = feelByType(IX(S({ workouts: [...base, ...f('run', [4, 4, 4, 3])] })), '2026-09-28', '2026-10-11');
  assert.deepEqual(a.rows.map((x) => [x.typeId, x.n]), [['yoga', 3], ['run', 4]]);
  near(a.rows[0].avg, 4.667);
  near(a.rows[1].avg, 3.75);
  assert.deepEqual([a.hidden, a.rated, a.best], [1, 9, 'yoga']);
  const b = feelByType(IX(S({ workouts: [...base, ...f('run', [5, 5, 4])] })), '2026-09-28', '2026-10-11');
  assert.equal(b.best, null);
});

test('I24 isTimed and timeBucket', () => {
  const at = (time, created = '2026-10-08') => ({ date: '2026-10-08', time, createdAt: `${created}T${time === '12:00' ? '09:30' : time}:00` });
  const times = ['03:59', '04:00', '07:59', '08:00', '11:59', '12:00', '17:00', '21:00'];
  assert.deepEqual(times.map((t) => isTimed(at(t))), times.map(() => true));
  assert.deepEqual(times.map(timeBucket), ['night', 'early', 'early', 'morning', 'morning', 'afternoon', 'evening', 'night']);
  assert.equal(isTimed(at('12:00', '2026-10-10')), false);
  assert.equal(isTimed({ date: '2026-10-08', time: '12:00', createdAt: 'nope' }), false);
});

test('I25 highlights order and stability', () => {
  const ws = [];
  for (const mon of ['2026-09-21', '2026-09-28', '2026-10-05']) {
    ws.push(W(mon, 20), W(addDaysKey(mon, 2), 20), W(addDaysKey(mon, 5), 60));
  }
  const ix = IX(S({ workouts: ws }));
  assert.equal(ix.weekly.current, 3);
  const ins = computeInsights(ix, '3m');
  const h = highlights(ix, ins);
  assert.deepEqual(h.map((x) => x.id), ['powerDay', 'streak', 'fallback']);
  assert.deepEqual(h[0].data, { dow: 6, active: 3, occ: 3, min: 180 });
  assert.deepEqual(highlights(ix, ins), h);
  assert.deepEqual(highlights(IX(S()), computeInsights(IX(S()), '3m')).map((x) => [x.id, x.data.empty]), [['fallback', true]]);
  // Minutes up ≥ 10% over the 4 completed weeks before
  const up = [...['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'].map((k) => W(k, 50)), ...['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'].map((k) => W(k, 55))];
  const iu = IX(S({ workouts: up }));
  assert.deepEqual(highlights(iu, computeInsights(iu, '3m')).find((x) => x.id === 'minutesUp')?.data, { pct: 10, min: 220, prev: 200 });
});

test('I26 recapYears and recapOffer', () => {
  const ws = [W('2024-03-01'), W('2024-06-01'), ...fill('2025-05-05', 5), W('2026-02-01'), W('2026-03-01'), W('2026-04-01')];
  const s = S({ workouts: ws });
  assert.deepEqual(recapYears(IX(s)), [{ year: '2026', n: 3, current: true }, { year: '2025', n: 5, current: false }, { year: '2024', n: 2, current: false }]);
  const offer = (today, seen = {}) => recapOffer(IX(s, today), seen);
  assert.equal(offer('2026-10-10'), null);
  assert.equal(offer('2026-12-02'), '2026');
  assert.equal(offer('2027-01-15'), '2026');
  assert.equal(offer('2027-02-01'), null);
  assert.equal(offer('2026-12-02', { 2026: 'watched' }), null);
  assert.equal(offer('2024-12-05'), null);
});

test('I27 yearRecap: a partial first year', () => {
  const s = S({ workouts: [W('2025-08-12'), W('2025-09-01'), W('2025-10-01'), W('2026-02-01')] });
  const r = recap(s, 2025);
  assert.deepEqual([r.year, r.since, r.through, r.current, r.soFar], ['2025', '2025-08-12', '2025-12-31', false, false]);
  near(r.perWeek, 3 / (142 / 7));
  assert.deepEqual(r.quilt.map((m) => m.state).slice(6, 9), ['before', 'past', 'past']);
  assert.equal(recap(s, 2026).since, null);
  assert.equal(recap(s, 2024), null);
});

test('I28 yearRecap streaks respect the year boundary', () => {
  const s = S({
    workouts: [...fill('2025-12-15', 3), ...fill('2025-12-22', 3), W('2025-12-30'), W('2025-12-31'), W('2026-01-01'), W('2026-01-02'), W('2026-01-04'),
      W('2026-01-07'), W('2026-01-09'), W('2026-01-11'), W('2026-01-13'), W('2026-01-15'), W('2026-01-17')],
    restDays: ['2026-01-03'],
  });
  const r26 = recap(s, 2026);
  assert.deepEqual(r26.streaks.weekly, { value: 3, from: '2025-12-29', to: '2026-01-12', frozen: 0 });
  assert.deepEqual(r26.streaks.daily, { value: 3, from: '2026-01-01', to: '2026-01-04' });
  assert.equal(recap(s, 2025).streaks.weekly.value, 2);
  assert.equal(r26.weeks[0].key, '2025-12-29');
  const mwf = (mon) => [W(mon), W(addDaysKey(mon, 2)), W(addDaysKey(mon, 4))];
  const t = S({ workouts: ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-04-06'].flatMap(mwf) });
  assert.deepEqual(recap(t, 2026).streaks.weekly, { value: 5, from: '2026-03-02', to: '2026-04-06', frozen: 1 });
});

test('I29 yearRecap ledger: PRs and badges by `on`', () => {
  const s = S({
    workouts: [W('2025-06-01'), W('2026-02-01')],
    awards: {
      wins: {
        'pr:longestWorkout:a': { kind: 'pr', on: '2026-03-01', record: 'longestWorkout', value: 80, prev: 60 },
        'pr:longestWorkout:b': { kind: 'pr', on: '2026-06-01', record: 'longestWorkout', value: 95, prev: 80 },
        'pr:bestWeek:2025-12-29': { kind: 'pr', on: '2025-12-31', record: 'bestWeek', value: 300, prev: 250 },
      },
      badges: { w10: { on: '2026-02-01' }, ds7: { on: '2026-04-01' }, zzz: { on: '2026-05-01' }, w1: { on: '2025-06-01' } },
    },
  });
  const r = recap(s, 2026);
  assert.equal(r.prCount, 2);
  assert.deepEqual(r.prs.map((p) => [p.record, p.value, p.on]), [['longestWorkout', 95, '2026-06-01']]);
  assert.deepEqual(r.badges.map((b) => b.id), ['ds7', 'w10']);
  const q = recap(s, 2025);
  assert.deepEqual(q.prs.map((p) => p.record), ['bestWeek']);
  assert.deepEqual(q.badges.map((b) => b.id), ['w1']);
});

test('I30 yearRecap moment and photos', () => {
  const a = W('2026-06-14', 75, { feel: 5 });
  const r = recap(S({ workouts: [a, W('2026-08-02', 40, { feel: 4, photoId: 'p1' })] }), 2026);
  assert.deepEqual([r.moment.date, r.moment.reason, r.moment.photoId], ['2026-08-02', 'photo', 'p1']);
  const q = recap(S({ workouts: [a, W('2026-08-02', 20, { feel: 2, photoId: 'p1', note: 'x'.repeat(100) })] }), 2026);
  assert.deepEqual([q.moment.date, q.moment.reason, q.moment.min, q.moment.feel], ['2026-06-14', 'best', 75, 5]);
  assert.deepEqual(q.photoIds, ['p1']);
});

test('I31 yearRecap slides', () => {
  const r = recap(S({ workouts: [W('2026-03-02'), W('2026-03-10')] }), 2026);
  assert.deepEqual(r.slides, ['cover', 'first', 'count', 'minutes', 'squares', 'finale']);
  const ws = Array.from({ length: 40 }, (_, i) => W(addDaysKey('2026-01-05', i * 5), 30, { feel: i < 6 ? 4 : null }));
  const s = recap(S({ workouts: ws }), 2026).slides;
  assert.ok(s.includes('top'));
  assert.ok(!s.includes('vibe'));
});

test('I32 card signatures', () => {
  const ws = [W('2026-09-28', 40, { note: 'hi' }), W('2026-10-01', 30, { type: 'yoga', feel: 4 }), W('2026-10-06', 50)];
  const ix = IX(S({ workouts: ws }));
  const a = computeInsights(ix, '3m');
  assert.deepEqual(computeInsights(ix, '3m').sig, a.sig);
  const noted = computeInsights(IX(S({ workouts: ws.map((w, i) => (i ? w : { ...w, note: 'changed' })) })), '3m');
  assert.deepEqual([noted.sig.series, noted.sig.mix], [a.sig.series, a.sig.mix]);
  const longer = computeInsights(IX(S({ workouts: ws.map((w, i) => (i ? w : { ...w, duration: 45 })) })), '3m');
  assert.notEqual(longer.sig.series, a.sig.series);
});

test('I34 performance: 5 years, 1,500 workouts', () => {
  let seed = 42;
  const rnd = () => { // mulberry32
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ws = [];
  const rest = [];
  const wins = {};
  const types = DEFAULT_TYPES.map((t) => t.id);
  for (let i = 0; i < 1500; i++) {
    const date = addDaysKey('2021-10-11', Math.floor(rnd() * 1826));
    const h = 5 + Math.floor(rnd() * 17);
    ws.push(W(date, rnd() < 0.05 ? null : 10 + Math.floor(rnd() * 80), {
      type: types[Math.floor(rnd() * types.length)], time: `${String(h).padStart(2, '0')}:15`,
      feel: rnd() < 0.6 ? 1 + Math.floor(rnd() * 5) : null, mood: rnd() < 0.3 ? '😊' : null,
      note: rnd() < 0.2 ? 'Felt strong' : '', photoId: rnd() < 0.05 ? `p${i}` : null, distanceKm: rnd() < 0.3 ? 5 : null,
    }));
    if (rnd() < 0.1) rest.push(addDaysKey(date, 1));
    if (rnd() < 0.03) wins[`pr:longestWorkout:x${i}`] = { kind: 'pr', on: date, record: 'longestWorkout', value: 90, prev: 80 };
  }
  const state = S({ workouts: ws, restDays: rest, awards: { wins, badges: { w1: { on: '2021-10-12' }, w100: { on: '2022-05-01' } } } });
  const d = derive(state, TODAY);
  const runOnce = () => {
    const t0 = performance.now();
    const ix = buildIndex(state, TODAY, d);
    for (const r of ['3m', '6m', '1y', 'all']) computeInsights(ix, r);
    for (const y of ['2022', '2023', '2024', '2025', '2026']) assert.ok(yearRecap(state, d, y, TODAY, ix));
    return performance.now() - t0;
  };
  const first = runOnce();
  const best = Math.min(first, runOnce(), runOnce());
  console.log(`I34 buildIndex + 4 ranges + 5 recaps: first ${first.toFixed(1)} ms, warm ${best.toFixed(1)} ms`);
  assert.ok(best < 80, `took ${best.toFixed(1)} ms`);
});

test('S1 store memos', async () => {
  const { store } = await import('../js/store.js');
  store.onError(() => {});
  store.reset();
  store.addWorkout({ type: 'run', duration: 30 });
  const a = store.insights('3m');
  assert.equal(store.insights('3m'), a);
  assert.equal(store.insightIndex(), store.insightIndex());
  const y = store.recap(store.insightIndex().today.slice(0, 4));
  assert.equal(y.totals.n, 1);
  assert.equal(store.recap(y.year), y);
  store.addWorkout({ type: 'run', duration: 20 });
  assert.notEqual(store.insights('3m'), a);
  assert.equal(store.insights('3m').kpis.count, 2);
  assert.equal(store.recap('1999'), null);
});

test('I33 Chart.js is pinned, cached across releases and precached files exist', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const charts = readFileSync(new URL('../js/charts.js', import.meta.url), 'utf8');
  const url = (src) => src.match(/CHART_URL = '([^']+)'/)[1];
  assert.match(url(charts), /chart\.js@\d+\.\d+\.\d+\//);
  assert.equal(url(sw), url(charts));
  const cache = sw.match(/CACHE_VERSION = '([^']+)'/)[1];
  const cdn = sw.match(/CDN_CACHE = '([^']+)'/)[1];
  assert.ok(!cdn.startsWith(cache));
  const shell = sw.match(/'\.\/(?:css|js)\/[^']+'/g).map((f) => f.slice(3, -1));
  for (const f of shell) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `missing ${f}`);
  // …and every app file is precached, so a new module can't break the app offline.
  for (const dir of ['css', 'js', 'js/views']) {
    for (const f of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((x) => /\.(js|css)$/.test(x))) {
      assert.ok(shell.includes(`${dir}/${f}`), `${dir}/${f} is not in APP_SHELL`);
    }
  }
});
