// Stage 2 engine: goals, weekly + daily streaks, freezes, rest days and personal
// records, all computed from stored inputs (workouts, goals, rest marks, target
// history). Nothing here is stored, so edits, deletes, Undo and backup restores
// can never leave a counter out of sync.
//
// Pure: imports only dates.js, never touches the DOM or reads the clock. Callers
// pass `today`, which keeps it testable (tests/progress.test.js) and makes a
// before/after comparison across midnight safe.

import { dateKey, parseKey, addDaysKey, startOfWeek, daysBetween } from './dates.js';

export const FREEZE_EVERY = 4;    // one freeze per 4 met weeks in a row
export const MAX_FREEZES = 2;     // bank cap
export const DIST_TOL = 0.005;    // 3.1 mi (4.989 km) counts as a 5K
export const NEW_PR_DAYS = 7;     // a record set in the last 7 days shows as "new"
export const REST_BACK_DAYS = 7;  // rest days can be marked up to a week back

export const RECORD_KINDS = ['longestWorkout', 'bestWeek', 'bestMonth', 'dailyStreak', 'weeklyStreak'];
export const METRICS = ['workouts', 'minutes', 'days', 'distance', 'longestDistance'];

// A PR is only flagged once there's some history, so her first weeks aren't a flood of "new record!".
const PR_MIN_PRIOR = { longestWorkout: 3, bestWeek: 2, bestMonth: 2 };
const PR_MIN_VALUE = { dailyStreak: 3, weeklyStreak: 2 };
const TIER_RANK = { medium: 0, long: 1, short: 2 };
const CUMULATIVE = new Set(['workouts', 'minutes', 'days', 'distance']);
export const isDistanceMetric = (m) => m === 'distance' || m === 'longestDistance';

// ---- Calendar helpers ----

export const weekKeyOf = (day, ws) => dateKey(startOfWeek(parseKey(day), ws));
export const monthKeyOf = (day) => day.slice(0, 7);

export function nextMonthStart(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return dateKey(new Date(y, m, 1));
}

/** The Monday of the calendar week containing week key `wk` (Sunday- or Monday-start). */
export const canonWeek = (wk) => weekKeyOf(addDaysKey(wk, 3), 1);

/** A day in the period before the goal's current one (null for long goals). */
export function prevPeriodDay(g, today, ws) {
  if (g.tier === 'short') return addDaysKey(weekKeyOf(today, ws), -1);
  if (g.tier === 'medium') return addDaysKey(`${monthKeyOf(today)}-01`, -1);
  return null;
}

/** Total order for workouts: date, time, then creation and id as tie-breakers. */
export const chrono = (a, b) =>
  (a.date + a.time).localeCompare(b.date + b.time)
  || String(a.createdAt).localeCompare(String(b.createdAt))
  || String(a.id).localeCompare(String(b.id));

/** The target-history entry in effect on `day` (history is sorted by `from`). */
export function valueAt(history, day) {
  let v = history[0];
  for (const h of history) {
    if (h.from <= day) v = h;
    else break;
  }
  return v;
}

/** Ring targets for a week: past weeks use what was in effect on their last day. */
export function targetsFor(settings, wk, curWk) {
  return wk >= curWk ? settings.targets : valueAt(settings.targetHistory, addDaysKey(wk, 6));
}

/** Shared inputs for one derive() pass. Future-dated workouts are ignored everywhere. */
export function buildCtx(state, today) {
  const { settings } = state;
  const ws = settings.weekStart;
  const cache = new Map();
  const weekOf = (day) => {
    let k = cache.get(day);
    if (!k) { k = weekKeyOf(day, ws); cache.set(day, k); }
    return k;
  };
  const workouts = state.workouts.filter((w) => w.date <= today).sort(chrono);
  const activeDays = new Set(workouts.map((w) => w.date));
  const restMarks = new Set(state.restDays || []);
  // A rest mark only counts on a day with no workout (the workout wins; the mark comes back if it's deleted).
  const rest = new Set([...restMarks].filter((d) => d <= today && !activeDays.has(d)));
  return { today, ws, weekOf, settings, workouts, activeDays, restMarks, rest, goals: state.goals || [] };
}

// ---- Weekly streak with freezes ----

/**
 * Replays every week from her first workout to now:
 *  - met:    workouts ≥ that week's target. Grows the run; every 4th met week earns a freeze (bank max 2).
 *  - open:   the current week before it's met. Never breaks the run or spends a freeze.
 *  - frozen: a finished, missed week while a run is alive and a freeze is banked. Keeps the run, adds nothing.
 *  - missed: otherwise. Ends the run.
 */
export function weeklyStreak(ctx) {
  const { today, settings, workouts, weekOf } = ctx;
  const cur = weekOf(today);
  const dates = new Map(); // week → workout dates in order (so we know when the target was hit)
  for (const w of workouts) {
    const k = weekOf(w.date);
    if (!dates.has(k)) dates.set(k, []);
    dates.get(k).push(w.date);
  }

  let run = 0, runStart = null, bank = 0, earned = 0, used = 0;
  let best = 0, bestStart = null, bestEnd = null, prevBest = 0, lastEarnedWeek = null;
  const bestReached = []; // bestReached[n-1] = the week her longest-ever run first reached n
  const weeks = [];
  const first = workouts.length ? weekOf(workouts[0].date) : cur;

  for (let wk = first; wk <= cur; wk = addDaysKey(wk, 7)) {
    const target = targetsFor(settings, wk, cur).workouts;
    const count = dates.get(wk)?.length || 0;
    let state;
    let earnedHere = false;
    let endedRun = 0;
    if (count >= target) {
      if (run === 0) runStart = wk;
      run++;
      state = 'met';
      if (run % FREEZE_EVERY === 0 && bank < MAX_FREEZES) {
        bank++; earned++; earnedHere = true; lastEarnedWeek = wk;
      }
    } else if (wk === cur) {
      state = 'open';
    } else if (run > 0 && bank > 0) {
      bank--; used++; state = 'frozen';
    } else {
      endedRun = run; run = 0; runStart = null; state = 'missed'; // bank is always 0 here
    }
    if (run > best) {
      if (runStart !== bestStart) prevBest = best;
      best = run; bestStart = runStart; bestEnd = wk;
      bestReached.push(wk);
    }
    const metOn = state === 'met' ? dates.get(wk)[target - 1] : null; // the day the target-th workout landed
    weeks.push({ key: wk, count, target, state, run, bank, earnedHere, endedRun, metOn });
  }

  const tw = weeks[weeks.length - 1];
  return {
    current: run, runStart, freezes: bank, earned, used, best, bestStart, bestEnd, prevBest, lastEarnedWeek, bestReached,
    toNextFreeze: bank >= MAX_FREEZES ? null : FREEZE_EVERY - (run % FREEZE_EVERY),
    weeks,
    byKey: new Map(weeks.map((x) => [x.key, x])),
    thisWeek: {
      key: cur, count: tw.count, target: tw.target, met: tw.state === 'met',
      toGo: Math.max(0, tw.target - tw.count), earnedHere: tw.earnedHere,
    },
    lastWeek: weeks.length > 1 ? weeks[weeks.length - 2] : null,
  };
}

// ---- Daily streak with rest days ----

/** Walk back from `key` over days with a workout or rest mark. Rest days bridge but don't count. */
function chainAt({ activeDays, rest }, key) {
  let count = 0, restUsed = 0, pending = 0, start = null;
  while (activeDays.has(key) || rest.has(key)) {
    if (activeDays.has(key)) {
      count++; start = key; restUsed += pending; pending = 0;
    } else {
      pending++; // only counted once an older active day is found (leading rests don't count)
    }
    key = addDaysKey(key, -1);
  }
  return { count, restUsed, start };
}

/**
 * Can `day` be marked (or unmarked) as a rest day?
 * Allowed for today and up to 7 days back, never on a day with a workout, and at
 * most max(1, 7 − active-days target) per week. Removing a mark is always allowed.
 */
export function restCheck(ctx, day) {
  const { today, weekOf, activeDays, restMarks, settings } = ctx;
  const cap = Math.max(1, 7 - settings.targets.days);
  const wk = weekOf(day);
  const used = [...restMarks].filter((r) => r !== day && weekOf(r) === wk && !activeDays.has(r)).length;
  if (day > today) return { ok: false, reason: 'future', used, cap };
  if (activeDays.has(day)) return { ok: false, reason: 'has-workout', used, cap };
  if (restMarks.has(day)) return { ok: true, action: 'remove', used, cap };
  if (day < addDaysKey(today, -REST_BACK_DAYS)) return { ok: false, reason: 'too-old', used, cap };
  if (used >= cap) return { ok: false, reason: 'cap', used, cap };
  return { ok: true, action: 'add', used, cap };
}

export function dailyStreak(ctx) {
  const { today, activeDays, rest } = ctx;
  const on = (d) => activeDays.has(d) || rest.has(d);
  const yesterday = addDaysKey(today, -1);
  const cur = chainAt(ctx, on(today) ? today : yesterday); // an empty today is still pending

  let best = 0, bestStart = null, bestEnd = null, prevBest = 0, run = 0, runStart = null, prev = null;
  const bestReached = []; // bestReached[n-1] = the day her longest-ever run first reached n days
  for (const d of [...new Set([...activeDays, ...rest])].sort()) {
    if (!(prev && addDaysKey(prev, 1) === d)) { run = 0; runStart = null; }
    if (activeDays.has(d)) {
      run++;
      if (!runStart) runStart = d;
      if (run > best) {
        if (runStart !== bestStart) prevBest = best;
        best = run; bestStart = runStart; bestEnd = d;
        bestReached.push(d);
      }
    }
    prev = d;
  }

  // "Your 4-day streak paused yesterday. Rest day?"
  const before = chainAt(ctx, addDaysKey(today, -2));
  const repairable = !on(yesterday) && before.count >= 2 && restCheck(ctx, yesterday).ok;
  return {
    count: cur.count, restUsed: cur.restUsed, start: cur.start,
    includesToday: activeDays.has(today), restToday: rest.has(today),
    best, bestStart, bestEnd, prevBest, bestReached, repairable, repairCount: repairable ? before.count : 0,
  };
}

// ---- Personal records ----

/** Max over items in ascending order; strict ">" so the earliest holder keeps a tie. */
function maxBuckets(items) {
  let r = { value: 0, holder: null, date: null, prev: 0, prior: 0 };
  let seen = 0;
  for (const it of items) {
    if (it.value <= 0) continue;
    if (it.value > r.value) r = { value: it.value, holder: it.holder, date: it.date, prev: r.value, prior: seen };
    seen++;
  }
  return r;
}

export function computeRecords(ctx, weekly, daily) {
  const { workouts, weekOf, today } = ctx;
  const wk = new Map();
  const mo = new Map();
  for (const w of workouts) {
    const m = w.duration || 0;
    if (!m) continue;
    const a = wk.get(weekOf(w.date)) || { value: 0, date: w.date };
    a.value += m; a.date = w.date;
    wk.set(weekOf(w.date), a);
    const b = mo.get(monthKeyOf(w.date)) || { value: 0, date: w.date };
    b.value += m; b.date = w.date;
    mo.set(monthKeyOf(w.date), b);
  }
  const rec = {
    longestWorkout: maxBuckets(workouts.map((w) => ({ holder: w.id, value: w.duration || 0, date: w.date }))),
    bestWeek: maxBuckets([...wk.keys()].sort().map((k) => ({ holder: k, ...wk.get(k) }))),
    bestMonth: maxBuckets([...mo.keys()].sort().map((k) => ({ holder: k, ...mo.get(k) }))),
    dailyStreak: { value: daily.best, holder: daily.bestStart, date: daily.bestEnd, prev: daily.prevBest },
    weeklyStreak: { value: weekly.best, holder: weekly.bestStart, date: weekly.bestEnd, prev: weekly.prevBest },
  };
  for (const k of RECORD_KINDS) {
    const r = rec[k];
    r.eligible = r.value > 0 && r.prev > 0
      && (k in PR_MIN_PRIOR ? r.prior >= PR_MIN_PRIOR[k] : r.value >= PR_MIN_VALUE[k]);
    r.isNew = k in PR_MIN_PRIOR && r.eligible && daysBetween(r.date, today) < NEW_PR_DAYS;
  }
  rec.dailyStreak.current = daily.best > 0 && daily.count === daily.best && daily.start === daily.bestStart;
  rec.weeklyStreak.current = weekly.best > 0 && weekly.current === weekly.best && weekly.runStart === weekly.bestStart;
  return rec;
}

// ---- Goals ----

/** The window a goal counts in: [from, to). Short = this week, medium = this month, long = custom. */
export function goalWindow(g, today, ws) {
  if (g.tier === 'short') {
    const s = weekKeyOf(today, ws);
    return { from: s, to: addDaysKey(s, 7), periodKey: `W:${s}` };
  }
  if (g.tier === 'medium') {
    const m = monthKeyOf(today);
    return { from: `${m}-01`, to: nextMonthStart(m), periodKey: `M:${m}` };
  }
  return { from: g.start, to: g.end ? addDaysKey(g.end, 1) : null, periodKey: 'L' };
}

export function goalProgress(g, { today, ws, workouts }) {
  const { from, to, periodKey } = goalWindow(g, today, ws);
  const last = to ? addDaysKey(to, -1) : null;
  let target = g.target;
  if (g.metric === 'days' && last) target = Math.min(target, daysBetween(from, last) + 1); // e.g. February
  const need = isDistanceMetric(g.metric) ? target * (1 - DIST_TOL) : target;

  let acc = 0;
  let achievedOn = null;
  let achievedBy = null; // id of the workout that crossed the target
  const days = new Set();
  for (const w of workouts) { // chronological, date <= today
    if (w.date < from || (to && w.date >= to) || (g.typeId && w.type !== g.typeId)) continue;
    switch (g.metric) {
      case 'workouts': acc++; break;
      case 'minutes': acc += w.duration || 0; break;
      case 'days': days.add(w.date); acc = days.size; break;
      case 'distance': acc += w.distanceKm || 0; break;
      case 'longestDistance': acc = Math.max(acc, w.distanceKm || 0); break;
      default: break;
    }
    if (!achievedOn && acc >= need) { achievedOn = w.date; achievedBy = w.id; }
  }

  const met = achievedOn !== null;
  const status = g.tier === 'long' && from > today ? 'upcoming'
    : met ? 'met'
      : g.tier === 'long' && g.end && g.end < today ? 'ended'
        : 'active';
  const daysLeft = last && last >= today && from <= today ? daysBetween(today, last) + 1 : null; // 1 = last day

  // Pace for monthly goals and dated long goals: where she'd be if spread evenly (today still pending).
  let pace = null;
  if (status === 'active' && CUMULATIVE.has(g.metric) && last && g.tier !== 'short') {
    const expected = (target * daysBetween(from, today)) / (daysBetween(from, last) + 1);
    pace = {
      expected,
      onPace: acc >= expected,
      behindBy: Math.max(0, expected - acc),
      perWeek: (target - acc) / Math.max(1, daysLeft / 7),
    };
  }
  return {
    goal: g, id: g.id, tier: g.tier, metric: g.metric, periodKey, from, to, last,
    value: acc, target, pct: Math.min(1, target > 0 ? acc / target : 0), met, achievedOn, achievedBy, status, daysLeft, pace,
  };
}

/** The goal for the Home tile: the pinned one, else unmet first, monthly before long before weekly. */
export function featuredGoal(list, pinnedId, today) {
  const pinned = list.find((p) => p.id === pinnedId);
  if (pinned) return pinned;
  const candidates = list.filter((p) => p.status === 'active'
    || (p.status === 'met' && (p.tier !== 'long' || daysBetween(p.achievedOn, today) < NEW_PR_DAYS)));
  candidates.sort((a, b) => (a.met - b.met)
    || (TIER_RANK[a.tier] - TIER_RANK[b.tier])
    || String(a.goal.createdAt).localeCompare(String(b.goal.createdAt)));
  return candidates[0] || null;
}

// ---- Entry point ----

export function derive(state, today) {
  const ctx = buildCtx(state, today);
  const wk = ctx.weekOf(today);
  let count = 0, minutes = 0;
  const days = new Set();
  for (const w of ctx.workouts) {
    if (w.date >= wk) { count++; minutes += w.duration || 0; days.add(w.date); }
  }
  const t = state.settings.targets;
  const closed = { workouts: count >= t.workouts, minutes: minutes >= t.minutes, days: days.size >= t.days };
  const week = {
    key: wk, count, minutes, activeDays: days.size, targets: t, closed,
    allClosed: closed.workouts && closed.minutes && closed.days,
  };
  const weekly = weeklyStreak(ctx);
  const daily = dailyStreak(ctx);
  const records = computeRecords(ctx, weekly, daily);
  const goals = ctx.goals.filter((g) => !g.archivedAt).map((g) => goalProgress(g, ctx));
  // Last week's / last month's result for repeating goals, so a backdated log can finish them ("catch-up").
  const prevGoals = ctx.goals.filter((g) => !g.archivedAt && g.tier !== 'long')
    .map((g) => goalProgress(g, { ...ctx, today: prevPeriodDay(g, today, ctx.ws) }));
  const featured = featuredGoal(goals, state.settings.featuredGoalId, today);
  let freshRecord = null;
  for (const k of ['longestWorkout', 'bestWeek', 'bestMonth']) {
    if (records[k].isNew && (!freshRecord || records[k].date > records[freshRecord].date)) freshRecord = k;
  }
  return { today, weekKey: wk, week, weekly, daily, records, goals, prevGoals, featured, freshRecord };
}

// ---- Events ("new PR on save", goal met, freeze earned, …) ----

const PRIORITY = { 'goal:long': 100, 'goal:medium': 80, pr: 70, freeze: 60, 'goal:short': 50, allRings: 45, weekMet: 40, weekFilled: 30, ring: 20 };
const SIZE = { short: 'small', medium: 'medium', long: 'big' };

/**
 * What a save earned, by comparing derive() before and after. Both MUST use the same `today`.
 * Events: { kind, key, size: 'small'|'medium'|'big', priority, ...data }, highest priority first.
 * `key` is stable so Stage 3 can keep a ledger of awards.
 */
export function milestones(b, a) {
  const ev = [];
  for (const k of RECORD_KINDS) {
    const rb = b.records[k];
    const ra = a.records[k];
    if (rb.value > 0 && ra.value > rb.value && ra.holder !== rb.holder && ra.eligible) {
      ev.push({ kind: 'pr', record: k, value: ra.value, prev: rb.value, key: `pr:${k}:${ra.holder}`, size: 'medium', priority: PRIORITY.pr });
    }
  }
  const was = new Map(b.goals.map((p) => [p.id, p]));
  for (const p of a.goals) {
    const q = was.get(p.id);
    if (p.met && q && !q.met && q.periodKey === p.periodKey) {
      ev.push({ kind: 'goal', tier: p.tier, goalId: p.id, goal: p.goal, key: `goal:${p.id}:${p.periodKey}`, size: SIZE[p.tier], priority: PRIORITY[`goal:${p.tier}`] });
    }
  }
  // Only when a freeze is actually banked (a backfill can earn one that a later past miss spends at once).
  // Catch-ups: a backdated log that finishes last week's or last month's goal.
  const wasPrev = new Map((b.prevGoals || []).map((p) => [p.id, p]));
  for (const p of a.prevGoals || []) {
    const q = wasPrev.get(p.id);
    if (p.met && q && !q.met && q.periodKey === p.periodKey) {
      ev.push({ kind: 'goal', tier: p.tier, goalId: p.id, goal: p.goal, key: `goal:${p.id}:${p.periodKey}`, size: SIZE[p.tier], priority: PRIORITY[`goal:${p.tier}`], catchUp: true });
    }
  }
  if (a.weekly.earned > b.weekly.earned && a.weekly.freezes > b.weekly.freezes) {
    ev.push({ kind: 'freeze', freezes: a.weekly.freezes, key: `freeze:${a.weekly.lastEarnedWeek}`, size: 'medium', priority: PRIORITY.freeze });
  }
  if (a.weekly.thisWeek.met && !b.weekly.thisWeek.met) {
    ev.push({ kind: 'weekMet', streak: a.weekly.current, key: `week:${a.weekKey}`, size: 'small', priority: PRIORITY.weekMet });
  } else if (a.weekly.current > b.weekly.current) {
    ev.push({ kind: 'weekFilled', streak: a.weekly.current, key: `fill:${a.weekKey}:${a.weekly.current}`, size: 'small', priority: PRIORITY.weekFilled });
  }
  if (a.week.allClosed && !b.week.allClosed) {
    ev.push({ kind: 'allRings', key: `rings:${a.weekKey}`, size: 'small', priority: PRIORITY.allRings });
  } else {
    for (const r of ['minutes', 'days']) {
      if (a.week.closed[r] && !b.week.closed[r]) {
        ev.push({ kind: 'ring', ring: r, key: `ring:${r}:${a.weekKey}`, size: 'small', priority: PRIORITY.ring });
      }
    }
  }
  return ev.sort((x, y) => y.priority - x.priority);
}
