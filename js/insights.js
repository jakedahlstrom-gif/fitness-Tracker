// Stage 4 Insights engine: heatmap levels, trend buckets, KPIs, workout mix, best
// day, feel by type and the "Your Year in Glow" model, all computed from stored
// data (nothing here is stored).
//
// Pure: no DOM, no clock (callers pass `today`), Node-importable
// (tests/insights.test.js). Day math uses integer day numbers (Date.UTC / 864e5),
// so it never drifts with time zones or DST. Windows are always [from, to) with
// `to` exclusive, and data never goes past today (future-dated workouts from a
// restore are ignored everywhere, like buildCtx does).
//
// Shared conventions:
//   - Keys are local calendar days 'YYYY-MM-DD', months 'YYYY-MM', years 'YYYY' (strings).
//   - Minutes are `w.duration || 0`; a null duration still counts as a workout and an active day.
//   - Type ids are stored ids (archived ones included); ids missing from settings.types
//     merge into '__unknown' (shown as "Workout"); the top-N remainder is '__more'.
//   - A week belongs to the year of its 4th day (Thursday for Monday-start weeks,
//     Wednesday for Sunday-start), so nothing is counted twice across New Year.

import { dateKey } from './dates.js';
import { derive, buildCtx, targetsFor, RECORD_KINDS } from './progress.js';
import { winCounts, unlockOn, fnv1a } from './rewards.js';
import { BADGE_BY_ID, RARITIES } from './badges.js';
import { mixHex } from './badgeArt.js';

export const RANGES = { '3m': 13, '6m': 26, '1y': 52, all: null }; // weeks
export const MIN = {
  powerActive: 8, powerWinner: 3, powerTie: 0.02, feelRow: 3, feelLead: 0.3,
  timed: 10, persona: 0.4, recapPromo: 3, recapFull: 3, recapFeel: 10, recapMood: 3,
};
export const HEAT_RAMP = { dark: [30, 52, 76], light: [22, 45, 70] }; // % of A over --card, L1–L3
export const SLIDES = ['cover', 'first', 'count', 'minutes', 'squares', 'top', 'rhythm',
  'bigWeek', 'streak', 'bests', 'trophies', 'vibe', 'moment', 'finale'];
export const UNKNOWN_TYPE = '__unknown';
export const MORE_TYPE = '__more';
export const TIME_BUCKETS = ['early', 'morning', 'afternoon', 'evening', 'night'];

const DAY_MS = 864e5;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const INITIALS = 'JFMAMJJASOND';
const EPS = 1e-9;
const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]));

// ---- Day numbers ----

const pad2 = (n) => (n < 10 ? '0' : '') + n;
const mod7 = (x) => ((x % 7) + 7) % 7;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** 'YYYY-MM-DD' → integer day number (days since 1970-01-01). */
export const dayNum = (key) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / DAY_MS;

/** Day number → 'YYYY-MM-DD' (the inverse of dayNum). */
export function keyOf(n) {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export const weekdayOf = (key) => mod7(dayNum(key) + 4);

/** Round to the nearest 5, never below 5. */
export const round5 = (x) => Math.max(5, Math.round(x / 5) * 5);

const addK = (key, n) => keyOf(dayNum(key) + n);
const weekStartNum = (n, ws) => n - mod7(n + 4 - ws);
const wkOf = (key, ws) => keyOf(weekStartNum(dayNum(key), ws));
const weekYear = (wk) => keyOf(dayNum(wk) + 3).slice(0, 4);
function nextMonth(mk) {
  const y = +mk.slice(0, 4);
  const m = +mk.slice(5, 7);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}
function prevMonth(mk) {
  const y = +mk.slice(0, 4);
  const m = +mk.slice(5, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

// ---- Index helpers ----

/** Canonical type id: stored ids that settings.types doesn't know merge into '__unknown'. */
const tkey = (ix, id) => (!ix.known || ix.known.has(id) ? id : UNKNOWN_TYPE);

/** First index in the chronological list whose date is ≥ key. */
function lowerBound(list, key) {
  let a = 0;
  let b = list.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (list[m].date < key) a = m + 1;
    else b = m;
  }
  return a;
}

/** Counted workouts with from ≤ date < to, chronological. */
const inRange = (ix, from, to) => ix.workouts.slice(lowerBound(ix.workouts, from), lowerBound(ix.workouts, to));

/** { n, min, active } over [from, to). */
function sumRange(ix, from, to) {
  let n = 0;
  let min = 0;
  let active = 0;
  let last = null;
  const list = ix.workouts;
  for (let i = lowerBound(list, from); i < list.length && list[i].date < to; i++) {
    const w = list[i];
    n++;
    min += w.duration || 0;
    if (w.date !== last) { active++; last = w.date; }
  }
  return { n, min, active };
}

/** The week's minutes target in effect at the time (past weeks keep their old targets). */
function targetAt(ix, wk) {
  const s = ix.settings;
  const t = s.targetHistory?.length ? targetsFor(s, wk, ix.curWk) : s.targets;
  return t.minutes;
}

// ---- Index ----

/**
 * One O(workouts + days) pass that every other function reads. `d` = derive(state, today).
 *
 * Index = {
 *   today, end (today + 1), ws (0 Sun | 1 Mon), curWk, first (first counted workout's date | null),
 *   firstWk (its week key | null), settings, targets (current), records: d.records,
 *   weekly: d.weekly, daily: d.daily,
 *   workouts: counted workouts (date ≤ today), chronological (from buildCtx),
 *   rest: Set of rest days (ctx.rest: ≤ today, no workout that day),
 *   days: Map<key, { n, min, km, untimed, feelSum, feelN, types: Map<typeId, { n, min }> }>
 *         (only dates with ≥ 1 workout; typeId is canonical),
 *   years: Map<'YYYY', workout count>,
 *   prDays: Set of `on` dates of every awards.wins 'pr:*' entry,
 *   wins: awards.wins ({} when missing),
 *   scale: heatScale(targets),
 *   months: ['YYYY-MM' from month(first ?? today) to month(today)],
 *   typeOrder: Map<typeId, index of its first workout>,
 *   known: Set of settings.types ids (null when settings.types is missing: every id is known),
 * }
 */
export function buildIndex(state, today, d = derive(state, today)) {
  const ctx = buildCtx(state, today);
  const { settings, workouts, rest, ws } = ctx;
  const known = Array.isArray(settings.types) ? new Set(settings.types.map((t) => t.id)) : null;
  const ix = {
    today, end: addK(today, 1), ws, curWk: wkOf(today, ws), first: null, firstWk: null,
    settings, targets: settings.targets, records: d.records, weekly: d.weekly, daily: d.daily,
    workouts, rest, days: new Map(), years: new Map(), prDays: new Set(), wins: state.awards?.wins || {},
    scale: heatScale(settings.targets), months: [], typeOrder: new Map(), known,
  };
  workouts.forEach((w, i) => {
    const t = tkey(ix, w.type);
    if (!ix.typeOrder.has(t)) ix.typeOrder.set(t, i);
    let day = ix.days.get(w.date);
    if (!day) ix.days.set(w.date, (day = { n: 0, min: 0, km: 0, untimed: 0, feelSum: 0, feelN: 0, types: new Map() }));
    const m = w.duration || 0;
    day.n++;
    day.min += m;
    day.km += w.distanceKm || 0;
    if (w.duration == null) day.untimed++;
    if (w.feel != null) { day.feelSum += w.feel; day.feelN++; }
    const ty = day.types.get(t);
    if (ty) { ty.n++; ty.min += m; } else day.types.set(t, { n: 1, min: m });
    const y = w.date.slice(0, 4);
    ix.years.set(y, (ix.years.get(y) || 0) + 1);
  });
  for (const [k, w] of Object.entries(ix.wins)) {
    if (k.startsWith('pr:') && w && DAY_RE.test(w.on)) ix.prDays.add(w.on);
  }
  if (workouts.length) {
    ix.first = workouts[0].date;
    ix.firstWk = wkOf(ix.first, ws);
  }
  const last = today.slice(0, 7);
  for (let m = (ix.first ?? today).slice(0, 7); m <= last; m = nextMonth(m)) ix.months.push(m);
  return ix;
}

// ---- Heat scale ----

/** Minutes thresholds for levels 2, 3 and 4, tied to her targets: 150 min / 3 days → [25, 50, 75]. */
export function heatScale(targets) {
  const m = Math.min(120, Math.max(20, round5(targets.minutes / Math.max(1, targets.days))));
  return [round5(m / 2), m, round5(1.5 * m)];
}

/** 0 = no workout; 1–4 by minutes. A logged day (even 0 minutes) is never blank. */
export function heatLevel(day, scale) {
  if (!day || !day.n) return 0;
  const [t2, t3, t4] = scale;
  return day.min >= t4 ? 4 : day.min >= t3 ? 3 : day.min >= t2 ? 2 : 1;
}

/** Literal colors for levels 0–4 (canvas and tests): [card2, A p1% over card, …p2, …p3, A]. */
export function heatRamp(aHex, cardHex, card2Hex, theme = 'dark') {
  const p = HEAT_RAMP[theme] || HEAT_RAMP.dark;
  return [card2Hex, ...p.map((q) => mixHex(aHex, q, cardHex)), aHex];
}

// ---- Calendar grids ----

/**
 * One calendar month, always 6 rows × 7 columns in week-start order.
 *
 * MonthGrid = {
 *   key: 'YYYY-MM', lead: column of day 1, len: days in month,
 *   cells[42]: in-month { key, inMonth: true, d: 1…31, level: 0–4, n, min, rest, pr, today, future }
 *              other   { key, inMonth: false },
 *   totals: { n, min, active, rest } (days ≤ today),
 *   prevMin: the previous month's minutes, or null when that month is before her first workout,
 *   best: records.bestMonth.holder === key && prior ≥ 2,
 * }
 */
export function monthGrid(ix, mk) {
  const d1 = dayNum(`${mk}-01`);
  const next = dayNum(`${nextMonth(mk)}-01`);
  const lead = mod7(d1 + 4 - ix.ws);
  const tn = dayNum(ix.today);
  const cells = new Array(42);
  const totals = { n: 0, min: 0, active: 0, rest: 0 };
  for (let i = 0; i < 42; i++) {
    const n = d1 - lead + i;
    const key = keyOf(n);
    if (n < d1 || n >= next) { cells[i] = { key, inMonth: false }; continue; }
    const day = ix.days.get(key);
    const rest = ix.rest.has(key);
    cells[i] = {
      key, inMonth: true, d: n - d1 + 1, level: heatLevel(day, ix.scale), n: day ? day.n : 0, min: day ? day.min : 0,
      rest, pr: ix.prDays.has(key), today: n === tn, future: n > tn,
    };
    if (day) { totals.n += day.n; totals.min += day.min; totals.active++; }
    if (rest) totals.rest++;
  }
  const pm = prevMonth(mk);
  const prevMin = ix.first && pm >= ix.first.slice(0, 7) ? sumRange(ix, `${pm}-01`, `${mk}-01`).min : null;
  const bm = ix.records?.bestMonth;
  return { key: mk, lead, len: next - d1, cells, totals, prevMin, best: !!bm && bm.holder === mk && bm.prior >= 2 };
}

/** The 12 MonthGrids of a year, each with state 'before' (before her first month) | 'past' | 'current' | 'future'. */
export function yearMonths(ix, year) {
  const Y = String(year);
  const start = (ix.first ?? ix.today).slice(0, 7);
  const cur = ix.today.slice(0, 7);
  return Array.from({ length: 12 }, (_, i) => {
    const mk = `${Y}-${pad2(i + 1)}`;
    const state = mk > cur ? 'future' : mk === cur ? 'current' : mk < start ? 'before' : 'past';
    return { ...monthGrid(ix, mk), state };
  });
}

/**
 * GitHub-style year strip: columns from weekKeyOf(Y-01-01) to weekKeyOf(Y-12-31)
 * (53 columns, 54 in some years, e.g. 2028 with Sunday-start weeks).
 * { year, cols: [{ wk, mark: 'J'|'F'|…|null (month initial on the column holding its day 1),
 *   levels[7]: 0–4, −1 outside the year, −2 future }] }
 */
export function yearStrip(ix, year) {
  const Y = String(year);
  const y0 = dayNum(`${Y}-01-01`);
  const y1 = dayNum(`${Y}-12-31`);
  const tn = dayNum(ix.today);
  const cols = [];
  for (let c = weekStartNum(y0, ix.ws); c <= y1; c += 7) {
    const levels = new Array(7);
    let mark = null;
    for (let i = 0; i < 7; i++) {
      const n = c + i;
      if (n < y0 || n > y1) { levels[i] = -1; continue; }
      const key = keyOf(n);
      if (key.endsWith('-01')) mark = INITIALS[+key.slice(5, 7) - 1];
      levels[i] = n > tn ? -2 : heatLevel(ix.days.get(key), ix.scale);
    }
    cols.push({ wk: keyOf(c), mark, levels });
  }
  return { year: Y, cols };
}

/** The Home week strip, oldest → newest (the last column is this week): [{ wk, cells[7]: { key, level, today, future, rest } }]. */
export function recentWeeks(ix, count = 26) {
  const tn = dayNum(ix.today);
  const cw = dayNum(ix.curWk);
  const out = [];
  for (let c = cw - 7 * (count - 1); c <= cw; c += 7) {
    const cells = new Array(7);
    for (let i = 0; i < 7; i++) {
      const n = c + i;
      const key = keyOf(n);
      cells[i] = { key, level: n > tn ? 0 : heatLevel(ix.days.get(key), ix.scale), today: n === tn, future: n > tn, rest: ix.rest.has(key) };
    }
    out.push({ wk: keyOf(c), cells });
  }
  return out;
}

// ---- Trends ----

/**
 * The window for a range id ('3m' | '6m' | '1y' | 'all'; anything else is '3m').
 *
 * Range = {
 *   range, from, to (bucket span end, exclusive), end (today + 1: data end, exclusive),
 *   unit: 'week' | 'month', keys: week keys or 'YYYY-MM' month keys, one per bucket,
 *   weeks: ceil((end − from) / 7) (= keys.length for weekly ranges),
 *   prev: { from, to } (the same window shifted back by the range length) | null,
 * }
 * Weekly ranges start at max(curWk − 7·(N−1), her first week). 'all' is weekly when her
 * first week is at most 52 buckets back, otherwise monthly from her first month. prev is null
 * for 'all', when `from` was clipped to her first week, or when it would start before her first week.
 */
export function rangeOf(range, ix) {
  const id = Object.prototype.hasOwnProperty.call(RANGES, range) ? range : '3m';
  const N = RANGES[id];
  const cw = dayNum(ix.curWk);
  const fw = ix.firstWk ? dayNum(ix.firstWk) : cw;
  const endN = dayNum(ix.end);
  const weekly = (from, prev) => {
    const keys = [];
    for (let c = from; c <= cw; c += 7) keys.push(keyOf(c));
    return { range: id, from: keyOf(from), to: keyOf(cw + 7), end: ix.end, unit: 'week', keys, weeks: Math.ceil((endN - from) / 7), prev };
  };
  if (N) {
    const want = cw - 7 * (N - 1);
    const from = Math.max(want, fw);
    let prev = null;
    if (ix.firstWk && from === want && from - 7 * N >= fw) prev = { from: keyOf(from - 7 * N), to: keyOf(endN - 7 * N) };
    return weekly(from, prev);
  }
  if (fw >= cw - 7 * 51) return weekly(fw, null);
  const keys = [];
  const last = ix.today.slice(0, 7);
  for (let m = ix.first.slice(0, 7); m <= last; m = nextMonth(m)) keys.push(m);
  const from = `${keys[0]}-01`;
  return { range: id, from, to: `${nextMonth(last)}-01`, end: ix.end, unit: 'month', keys, weeks: Math.ceil((endN - dayNum(from)) / 7), prev: null };
}

/**
 * One bucket per range key (empty buckets included).
 * Bucket = { key, from, to, min, n, target, met, partial, best }
 *   weekly:  target = that week's minutes target (past weeks keep theirs), met = min ≥ target, partial = this week
 *   monthly: target null, met false, partial = this month
 *   best: the single highest bucket (earliest wins a tie), only when ≥ 3 buckets have minutes.
 */
export function series(ix, r) {
  const out = [];
  for (const key of r.keys) {
    if (r.unit === 'week') {
      const to = addK(key, 7);
      const s = sumRange(ix, key, to);
      const target = targetAt(ix, key);
      out.push({ key, from: key, to, min: s.min, n: s.n, target, met: s.min >= target, partial: key === ix.curWk, best: false });
    } else {
      const from = `${key}-01`;
      const to = `${nextMonth(key)}-01`;
      const s = sumRange(ix, from, to);
      out.push({ key, from, to, min: s.min, n: s.n, target: null, met: false, partial: key === ix.today.slice(0, 7), best: false });
    }
  }
  let nz = 0;
  let bi = -1;
  out.forEach((b, i) => {
    if (b.min <= 0) return;
    nz++;
    if (bi < 0 || b.min > out[bi].min) bi = i;
  });
  if (nz >= 3) out[bi].best = true;
  return out;
}

/** Average minutes per completed week in [from, curWk) (monthly ranges start at her first week); null with no completed week. */
export function avgWeek(ix, r) {
  if (!ix.first) return null;
  const start = Math.max(weekStartNum(dayNum(r.from), ix.ws), dayNum(ix.firstWk));
  const weeks = (dayNum(ix.curWk) - start) / 7;
  if (weeks < 1) return null;
  return sumRange(ix, keyOf(start), ix.curWk).min / weeks;
}

/**
 * Kpis over [r.from, r.end): { count, min, active, prev: { count, min, active } | null,
 * delta: { count, min, active } } where each delta is (cur − prev) / prev, or null when
 * there is no prev window or the previous value is 0.
 */
export function kpis(ix, r) {
  const cur = sumRange(ix, r.from, r.end);
  const p = r.prev ? sumRange(ix, r.prev.from, r.prev.to) : null;
  const dl = (k) => (p && p[k] > 0 ? (cur[k] - p[k]) / p[k] : null);
  return {
    count: cur.n, min: cur.min, active: cur.active,
    prev: p && { count: p.n, min: p.min, active: p.active },
    delta: { count: dl('n'), min: dl('min'), active: dl('active') },
  };
}

/**
 * Workout mix over [from, to).
 * Mix = { by: 'count' | 'min', canTime: total minutes > 0, total: sum of values,
 *   rows: [{ typeId, n, min, value, share }] }
 * value is n (count) or min (time). by 'min' with 0 minutes falls back to 'count'.
 * Rows are sorted by value desc, then the other measure desc, then first appearance; value-0
 * rows are dropped. More than 6 types: the top 5 plus { typeId: '__more', …, ids: [merged ids] }.
 * Shares sum to 1.
 */
export function typeMix(ix, from, to, by = 'count') {
  const acc = new Map();
  let totalMin = 0;
  for (const w of inRange(ix, from, to)) {
    const t = tkey(ix, w.type);
    let a = acc.get(t);
    if (!a) acc.set(t, (a = { typeId: t, n: 0, min: 0 }));
    a.n++;
    a.min += w.duration || 0;
    totalMin += w.duration || 0;
  }
  const canTime = totalMin > 0;
  const mode = by === 'min' && canTime ? 'min' : 'count';
  const val = mode === 'min' ? 'min' : 'n';
  const other = mode === 'min' ? 'n' : 'min';
  const order = (t) => ix.typeOrder.get(t) ?? 1e9;
  let rows = [...acc.values()].map((a) => ({ ...a, value: a[val] })).filter((a) => a.value > 0)
    .sort((a, b) => b.value - a.value || b[other] - a[other] || order(a.typeId) - order(b.typeId));
  const total = rows.reduce((s, x) => s + x.value, 0);
  if (rows.length > 6) {
    const rest = rows.slice(5);
    rows = rows.slice(0, 5);
    rows.push({
      typeId: MORE_TYPE, n: rest.reduce((s, x) => s + x.n, 0), min: rest.reduce((s, x) => s + x.min, 0),
      value: rest.reduce((s, x) => s + x.value, 0), ids: rest.map((x) => x.typeId),
    });
  }
  for (const x of rows) x.share = total ? x.value / total : 0;
  return { by: mode, canTime, total, rows };
}

/**
 * Best day ("power day") over [max(from, first), min(to, end)). Today counts only once it has a workout.
 *
 * Power = {
 *   from, to: the window actually used,
 *   days[7] in week-start order: { dow: 0 Sun…6 Sat, occ (that weekday's dates in the window),
 *     active (days with a workout), n, min, score, frac (score / best score), rank (0 = winner) },
 *   best: winning dow | null, second: runner-up dow | null, top: the winner's days[] entry | null,
 *   activeDays, totalMin, byMin: score is minutes per occurrence (else active days per occurrence),
 *   show: activeDays ≥ 8 && winner.active ≥ 3, need: max(0, 8 − activeDays),
 *   tie: the runner-up scores > 0 and within 2% of the winner,
 * }
 * Sorted by score desc, then active desc, then n desc, then week-start order.
 */
export function powerDay(ix, from, to) {
  const tn = dayNum(ix.today);
  const lo = ix.first ? Math.max(dayNum(from), dayNum(ix.first)) : dayNum(ix.end);
  let hi = Math.min(dayNum(to), dayNum(ix.end));
  if (hi > tn && tn >= lo && !ix.days.has(ix.today)) hi = tn;
  const D = Math.max(0, hi - lo);
  const stats = Array.from({ length: 7 }, (_, dow) => ({ dow, occ: 0, active: 0, n: 0, min: 0, score: 0, frac: 0, rank: 0 }));
  for (let i = 0; i < Math.min(D, 7); i++) stats[mod7(lo + i + 4)].occ = Math.floor((D - 1 - i) / 7) + 1;
  let activeDays = 0;
  let totalMin = 0;
  if (D > 0) {
    let last = null;
    for (const w of inRange(ix, keyOf(lo), keyOf(hi))) {
      const s = stats[weekdayOf(w.date)];
      s.n++;
      s.min += w.duration || 0;
      totalMin += w.duration || 0;
      if (w.date !== last) { s.active++; activeDays++; last = w.date; }
    }
  }
  const byMin = totalMin > 0;
  for (const s of stats) s.score = s.occ ? (byMin ? s.min : s.active) / s.occ : 0;
  const pos = (s) => mod7(s.dow - ix.ws);
  const sorted = [...stats].sort((a, b) => b.score - a.score || b.active - a.active || b.n - a.n || pos(a) - pos(b));
  sorted.forEach((s, i) => { s.rank = i; });
  const [w1, w2] = sorted;
  for (const s of stats) s.frac = w1.score > 0 ? s.score / w1.score : 0;
  const has = activeDays > 0;
  return {
    from: keyOf(Math.min(lo, hi)), to: keyOf(hi),
    days: Array.from({ length: 7 }, (_, i) => stats[(ix.ws + i) % 7]),
    best: has ? w1.dow : null, second: has ? w2.dow : null, top: has ? w1 : null,
    activeDays, totalMin, byMin,
    show: activeDays >= MIN.powerActive && w1.active >= MIN.powerWinner,
    need: Math.max(0, MIN.powerActive - activeDays),
    tie: has && w2.score > 0 && w1.score - w2.score <= MIN.powerTie * w1.score + EPS,
  };
}

/**
 * Feel by type over [from, to), rated workouts only (feel 1–5).
 * Feel = { rows: [{ typeId, n, avg }] (n ≥ 3; avg desc, n desc, typeId; at most 6),
 *   hidden: rated types with fewer than 3 ratings, rated: rated workouts,
 *   best: rows[0].typeId when ≥ 2 rows and it leads by ≥ 0.3, else null }
 */
export function feelByType(ix, from, to) {
  const acc = new Map();
  let rated = 0;
  for (const w of inRange(ix, from, to)) {
    if (w.feel == null) continue;
    rated++;
    const t = tkey(ix, w.type);
    let a = acc.get(t);
    if (!a) acc.set(t, (a = { typeId: t, n: 0, sum: 0 }));
    a.n++;
    a.sum += w.feel;
  }
  const all = [...acc.values()];
  const rows = all.filter((a) => a.n >= MIN.feelRow).map((a) => ({ typeId: a.typeId, n: a.n, avg: a.sum / a.n }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n || cmp(a.typeId, b.typeId)).slice(0, 6);
  const best = rows.length >= 2 && rows[0].avg - rows[1].avg >= MIN.feelLead - EPS ? rows[0].typeId : null;
  return { rows, hidden: all.filter((a) => a.n < MIN.feelRow).length, rated, best };
}

// ---- Time of day ----

/** False only for the backdated default: '12:00' on a workout created on another day. */
export function isTimed(w) {
  if (!w || typeof w.time !== 'string') return false;
  if (w.time !== '12:00') return true;
  const t = Date.parse(w.createdAt);
  return !Number.isNaN(t) && dateKey(new Date(t)) === w.date;
}

/** early 04–07 · morning 08–11 · afternoon 12–16 · evening 17–20 · night 21–03. */
export function timeBucket(hhmm) {
  const h = parseInt(hhmm, 10);
  if (h >= 4 && h < 8) return 'early';
  if (h >= 8 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

// ---- Insights page ----

/**
 * Everything the Trends cards show for one range.
 * Insights = { range, r: Range, kpis: Kpis, series: Bucket[], avg: avgWeek | null,
 *   mix: { count: Mix, min: Mix }, power: Power, feel: Feel,
 *   sig: { kpis, series, mix, power, feel } } — each sig is fnv1a(JSON.stringify(part)), so a card
 *   re-renders only when its numbers change (series' sig also covers the unit and avg).
 */
export function computeInsights(ix, range) {
  const r = rangeOf(range, ix);
  const k = kpis(ix, r);
  const s = series(ix, r);
  const avg = avgWeek(ix, r);
  const mix = { count: typeMix(ix, r.from, r.end, 'count'), min: typeMix(ix, r.from, r.end, 'min') };
  const power = powerDay(ix, r.from, r.end);
  const feel = feelByType(ix, r.from, r.end);
  const h = (x) => fnv1a(JSON.stringify(x));
  return {
    range: r.range, r, kpis: k, series: s, avg, mix, power, feel,
    sig: { kpis: h(k), series: h([r.unit, avg, s]), mix: h(mix), power: h(power), feel: h(feel) },
  };
}

/**
 * Teaser highlights that qualify, in priority order (the view writes the copy).
 * [{ id, icon, data }]:
 *   bestMonth  trophy   { month: 'YYYY-MM', min }               this month is her best month ever (prior ≥ 2)
 *   minutesUp  bolt     { pct, min, prev }                      last 4 completed weeks vs the 4 before: +10% and prev ≥ 60
 *   powerDay   calendar { dow, active, occ, min }               ins3m.power.show && !tie
 *   feelBest   heart    { typeId, avg, n }                      ins3m.feel.best
 *   streak     flame    { weeks }                               weekly.current ≥ 2
 *   fallback   sparkle  { empty: no workouts at all }           always
 */
export function highlights(ix, ins3m) {
  const out = [];
  const bm = ix.records?.bestMonth;
  const mk = ix.today.slice(0, 7);
  if (bm && bm.holder === mk && bm.prior >= 2) out.push({ id: 'bestMonth', icon: 'trophy', data: { month: mk, min: bm.value } });
  const cw = dayNum(ix.curWk);
  const a = sumRange(ix, keyOf(cw - 28), ix.curWk).min;
  const b = sumRange(ix, keyOf(cw - 56), keyOf(cw - 28)).min;
  if (b >= 60 && (a - b) * 10 >= b) out.push({ id: 'minutesUp', icon: 'bolt', data: { pct: Math.round(((a - b) / b) * 100), min: a, prev: b } });
  const p = ins3m?.power;
  if (p?.show && !p.tie && p.top) out.push({ id: 'powerDay', icon: 'calendar', data: { dow: p.best, active: p.top.active, occ: p.top.occ, min: p.top.min } });
  const f = ins3m?.feel;
  if (f?.best) out.push({ id: 'feelBest', icon: 'heart', data: { typeId: f.best, avg: f.rows[0].avg, n: f.rows[0].n } });
  if ((ix.weekly?.current || 0) >= 2) out.push({ id: 'streak', icon: 'flame', data: { weeks: ix.weekly.current } });
  out.push({ id: 'fallback', icon: 'sparkle', data: { empty: !ix.first } });
  return out;
}

// ---- Your Year in Glow ----

/** Years with ≥ 1 counted workout, newest first: [{ year: 'YYYY', n, current }]. */
export function recapYears(ix) {
  const cy = ix.today.slice(0, 4);
  return [...ix.years.entries()].filter(([, n]) => n >= 1).sort((a, b) => cmp(b[0], a[0]))
    .map(([year, n]) => ({ year, n, current: year === cy }));
}

/** The year to promote: this year in December, last year in January, if it has ≥ 3 workouts and isn't in `seen`. */
export function recapOffer(ix, seen) {
  const mo = ix.today.slice(5, 7);
  const y = +ix.today.slice(0, 4);
  const Y = mo === '12' ? String(y) : mo === '01' ? String(y - 1) : null;
  if (!Y || (ix.years.get(Y) || 0) < MIN.recapPromo) return null;
  return seen && typeof seen === 'object' && seen[Y] ? null : Y;
}

const clip80 = (s) => (s.length > 80 ? `${s.slice(0, 79).trimEnd()}…` : s);

/**
 * The model behind the Year in Glow story and the year share card. Null when the year
 * has no counted workouts. `ix` defaults to buildIndex(state, today, d).
 *
 * Recap = {
 *   year: 'YYYY', current (today is in Y), soFar (current && before Dec 1), today,
 *   since: her first workout's date when it is in Y and after Jan 31 (her first chapter) | null,
 *   through: current ? today : 'Y-12-31', daysLeft: days after today until Dec 31 (0 for past years),
 *   totals: { n, min, active, rest, km, untimed, types (distinct types) },
 *   perWeek: n / (span / 7) from (since ?? Jan 1) to through; null under 14 days,
 *   first: { date, typeId, min (null when no duration), time, bucket (null when not timed), id },
 *   months[12]: { key, min, n, active }; bigMonth / brightMonth: the months[] entry with the most
 *     minutes / active days (earliest wins a tie) | null,
 *   quilt: yearMonths(ix, Y), strip: yearStrip(ix, Y),
 *   topTypes: up to 5 Mix rows by count, weekday: powerDay over the year,
 *   timeOfDay: { bucket, share, known, counts: { early…night }, hours[24] } | null
 *     (timed workouts only; null unless known ≥ 10 and share ≥ 0.4),
 *   weeks: [{ key, min, n, active }] every week whose 4th day is in Y, up to this week,
 *   bigWeek: { key, min, n, active, allTime } | null (needs ≥ 3 weeks with minutes),
 *   streaks: { weekly: { value, from, to, frozen }, daily: { value, from, to } } (from/to null at 0),
 *   bests: { longest: { value, date, typeId, id, allTime }, month: { key, min, allTime } | null },
 *   prs: [{ record, value, prev, on, key }] best per kind in RECORD_KINDS order (≤ 3), prCount: all PR wins in Y,
 *   goals: { weekly, monthly (win counts), long: [labels], total },
 *   badges: [{ id, on, rarity }] rarest first, then by date,
 *   unlocks: [{ id: 'palette:…' | 'skin:…', on }] by date,
 *   feel: { avg, n, amazing, dist[5] (feel 1…5), topMood: { emoji, n } | null, bestType, bestAvg } | null,
 *   moment: { date, min (that workout's minutes), dayMin, typeId, feel, mood, note (≤ 80 chars), photoId, reason: 'photo' | 'best' },
 *   photoIds: every photo in Y, best day first,
 *   slides: the SLIDES ids whose rule holds,
 * }
 */
export function yearRecap(state, d, year, today, ix = buildIndex(state, today, d)) {
  const Y = String(year);
  if (!/^\d{4}$/.test(Y) || !(ix.years.get(Y) > 0)) return null;
  const y0 = `${Y}-01-01`;
  const y1 = `${Y}-12-31`;
  const yEnd = `${+Y + 1}-01-01`;
  const current = today.slice(0, 4) === Y;
  const since = ix.first && ix.first.startsWith(Y) && ix.first > `${Y}-01-31` ? ix.first : null;
  const through = current ? today : y1;
  const list = inRange(ix, y0, yEnd);
  const records = d?.records || ix.records || {};

  // One pass: totals, months, longest, time of day, feel, moods and per-day moments.
  const months = Array.from({ length: 12 }, (_, i) => ({ key: `${Y}-${pad2(i + 1)}`, min: 0, n: 0, active: 0 }));
  const totals = { n: list.length, min: 0, active: 0, rest: 0, km: 0, untimed: 0, types: 0 };
  const types = new Set();
  const counts = Object.fromEntries(TIME_BUCKETS.map((b) => [b, 0]));
  const hours = new Array(24).fill(0);
  let known = 0;
  const dist = [0, 0, 0, 0, 0];
  let feelSum = 0;
  const moods = new Map();
  let longest = null;
  const days = new Map();
  list.forEach((w, i) => {
    const m = w.duration || 0;
    const mo = months[+w.date.slice(5, 7) - 1];
    let day = days.get(w.date);
    if (!day) {
      days.set(w.date, (day = { date: w.date, min: 0, maxFeel: null, note: '', mood: null, main: null, photo: null }));
      mo.active++;
      totals.active++;
    }
    mo.n++;
    mo.min += m;
    totals.min += m;
    totals.km += w.distanceKm || 0;
    if (w.duration == null) totals.untimed++;
    types.add(tkey(ix, w.type));
    if (m > 0 && (!longest || m > longest.duration)) longest = w;
    if (isTimed(w)) {
      known++;
      counts[timeBucket(w.time)]++;
      hours[parseInt(w.time, 10) % 24]++;
    }
    if (w.feel != null) { dist[w.feel - 1]++; feelSum += w.feel; }
    if (w.mood) {
      const md = moods.get(w.mood) || { emoji: w.mood, n: 0, last: 0 };
      md.n++;
      md.last = i;
      moods.set(w.mood, md);
    }
    day.min += m;
    if (w.feel != null) day.maxFeel = Math.max(day.maxFeel ?? 0, w.feel);
    const note = typeof w.note === 'string' ? w.note.trim() : '';
    if (note && !day.note) day.note = note;
    if (w.mood && !day.mood) day.mood = w.mood;
    if (!day.main || m > (day.main.duration || 0)) day.main = w;
    if (w.photoId && !day.photo) day.photo = w;
  });
  totals.types = types.size;
  for (const k of ix.rest) if (k.startsWith(Y)) totals.rest++;

  const start = since ?? y0;
  const span = dayNum(through) - dayNum(start) + 1;
  const perWeek = span >= 14 ? list.length / (span / 7) : null;

  const w0 = list[0];
  const first = {
    date: w0.date, typeId: tkey(ix, w0.type), min: w0.duration || null, time: w0.time,
    bucket: isTimed(w0) ? timeBucket(w0.time) : null, id: w0.id,
  };
  const argmax = (arr, f) => arr.reduce((best, x) => (f(x) > 0 && (!best || f(x) > f(best)) ? x : best), null);
  const bigMonth = argmax(months, (m) => m.min);
  const brightMonth = argmax(months, (m) => m.active);

  let timeOfDay = null;
  if (known >= MIN.timed) {
    const bucket = TIME_BUCKETS.reduce((b, x) => (counts[x] > counts[b] ? x : b), TIME_BUCKETS[0]);
    const share = counts[bucket] / known;
    if (share >= MIN.persona - EPS) timeOfDay = { bucket, share, known, counts, hours };
  }

  // Weeks whose 4th day is in Y (up to this week), in one pass.
  const wStart = weekStartNum(dayNum(`${Y}-01-04`), ix.ws);
  const wLast = Math.min(weekStartNum(dayNum(`${Y}-12-28`), ix.ws), dayNum(ix.curWk));
  const weeks = [];
  for (let c = wStart; c <= wLast; c += 7) weeks.push({ key: keyOf(c), min: 0, n: 0, active: 0 });
  if (weeks.length) {
    let last = null;
    for (const w of inRange(ix, keyOf(wStart), keyOf(wLast + 7))) {
      const wk = weeks[Math.floor((dayNum(w.date) - wStart) / 7)];
      wk.n++;
      wk.min += w.duration || 0;
      if (w.date !== last) { wk.active++; last = w.date; }
    }
  }
  const withMin = weeks.filter((x) => x.min > 0).length;
  const bw = withMin >= 3 ? argmax(weeks, (x) => x.min) : null;
  const bigWeek = bw && { ...bw, allTime: bw.key === records.bestWeek?.holder };

  const streaks = { weekly: weeklyInYear(d?.weekly || ix.weekly, Y), daily: dailyInYear(ix, Y) };

  const bests = {
    longest: longest
      ? { value: longest.duration, date: longest.date, typeId: tkey(ix, longest.type), id: longest.id, allTime: longest.id === records.longestWorkout?.holder }
      : { value: 0, date: null, typeId: null, id: null, allTime: false },
    month: bigMonth && { key: bigMonth.key, min: bigMonth.min, allTime: bigMonth.key === records.bestMonth?.holder },
  };

  // Ledger: PRs, goal wins, badges and unlocks dated (by `on`) in Y.
  const wins = state?.awards?.wins || ix.wins || {};
  const inY = (on) => typeof on === 'string' && DAY_RE.test(on) && on.startsWith(Y);
  const prWins = Object.entries(wins).filter(([k, w]) => k.startsWith('pr:') && inY(w?.on))
    .sort((a, b) => cmp(a[1].on, b[1].on) || cmp(a[0], b[0]));
  const byKind = new Map();
  for (const [k, w] of prWins) {
    const record = w.record || k.split(':')[1];
    const value = Number(w.value) || 0;
    const cur = byKind.get(record);
    if (!cur || value > cur.value) byKind.set(record, { record, value, prev: Number(w.prev) || 0, on: w.on, key: k });
  }
  const prs = RECORD_KINDS.filter((k) => byKind.has(k)).map((k) => byKind.get(k)).slice(0, 3);

  const wc = winCounts(wins);
  const long = Object.entries(wins).filter(([k, w]) => /^goal:[^:]+:L$/.test(k) && inY(w?.on))
    .sort((a, b) => cmp(a[1].on, b[1].on)).map(([, w]) => String(w.label || ''));
  const goals = { weekly: wc.dates.short.filter(inY).length, monthly: wc.dates.medium.filter(inY).length, long };
  goals.total = goals.weekly + goals.monthly + long.length;

  const badges = Object.entries(state?.awards?.badges || {})
    .filter(([id, b]) => BADGE_BY_ID.has(id) && inY(b?.on))
    .map(([id, b]) => ({ id, on: b.on, rarity: BADGE_BY_ID.get(id).rarity }))
    .sort((a, b) => (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) || cmp(a.on, b.on) || cmp(a.id, b.id));
  const unlocks = [...unlockOn(wins)].filter(([, on]) => inY(on)).map(([id, on]) => ({ id, on }))
    .sort((a, b) => cmp(a.on, b.on) || cmp(a.id, b.id));

  const rated = dist.reduce((s, x) => s + x, 0);
  let feel = null;
  if (rated) {
    let top = null;
    for (const md of moods.values()) if (!top || md.n > top.n || (md.n === top.n && md.last > top.last)) top = md;
    const fb = feelByType(ix, y0, yEnd);
    feel = {
      avg: feelSum / rated, n: rated, amazing: dist[4], dist,
      topMood: top && top.n >= MIN.recapMood ? { emoji: top.emoji, n: top.n } : null,
      bestType: fb.best, bestAvg: fb.best ? fb.rows[0].avg : null,
    };
  }

  // The glow-iest day, and every photo ordered by its day's score.
  const dayList = [...days.values()];
  for (const x of dayList) x.score = x.min + 20 * (x.maxFeel ?? 3) + (ix.prDays.has(x.date) ? 60 : 0) + (x.note ? 10 : 0);
  const best = dayList.reduce((b, x) => (!b || x.score > b.score ? x : b), null);
  const bestPhoto = dayList.reduce((b, x) => (x.photo && (!b || x.score > b.score) ? x : b), null);
  let pick = best;
  let reason = 'best';
  if (best.photo) reason = 'photo';
  else if (bestPhoto && bestPhoto.score >= 0.5 * best.score) { pick = bestPhoto; reason = 'photo'; }
  const mw = reason === 'photo' ? pick.photo : pick.main;
  const note = (typeof mw.note === 'string' && mw.note.trim()) || pick.note;
  const moment = {
    date: pick.date, min: mw.duration || null, dayMin: pick.min, typeId: tkey(ix, mw.type),
    feel: mw.feel ?? pick.maxFeel, mood: mw.mood || pick.mood, note: note ? clip80(note) : '',
    photoId: mw.photoId || null, reason,
  };
  const scoreOf = new Map(dayList.map((x) => [x.date, x.score]));
  const photoIds = list.filter((w) => w.photoId)
    .map((w, i) => ({ id: w.photoId, s: scoreOf.get(w.date), date: w.date, i }))
    .sort((a, b) => b.s - a.s || cmp(a.date, b.date) || a.i - b.i).map((x) => x.id);

  const n = list.length;
  const full = n >= MIN.recapFull;
  const weekday = powerDay(ix, y0, yEnd);
  const rule = {
    cover: true, first: true, count: true, minutes: totals.min >= 60, squares: true,
    top: full, rhythm: full && (weekday.show || !!timeOfDay), bigWeek: full && !!bigWeek,
    streak: streaks.weekly.value >= 2 || streaks.daily.value >= 3,
    bests: full && bests.longest.value > 0,
    trophies: badges.length + goals.total + unlocks.length >= 1,
    vibe: !!feel && feel.n >= MIN.recapFeel, moment: full && !!moment, finale: true,
  };

  return {
    year: Y, current, soFar: current && today < `${Y}-12-01`, today, since, through,
    daysLeft: current ? dayNum(y1) - dayNum(today) : 0,
    totals, perWeek, first, months, bigMonth, brightMonth,
    quilt: yearMonths(ix, Y), strip: yearStrip(ix, Y),
    topTypes: typeMix(ix, y0, yEnd, 'count').rows.slice(0, 5),
    weekday, timeOfDay, weeks, bigWeek, streaks, bests, prs, prCount: prWins.length,
    goals, badges, unlocks, feel, moment, photoIds,
    slides: SLIDES.filter((id) => rule[id]),
  };
}

/** Replay weeks whose 4th day is in Y: met +1, frozen keeps the run, missed resets, open is skipped. */
function weeklyInYear(weekly, Y) {
  let run = 0;
  let runStart = null;
  let runFrozen = 0;
  const best = { value: 0, from: null, to: null, frozen: 0 };
  for (const x of weekly?.weeks || []) {
    if (weekYear(x.key) !== Y || x.state === 'open') continue;
    if (x.state === 'met') {
      if (run === 0) { runStart = x.key; runFrozen = 0; }
      run++;
      if (run > best.value) Object.assign(best, { value: run, from: runStart, to: x.key, frozen: runFrozen });
    } else if (x.state === 'frozen') {
      if (run > 0) runFrozen++;
    } else {
      run = 0;
      runStart = null;
      runFrozen = 0;
    }
  }
  return best;
}

/** Longest daily run over Y's dates only; rest days bridge but don't count (like dailyStreak). */
function dailyInYear(ix, Y) {
  const keys = [];
  for (const k of ix.days.keys()) if (k.startsWith(Y)) keys.push(k);
  for (const k of ix.rest) if (k.startsWith(Y)) keys.push(k);
  keys.sort();
  const best = { value: 0, from: null, to: null };
  let run = 0;
  let runStart = null;
  let prev = null;
  for (const k of keys) {
    const n = dayNum(k);
    if (prev === null || n !== prev + 1) { run = 0; runStart = null; }
    if (ix.days.has(k)) {
      run++;
      if (!runStart) runStart = k;
      if (run > best.value) Object.assign(best, { value: run, from: runStart, to: k });
    }
    prev = n;
  }
  return best;
}
