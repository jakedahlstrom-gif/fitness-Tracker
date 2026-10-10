// Stage 3 rewards engine (pure, no DOM; tested in tests/rewards.test.js).
//
// Rewards are sticky: once a win, badge or unlock is earned it stays, with the date
// it happened in her data (`on`). collect() works out what is true now and not yet in
// the ledger; it only ever adds, so it can run any number of times.
//
// modes: 'live' (a log-sheet save; celebrated), 'quiet' (app start / visible / after
// edits; a gentle toast), 'backfill' (first Stage 3 launch or a restore; the intro).

import {
  buildCtx, goalProgress, weekKeyOf, monthKeyOf, canonWeek, targetsFor, prevPeriodDay,
  nextMonthStart, DIST_TOL, RECORD_KINDS,
} from './progress.js';
import { BADGES, RARITIES, BADGE_BY_ID } from './badges.js';
import { LADDERS, PALETTES, SKINS, unlockInfo } from './looks.js';
import { addDaysKey, daysBetween, parseKey, dateKey } from './dates.js';
import { kmToUnit } from './util.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const minKey = (a, b) => (a < b ? a : b);

// ---------------------------------------------------------------------------
// Win counts per tier (what the unlock ladders and goal badges count)
// ---------------------------------------------------------------------------

/** Parse "goal:<id>:<periodKey>" → { id, pk } (ids never contain ':'). */
function parseGoalKey(k) {
  const rest = k.slice(5);
  const i = rest.indexOf(':');
  return i < 0 ? null : { id: rest.slice(0, i), pk: rest.slice(i + 1) };
}

/**
 * Weekly wins = distinct calendar weeks (canonical Mondays) with a met weekly target or
 * a weekly goal; monthly = distinct months with a monthly goal; long = distinct long goals.
 */
export function winCounts(wins = {}) {
  const short = new Map();
  const medium = new Map();
  const long = new Map();
  const put = (m, k, on) => { if (!m.has(k) || on < m.get(k)) m.set(k, on); };
  for (const [key, w] of Object.entries(wins)) {
    if (!w || !DAY_RE.test(w.on)) continue;
    if (key.startsWith('week:')) {
      const wk = key.slice(5);
      if (DAY_RE.test(wk)) put(short, canonWeek(wk), w.on);
    } else if (key.startsWith('goal:')) {
      const g = parseGoalKey(key);
      if (!g) continue;
      if (g.pk.startsWith('W:') && DAY_RE.test(g.pk.slice(2))) put(short, canonWeek(g.pk.slice(2)), w.on);
      else if (g.pk.startsWith('M:')) put(medium, g.pk.slice(2), w.on);
      else if (g.pk === 'L') put(long, g.id, w.on);
    }
  }
  const sorted = (m) => [...m.values()].sort();
  return {
    short: short.size, medium: medium.size, long: long.size,
    dates: { short: sorted(short), medium: sorted(medium), long: sorted(long) },
    months: medium, // month → first win date (for Three-Peat)
  };
}

/** Every unlocked look id ("palette:sunset", "skin:heartbeat", …), defaults included. */
export function unlockedSet(wins, counts = winCounts(wins)) {
  const set = new Set(['palette:glow', 'skin:classic']);
  for (const [tier, ladder] of Object.entries(LADDERS)) {
    for (const r of ladder.rungs) if (counts[tier] >= r.at) r.items.forEach((i) => set.add(i));
  }
  return set;
}

/** When each unlock happened (the date of the threshold-th win). */
export function unlockOn(wins, counts = winCounts(wins)) {
  const out = new Map();
  for (const [tier, ladder] of Object.entries(LADDERS)) {
    for (const r of ladder.rungs) {
      const on = counts.dates[tier][r.at - 1];
      if (on) r.items.forEach((i) => out.set(i, on));
    }
  }
  return out;
}

/** The look to show: her choice if it's known and unlocked, else the default. Never rewrites settings. */
export function resolveLook(settings, unlocked) {
  const palette = PALETTES[settings.palette] && unlocked.has(`palette:${settings.palette}`) ? settings.palette : 'glow';
  const skin = SKINS[settings.skin] && unlocked.has(`skin:${settings.skin}`) ? settings.skin : 'classic';
  return { palette, skin };
}

// ---------------------------------------------------------------------------
// Facts: one pass over her data that every badge is measured against
// ---------------------------------------------------------------------------

/** Weeks where all three rings closed, dated by the workout that closed the last one. */
function ringWeeks(ctx, curWk) {
  const per = new Map();
  for (const w of ctx.workouts) {
    const wk = ctx.weekOf(w.date);
    let s = per.get(wk);
    if (!s) per.set(wk, (s = { count: 0, minutes: 0, days: new Set(), on: null }));
    if (s.on) continue;
    s.count++;
    s.minutes += w.duration || 0;
    s.days.add(w.date);
    const t = targetsFor(ctx.settings, wk, curWk);
    if (s.count >= t.workouts && s.minutes >= t.minutes && s.days.size >= t.days) s.on = w.date;
  }
  return [...per.values()].map((s) => s.on).filter(Boolean).sort();
}

export function facts(state, d, wins, today) {
  const ctx = buildCtx(state, today);
  const F = {
    nth: [], minutesCum: [], kmCum: [], durMax: [], kmMax: [], typeFirst: new Map(),
    mix3: [], feel5: [], photo: [], hard: [], early: [], owl: [],
  };
  let mins = 0;
  let km = 0;
  const weekTypes = new Map();
  for (const w of ctx.workouts) {
    F.nth.push(w.date);
    if (w.duration) {
      mins += w.duration;
      F.minutesCum.push({ date: w.date, total: mins });
      F.durMax.push({ date: w.date, value: w.duration });
    }
    if (w.distanceKm) {
      km += w.distanceKm;
      F.kmCum.push({ date: w.date, total: km });
      F.kmMax.push({ date: w.date, value: w.distanceKm });
    }
    if (!F.typeFirst.has(w.type)) F.typeFirst.set(w.type, w.date);
    const wk = ctx.weekOf(w.date);
    let types = weekTypes.get(wk);
    if (!types) weekTypes.set(wk, (types = new Set()));
    if (!types.has(w.type)) {
      types.add(w.type);
      if (types.size === 3) F.mix3.push(w.date);
    }
    if (w.feel === 5) F.feel5.push(w.date);
    if (w.photoId) F.photo.push(w.date);
    if (w.intensity === 'hard') F.hard.push(w.date);
    const t = w.time || '12:00';
    if (t >= '04:00' && t < '07:00') F.early.push(w.date);
    else if (t >= '21:00' || t < '04:00') F.owl.push(w.date);
  }
  F.mix3.sort();

  const days = [...ctx.activeDays].sort();
  F.weekend = days.filter((k) => parseKey(k).getDay() === 0 && ctx.activeDays.has(addDaysKey(k, -1)));
  F.comeback = [];
  for (let i = 1; i < days.length; i++) if (daysBetween(days[i - 1], days[i]) >= 14) F.comeback.push(days[i]);
  F.jan1 = days.filter((k) => k.endsWith('-01-01'));
  F.feb14 = days.filter((k) => k.endsWith('-02-14'));

  F.ringWeeks = ringWeeks(ctx, d.weekKey);
  F.weekRun = d.weekly.bestReached.map((wk) => d.weekly.byKey.get(wk)?.metOn).filter(Boolean);
  F.dayRun = d.daily.bestReached.slice();
  F.freezeEarned = d.weekly.weeks.filter((x) => x.earnedHere && x.metOn).map((x) => x.metOn).sort();
  F.freezeUsed = d.weekly.weeks.filter((x) => x.state === 'frozen').map((x) => addDaysKey(x.key, 6)).sort();
  F.rest = [...ctx.rest].sort();
  F.weekCur = d.weekly.current;
  F.dayCur = d.daily.count;

  const entries = Object.entries(wins || {}).filter(([, w]) => w && DAY_RE.test(w.on));
  F.prs = entries.filter(([k]) => k.startsWith('pr:')).map(([, w]) => w.on).sort();
  F.goalWins = entries.filter(([k]) => k.startsWith('goal:')).map(([, w]) => w.on).sort();
  const wc = winCounts(wins);
  F.weeklyWins = wc.dates.short;
  F.monthlyWins = wc.dates.medium;
  F.longWins = wc.dates.long;
  F.winMonths = wc.months;

  F.types = state.settings.types.filter((t) => !t.archived && t.id !== 'other');
  F.hasDistance = state.settings.types.some((t) => t.distance) || ctx.workouts.some((w) => w.distanceKm);
  return F;
}

// ---------------------------------------------------------------------------
// Evaluate every badge: value, target and the date it was (or would be) earned
// ---------------------------------------------------------------------------

const nextMonthKey = (m) => nextMonthStart(m).slice(0, 7);

export function evaluate(F) {
  const out = new Map();
  for (const def of BADGES) {
    const m = def.measure;
    let target = m.target;
    let value = 0;
    let on = null;
    const extra = {};
    switch (m.kind) {
      case 'count': {
        const arr = F[m.key] || [];
        value = Math.min(arr.length, target);
        on = arr[target - 1] ?? null;
        break;
      }
      case 'run': {
        on = (F[m.key] || [])[target - 1] ?? null;
        value = on ? target : Math.min(F[m.current] || 0, target); // locked: show the current streak
        break;
      }
      case 'cum': {
        const need = m.tol ? target * (1 - DIST_TOL) : target;
        const arr = F[m.key] || [];
        on = arr.find((x) => x.total >= need)?.date ?? null;
        value = on ? target : Math.min(arr.length ? arr[arr.length - 1].total : 0, target);
        break;
      }
      case 'max': {
        const need = m.tol ? target * (1 - DIST_TOL) : target;
        const arr = F[m.key] || [];
        on = arr.find((x) => x.value >= need)?.date ?? null;
        value = on ? target : Math.min(arr.reduce((mx, x) => Math.max(mx, x.value), 0), target);
        break;
      }
      case 'allTypes': {
        const eligible = F.types;
        target = eligible.length;
        const missing = eligible.filter((t) => !F.typeFirst.has(t.id));
        value = eligible.length - missing.length;
        extra.missing = missing.map((t) => t.label);
        extra.tooFew = eligible.length < 4;
        if (!extra.tooFew && !missing.length) on = eligible.map((t) => F.typeFirst.get(t.id)).sort().pop();
        break;
      }
      case 'gm3': {
        // 3 calendar months in a row, each with a monthly goal win
        const months = [...F.winMonths.keys()].sort();
        let best = 0;
        let run = 0;
        for (let i = 0; i < months.length; i++) {
          run = i && nextMonthKey(months[i - 1]) === months[i] ? run + 1 : 1;
          best = Math.max(best, run);
          if (!on && run >= 3) on = F.winMonths.get(months[i]);
        }
        value = Math.min(best, target);
        break;
      }
      case 'crown': {
        const firsts = [F.weeklyWins[0], F.monthlyWins[0], F.longWins[0]];
        value = firsts.filter(Boolean).length;
        if (value === 3) on = firsts.sort().pop();
        break;
      }
      default: break;
    }
    out.set(def.id, { value, target, on, hidden: def.family === 'distance' && !F.hasDistance, ...extra });
  }
  return out;
}

// ---------------------------------------------------------------------------
// collect(): what's true now and not yet in the ledger
// ---------------------------------------------------------------------------

const QUIET_KINDS = new Set(['ring', 'allRings', 'weekFilled']); // never stored; repeats tracked per session

function goalWin(p, label) {
  return {
    kind: 'goal', on: p.achievedOn, tier: p.tier, goalId: p.id,
    label: String(label(p.goal) || '').slice(0, 80), metric: p.metric, target: p.target, value: p.value,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.today
 * @param {'live'|'quiet'|'backfill'} opts.mode
 * @param {object[]} [opts.events]   milestones() events from a save (live only)
 * @param {string} [opts.now]        ISO time to stamp new entries with
 * @param {(goal) => string} [opts.label]
 * @param {Set<string>} [opts.seenKeys]  ring/week-filled keys already celebrated this session
 * @param {boolean} [opts.seen]      mark new badges as already seen (e.g. after a restore)
 */
export function collect(state, d, awards, opts) {
  const { today, mode, events = [], now = new Date().toISOString(), label = () => '', seenKeys = new Set(), seen = false } = opts;
  const have = awards?.wins || {};
  const wins = {};

  // Indexes so the same calendar week never counts twice (week start can change).
  const weekCanon = new Set();
  const goalWeekCanon = new Set();
  const index = (k) => {
    if (k.startsWith('week:')) weekCanon.add(canonWeek(k.slice(5)));
    else if (k.startsWith('goal:')) {
      const g = parseGoalKey(k);
      if (g?.pk.startsWith('W:')) goalWeekCanon.add(`${g.id}|${canonWeek(g.pk.slice(2))}`);
    }
  };
  Object.keys(have).filter((k) => DAY_RE.test(have[k]?.on)).forEach(index);
  const present = (k) => {
    if (k in have || k in wins) return true;
    if (k.startsWith('week:')) return weekCanon.has(canonWeek(k.slice(5)));
    if (k.startsWith('goal:')) {
      const g = parseGoalKey(k);
      if (g?.pk.startsWith('W:')) return goalWeekCanon.has(`${g.id}|${canonWeek(g.pk.slice(2))}`);
    }
    return false;
  };
  const add = (k, entry) => {
    if (!entry.on || !DAY_RE.test(entry.on)) return;
    wins[k] = { ...entry, at: now, via: mode };
    index(k);
  };

  // 1. Events from a save (live)
  const fresh = [];
  const repeats = [];
  for (const e of events) {
    if (QUIET_KINDS.has(e.kind)) {
      (seenKeys.has(e.key) ? repeats : fresh).push(e);
      continue;
    }
    if (present(e.key)) { repeats.push(e); continue; }
    fresh.push(e);
    if (e.kind === 'goal') {
      const p = (e.catchUp ? d.prevGoals : d.goals).find((x) => x.id === e.goalId);
      if (p) add(e.key, goalWin(p, label));
    } else if (e.kind === 'weekMet') {
      const w = d.weekly.byKey.get(e.key.slice(5));
      add(e.key, { kind: 'week', on: w?.metOn || today, count: w?.count, target: w?.target });
    } else if (e.kind === 'pr') {
      add(e.key, { kind: 'pr', on: d.records[e.record]?.date || today, record: e.record, value: e.value, prev: e.prev });
    } else if (e.kind === 'freeze') {
      add(e.key, { kind: 'freeze', on: d.weekly.byKey.get(e.key.slice(7))?.metOn || today });
    }
  }

  // 2. Met weeks and earned freezes (every mode)
  for (const w of d.weekly.weeks) {
    if (w.state === 'met' && w.metOn && !present(`week:${w.key}`)) {
      add(`week:${w.key}`, { kind: 'week', on: w.metOn, count: w.count, target: w.target });
    }
    if (w.earnedHere && w.metOn && !present(`freeze:${w.key}`)) add(`freeze:${w.key}`, { kind: 'freeze', on: w.metOn });
  }

  // 3. Goals (archived ones included: a win stays a win)
  const ctx = buildCtx(state, today);
  for (const g of state.goals || []) {
    if (mode === 'backfill') backfillGoal(g, ctx, today, present, add, label);
    else {
      const days = [today];
      if (g.tier !== 'long') days.push(prevPeriodDay(g, today, ctx.ws));
      for (const t of days) {
        const p = goalProgress(g, { ...ctx, today: t });
        const k = `goal:${g.id}:${p.periodKey}`;
        if (!p.met || present(k)) continue;
        // Subset rule: it must not already have been met by the workouts that existed
        // when the goal was last edited (so lowering a target can't mint a win).
        const before = goalProgress(g, { ...ctx, today: t, workouts: ctx.workouts.filter((w) => String(w.updatedAt) <= String(g.updatedAt)) });
        if (before.met) continue;
        add(k, goalWin(p, label));
      }
    }
  }

  // 4. Personal records: live events only, plus everything on the first backfill
  if (mode === 'backfill') {
    for (const k of RECORD_KINDS) {
      const r = d.records[k];
      if (r.eligible && r.holder && !present(`pr:${k}:${r.holder}`)) {
        add(`pr:${k}:${r.holder}`, { kind: 'pr', on: r.date, record: k, value: r.value, prev: r.prev });
      }
    }
  }

  // 5. Badges, measured with the merged ledger
  const merged = { ...have, ...wins };
  const F = facts(state, d, merged, today);
  const ev = evaluate(F);
  const haveBadges = awards?.badges || {};
  const badges = {};
  for (const def of BADGES) {
    const e = ev.get(def.id);
    if (e.on && !(def.id in haveBadges)) badges[def.id] = { on: e.on, at: now, via: mode, seen };
  }

  // 6. Looks unlocked by this round's wins
  const before = unlockedSet(have);
  const newUnlocks = [...unlockedSet(merged)].filter((u) => !before.has(u));

  return { wins, badges, newUnlocks, fresh, repeats, facts: F, evals: ev };
}

/** First-launch backfill: every past period since the goal was created. */
function backfillGoal(g, ctx, today, present, add, label) {
  const created = DAY_RE.test(String(g.createdAt).slice(0, 10)) ? dateKey(new Date(g.createdAt)) : today;
  const record = (t) => {
    const p = goalProgress(g, { ...ctx, today: t });
    const k = `goal:${g.id}:${p.periodKey}`;
    if (p.met && p.achievedOn >= created && !present(k)) add(k, goalWin(p, label));
  };
  if (g.tier === 'long') { record(today); return; }
  if (g.tier === 'short') {
    for (let wk = weekKeyOf(created, ctx.ws); wk <= today; wk = addDaysKey(wk, 7)) record(minKey(addDaysKey(wk, 6), today));
    return;
  }
  for (let m = monthKeyOf(created); `${m}-01` <= today; m = nextMonthKey(m)) {
    record(minKey(addDaysKey(nextMonthStart(m), -1), today));
  }
}

// ---------------------------------------------------------------------------
// Celebration plan (what the director plays for one save)
// ---------------------------------------------------------------------------

const LEVEL = { pr: 2, freeze: 2, weekMet: 1, allRings: 1, ring: 1, weekFilled: 1 };
export const levelOf = (e) => (e.kind === 'goal' ? { long: 3, medium: 2, short: 1 }[e.tier] || 1 : LEVEL[e.kind] || 1);
const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]));

/**
 * At most two beats: A (L1 pop, L2 cannons or L3 finale) and B (badge/unlock reveal).
 * Three or more L2 wins in one save become a "jackpot" finale.
 */
export function buildPlan(res, { lastEndAt = 0, now = 0, label = () => '' } = {}) {
  const fresh = res.fresh.map((e) => ({ ...e, level: levelOf(e) }))
    .sort((a, b) => b.level - a.level || (b.priority || 0) - (a.priority || 0));
  const badges = Object.keys(res.badges)
    .sort((a, b) => (RARITY_RANK[BADGE_BY_ID.get(b)?.rarity] ?? 0) - (RARITY_RANK[BADGE_BY_ID.get(a)?.rarity] ?? 0));
  const unlocks = res.newUnlocks || [];
  const plan = { level: 0, headline: null, chips: [], jackpot: false, reveal: null, alsoEarned: null, repeatToast: null };

  if (fresh.length) {
    plan.headline = fresh[0];
    plan.level = fresh[0].level;
    plan.chips = fresh.slice(1);
    if (fresh.filter((e) => e.level === 2).length >= 3) { plan.level = 3; plan.jackpot = true; }
  }
  const hasB = badges.length > 0 || unlocks.length > 0;
  if (hasB) {
    if (plan.level === 3) plan.alsoEarned = { badges, unlocks };
    else if (plan.level === 2) plan.reveal = { badges, unlocks, also: [], delay: 2400 };
    else {
      plan.reveal = { badges, unlocks, also: fresh, delay: 0 }; // an L1 pop folds into the reveal
      plan.level = 0;
      plan.headline = null;
      plan.chips = [];
    }
  }
  if (plan.level === 2 && now - lastEndAt < 2000) plan.level = 1; // don't fire cannons twice in a row
  if (!fresh.length && !hasB && res.repeats?.length) {
    const r = res.repeats.find((e) => e.kind === 'goal') || res.repeats[0];
    plan.repeatToast = r.kind === 'goal' ? `Still crushed: ${label(r.goal)}`
      : r.kind === 'weekMet' ? 'Week still locked in'
        : r.kind === 'freeze' ? 'Freeze already banked' : null;
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Hints, compliments, copy
// ---------------------------------------------------------------------------

const UNIT_TEXT = {
  workouts: (n) => `${n} more workout${n === 1 ? '' : 's'}`,
  weeks: (n) => `${n} more week${n === 1 ? '' : 's'} in a row`,
  days: (n) => `${n} more day${n === 1 ? '' : 's'} in a row`,
  min: (n) => `${n} min more`,
  wins: (n) => `${n} more win${n === 1 ? '' : 's'}`,
  PRs: (n) => `${n} more PR${n === 1 ? '' : 's'}`,
  'rest days': (n) => `${n} more rest day${n === 1 ? '' : 's'}`,
};

/** The badges (and looks) she's closest to: "2 more workouts → Quarter Century". */
export function nextUp({ progress, counts }, { units = 'mi', limit = 3 } = {}) {
  const out = [];
  for (const def of BADGES) {
    const p = progress.get(def.id);
    if (!p || p.earned || p.hidden || def.secret || !p.target) continue;
    const left = p.target - p.value;
    const frac = p.value / p.target;
    if (left <= 0) continue;
    const unit = def.measure.unit;
    let text = null;
    if (def.measure.kind === 'allTypes') {
      if (p.tooFew) continue;
      if (p.missing.length <= 2) text = `Try ${p.missing.join(' and ')} → ${def.name}`;
    } else if (unit === 'km') {
      if (frac >= 0.7) text = `${Math.ceil(kmToUnit(left, units) * 10) / 10} ${units} more → ${def.name}`;
    } else if (unit === 'wins' && def.winTier && (left <= 3 || frac >= 0.7)) {
      const n = Math.ceil(left);
      text = `${n} more ${LADDERS[def.winTier].what}${n === 1 ? '' : 's'} → ${def.name}`;
    } else if (UNIT_TEXT[unit] && (left <= 3 || frac >= 0.7)) {
      text = `${UNIT_TEXT[unit](Math.ceil(left))} → ${def.name}`;
    }
    if (text) out.push({ id: def.id, text, frac, target: p.target });
  }
  out.sort((a, b) => b.frac - a.frac || a.target - b.target);
  const hints = out.slice(0, limit);
  // One more win unlocks a look?
  if (counts) {
    for (const [tier, ladder] of Object.entries(LADDERS)) {
      const rung = ladder.rungs.find((r) => r.at === counts[tier] + 1);
      if (rung) {
        const name = rung.set || unlockInfo(rung.items[0]).name;
        hints.push({ id: `unlock:${tier}`, text: `1 more ${ladder.what} unlocks ${name}`, frac: 0.99, target: rung.at, unlock: rung.items });
      }
    }
  }
  return hints;
}

/** 32-bit FNV-1a: picks the same line every time for the same key. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function pickLine(key, pool, vars = {}) {
  const line = pool[fnv1a(String(key)) % pool.length];
  const name = String(vars.name || '').trim() || 'friend';
  return line.replace(/\{name\}/g, name).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;

/** A small personal line for the "logged!" banner. First matching rule wins. */
export function compliment(state, workout, today, name) {
  const who = String(name || '').trim() || 'friend';
  const ws = state.workouts.filter((w) => w.date <= today);
  if (ws.length === 1) return `Welcome to Glow, ${who}!`;
  const month = workout.date.slice(0, 7);
  if (ws.filter((w) => w.date.slice(0, 7) === month).length === 1) {
    return `First workout of ${parseKey(workout.date).toLocaleDateString(undefined, { month: 'long' })}!`;
  }
  const typeLabel = (state.settings.types.find((t) => t.id === workout.type)?.label || 'workout').toLowerCase();
  const sameType = ws.filter((w) => w.type === workout.type && w.id !== workout.id);
  if (workout.duration && sameType.length >= 3 && sameType.every((w) => (w.duration || 0) < workout.duration)) {
    return `Longest ${typeLabel} yet`;
  }
  const wk = weekKeyOf(workout.date, state.settings.weekStart);
  const thisWeek = ws.filter((w) => w.type === workout.type && weekKeyOf(w.date, state.settings.weekStart) === wk).length;
  if (thisWeek >= 2) return `Your ${ORD(thisWeek)} ${typeLabel} this week`;
  let streak = 1;
  for (let k = addDaysKey(workout.date, -7); ws.some((w) => w.date === k); k = addDaysKey(k, -7)) streak++;
  if (streak >= 3) return `${streak} ${parseKey(workout.date).toLocaleDateString(undefined, { weekday: 'long' })}s in a row`;
  const year = workout.date.slice(0, 4);
  const mins = ws.filter((w) => w.date.slice(0, 4) === year).reduce((s, w) => s + (w.duration || 0), 0);
  if (workout.duration && Math.floor(mins / 600) > Math.floor((mins - workout.duration) / 600)) {
    return `That's ${Math.floor(mins / 60)} hours of you-time this year, ${who}`;
  }
  return null;
}
