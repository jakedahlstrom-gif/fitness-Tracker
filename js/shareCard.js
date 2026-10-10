// "Goal crushed!" share card: a 1080×1350 Post (or 1080×1920 Story) PNG drawn on a
// canvas, always in the chosen palette's dark set, plus the "Share your win" sheet
// that previews it and hands the file to the share sheet, a download or the clipboard.
//
// Goal cards read the ledger snapshot (so they still render after the goal is edited
// or deleted); window stats come from current data. Nothing here writes to the store.

import { store } from './store.js';
import { PALETTES, currentLook } from './looks.js';
import { BADGE_BY_ID, RARITY_LABEL, RARITIES, badgeColors } from './badges.js';
import { badgeImage, hexOf, mixHex, HOLO, RARITY_COLOR } from './badgeArt.js';
import { icon, iconPath2D } from './icons.js';
import { photos } from './photos.js';
import { openSheet } from './sheet.js';
import { toast } from './toast.js';
import { goalLabel, goalNum, goalUnit, segmented, toggle } from './components.js';
import { buildCtx, goalProgress, nextMonthStart, weekKeyOf, chrono } from './progress.js';
import { fnv1a } from './rewards.js';
import { parseKey, addDaysKey, daysBetween, todayKey, fmtWeekRange } from './dates.js';
import { esc, fmtNum, plural, fmtDistance, isEmbedded, isTouchDevice, prefersReducedMotion } from './util.js';

const W = 1080;
const HEIGHT = { post: 1350, story: 1920 };
const STORY_DY = 230;   // hero, texts and tiles move down in a Story
const STORY_FOOT = 552; // so does the footer
const STACK = '"SF Pro Display", -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
const TEXT = '#F4F6FA';
const TEXT2 = '#A7AFBD';
const TEXT3 = '#6E7686';
const YELLOW = '#FFD43B';
const TAU = Math.PI * 2;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO_PREF = 'glow-fitness:share-photo';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Seeded PRNG, so the same win always gets the same sparkles. */
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex, a) {
  const n = parseInt(String(hex).slice(1, 7), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

const monDay = (key) => parseKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fullDay = (key) => parseKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const firstChar = (s) => {
  const seg = globalThis.Intl?.Segmenter ? [...new Intl.Segmenter().segment(s)][0]?.segment : [...s][0];
  return (seg || '').toUpperCase();
};

/** "goal:<id>:<periodKey>" → { id, pk } */
function parseGoalKey(k) {
  if (typeof k !== 'string' || !k.startsWith('goal:')) return null;
  const rest = k.slice(5);
  const i = rest.indexOf(':');
  return i < 0 ? null : { id: rest.slice(0, i), pk: rest.slice(i + 1) };
}

/** Workouts up to today (future-dated ones from a backup never count). */
function pastWorkouts() {
  const today = todayKey();
  return store.state.workouts.filter((w) => w.date <= today);
}

/** Earned badge defs, newest first (rarer first on the same day). */
function earnedBadges(filter = () => true) {
  const rank = (def) => RARITIES.indexOf(def.rarity);
  return Object.entries(store.awards.badges || {})
    .filter(([id, b]) => BADGE_BY_ID.has(id) && DAY_RE.test(b?.on) && filter(id, b))
    .sort(([a, x], [b, y]) => y.on.localeCompare(x.on) || String(y.at).localeCompare(String(x.at))
      || rank(BADGE_BY_ID.get(b)) - rank(BADGE_BY_ID.get(a)))
    .map(([id]) => BADGE_BY_ID.get(id));
}

const hoursText = (min) => (min < 600 ? String(Math.round(min / 6) / 10) : fmtNum(min / 60));

// ---------------------------------------------------------------------------
// Card models: everything the canvas needs, resolved from a spec
// ---------------------------------------------------------------------------

function resolveCard(spec) {
  if (!spec || typeof spec !== 'object') return null;
  try {
    if (spec.kind === 'goal') return goalCard(spec);
    if (spec.kind === 'badge') return badgeCard(spec);
    if (spec.kind === 'pr') return prCard(spec);
  } catch (err) {
    console.warn('share card', err);
  }
  return null;
}

/** A goal met right now (or in its current period) that may not be in the ledger yet. */
function liveGoalWin(goalId) {
  const g = store.getGoal(goalId);
  if (!g) return null;
  const p = store.derived().goals.find((x) => x.id === goalId) || store.progressFor(g);
  if (!p?.met) return null;
  return {
    key: `goal:${goalId}:${p.periodKey}`,
    entry: { kind: 'goal', on: p.achievedOn, tier: p.tier, goalId, label: goalLabel(g), metric: p.metric, target: p.target, value: p.value },
    achievedBy: p.achievedBy,
  };
}

function findGoalWin(spec) {
  const wins = store.awards.wins || {};
  if (spec.key) {
    const entry = spec.snapshot || wins[spec.key];
    if (entry) return { key: spec.key, entry };
    const live = liveGoalWin(parseGoalKey(spec.key)?.id);
    if (live && live.key === spec.key) return live;
    if (!spec.goalId) return null;
  }
  if (!spec.goalId) return spec.snapshot ? { key: null, entry: spec.snapshot } : null;
  if (spec.snapshot && !spec.key) return { key: null, entry: { goalId: spec.goalId, ...spec.snapshot } };
  const prefix = `goal:${spec.goalId}:`;
  const [newest] = Object.entries(wins)
    .filter(([k, e]) => k.startsWith(prefix) && DAY_RE.test(e?.on))
    .sort(([, a], [, b]) => b.on.localeCompare(a.on) || String(b.at).localeCompare(String(a.at)));
  const live = liveGoalWin(spec.goalId);
  if (live && (!newest || (live.key !== newest[0] && live.entry.on > newest[1].on))) return live;
  return newest ? { key: newest[0], entry: newest[1] } : null;
}

/** The goal's counting window [from, to) for the win; `to` is null for an open-ended long goal. */
function goalWindow(tier, pk, on, e, goal) {
  if (pk?.startsWith('W:') && DAY_RE.test(pk.slice(2))) return { from: pk.slice(2), to: addDaysKey(pk.slice(2), 7) };
  if (pk?.startsWith('M:') && /^\d{4}-\d{2}$/.test(pk.slice(2))) return { from: `${pk.slice(2)}-01`, to: nextMonthStart(pk.slice(2)) };
  if (tier === 'short') {
    const from = weekKeyOf(on, store.settings.weekStart);
    return { from, to: addDaysKey(from, 7) };
  }
  if (tier === 'medium') return { from: `${on.slice(0, 7)}-01`, to: nextMonthStart(on.slice(0, 7)) };
  const start = DAY_RE.test(e.start) ? e.start : goal?.start || null;
  const end = DAY_RE.test(e.end) ? e.end : goal?.end || null;
  return { from: start, to: end ? addDaysKey(end, 1) : null, end };
}

/** Readable goal text when a snapshot has no label. */
function fallbackLabel(e, tier) {
  const n = Number(e.target) || 0;
  const unit = goalUnit(e.metric, n);
  const base = `${goalNum(e.metric, n)} ${unit}`;
  return tier === 'short' ? `${base} this week` : tier === 'medium' ? `${base} this month` : base;
}

function goalCard(spec) {
  const found = findGoalWin(spec);
  if (!found || !found.entry) return null;
  const { key, entry: e } = found;
  const parsed = parseGoalKey(key);
  const goalId = e.goalId || parsed?.id || null;
  const goal = goalId ? store.getGoal(goalId) : null;
  const pk = parsed?.pk || null;
  const tier = ['short', 'medium', 'long'].includes(e.tier) ? e.tier
    : pk?.startsWith('W:') ? 'short' : pk?.startsWith('M:') ? 'medium' : pk === 'L' ? 'long' : goal?.tier || 'medium';
  const on = DAY_RE.test(e.on) ? e.on : todayKey();
  const metric = e.metric || goal?.metric || 'workouts';
  const value = Number.isFinite(Number(e.value)) ? Number(e.value) : Number(e.target) || 0;
  const { from, to, end } = goalWindow(tier, pk, on, e, goal);
  const inWindow = (d) => (!from || d >= from) && (!to || d < to);
  const all = pastWorkouts().sort(chrono);
  const win = all.filter((w) => inWindow(w.date));
  const upTo = win.filter((w) => w.date <= on);

  // Kicker
  let kicker;
  if (tier === 'short') kicker = `WEEKLY GOAL · ${fmtWeekRange(parseKey(from))}`;
  else if (tier === 'medium') kicker = `MONTHLY GOAL · ${parseKey(from).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
  else {
    const y1 = (from || on).slice(0, 4);
    const y2 = (end || on).slice(0, 4);
    kicker = `LONG-TERM GOAL · ${y1 !== y2 ? `${y1} – ${y2}` : on.slice(0, 4)}`;
  }

  // Context line
  const crushed = `Crushed ${monDay(on)}`;
  let context = crushed;
  if (tier !== 'long') {
    const spare = daysBetween(on, addDaysKey(to, -1));
    context = spare > 0 ? `${crushed} · ${plural(spare, 'day')} to spare` : `${crushed} · right on time`;
  } else if (end) {
    const early = daysBetween(on, end);
    context = early > 0 ? `${crushed} · ${plural(early, 'day')} early` : `${crushed} · right on time`;
  } else if (from && from <= on) {
    context = `Crushed in ${plural(daysBetween(from, on) + 1, 'day')}`;
  }

  // Tiles: A = the goal number, C = workouts, B = streak
  const unit = goalUnit(metric, value);
  const sinceLabel = from
    ? `SINCE ${parseKey(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(from.slice(0, 4) !== on.slice(0, 4) ? { year: 'numeric' } : {}) }).toUpperCase()}`
    : 'IN TOTAL';
  const ALT = { workouts: value === 1 ? 'WORKOUT' : 'WORKOUTS', days: 'ACTIVE DAYS', minutes: 'MINUTES' };
  const tileA = {
    color: 'A', value: goalNum(metric, value), unit,
    label: metric === 'longestDistance' ? 'IN ONE GO' : tier === 'short' ? 'THIS WEEK' : tier === 'medium' ? 'THIS MONTH' : sinceLabel,
    altLabel: ALT[metric] || unit.toUpperCase(), // used when the unit doesn't fit beside a big number
    spoken: `${goalNum(metric, value)} ${unit === 'min' ? 'minutes' : unit === 'mi' ? 'miles' : unit === 'km' ? 'kilometers' : unit}`,
  };
  const mins = upTo.reduce((s, w) => s + (w.duration || 0), 0);
  const minutesTile = (color) => (mins >= 600
    ? { color, value: hoursText(mins), unit: '', label: 'HOURS', spoken: `${hoursText(mins)} hours` }
    : { color, value: fmtNum(mins), unit: '', label: 'MINUTES', spoken: `${fmtNum(mins)} minutes` });
  const tileC = metric === 'workouts' ? minutesTile('C')
    : { color: 'C', value: fmtNum(upTo.length), unit: '', label: upTo.length === 1 ? 'WORKOUT' : 'WORKOUTS', spoken: plural(upTo.length, 'workout') };
  const d = store.derived();
  const activeDays = new Set(upTo.map((w) => w.date)).size;
  let tileB;
  if (d.weekly.current > 0) tileB = { color: 'B', value: fmtNum(d.weekly.current), unit: '', label: 'WK STREAK', spoken: `${d.weekly.current}-week streak` };
  else if (d.daily.count > 0) tileB = { color: 'B', value: fmtNum(d.daily.count), unit: '', label: 'DAY STREAK', spoken: `${d.daily.count}-day streak` };
  else if (metric !== 'days') tileB = { color: 'B', value: fmtNum(activeDays), unit: '', label: activeDays === 1 ? 'ACTIVE DAY' : 'ACTIVE DAYS', spoken: plural(activeDays, 'active day') };
  else tileB = minutesTile('B');

  // Photo candidates: the workout that crossed the line, else the latest in the window.
  let achievedBy = found.achievedBy || null;
  if (!achievedBy && goal) {
    const today = todayKey();
    const day = to ? (addDaysKey(to, -1) < today ? addDaysKey(to, -1) : today) : today;
    const p = goalProgress(goal, { ...buildCtx(store.state, today), today: day });
    if (!pk || p.periodKey === pk) achievedBy = p.achievedBy;
  }
  const withPhoto = (list) => list.filter((w) => w.photoId).reverse().map((w) => w.photoId);
  const hero = win.find((w) => w.id === achievedBy && w.photoId);
  const photoIds = [...new Set([...(hero ? [hero.photoId] : []), ...withPhoto(upTo), ...withPhoto(win)])];

  const label = String(e.label || '').trim() || (goal ? goalLabel(goal) : fallbackLabel(e, tier));
  const tiles = [tileA, tileC, tileB];
  return {
    kind: 'goal',
    seed: key || `goal:${goalId}:${on}`,
    on,
    kicker: kicker.toUpperCase(),
    kickerColor: 'A',
    title: 'GOAL CRUSHED!',
    subtitle: label,
    context,
    tiles,
    hero: { type: 'rings', colors: ['A', 'C', 'B'], glyph: 'check' },
    strip: earnedBadges((id, b) => inWindow(b.on)),
    photoIds,
    fileName: `glow-goal-crushed-${on}.png`,
    shareTitle: 'Goal crushed!',
    alt: `Goal crushed! ${label}. ${tiles.map((t) => t.spoken).join(', ')}.`,
  };
}

/** Past-tense criteria for the badge card subtitle ("100 workouts logged"). */
const CRITERIA = {
  nth: (t) => (t === 1 ? 'First workout logged' : `${fmtNum(t)} workouts logged`),
  weekRun: (t) => `Weekly goal hit ${t} weeks in a row`,
  dayRun: (t) => `${t} days in a row`,
  freezeEarned: () => 'First streak freeze banked',
  freezeUsed: () => 'A freeze saved the streak',
  minutesCum: (t) => `${fmtNum(t / 60)} hours logged`,
  durMax: (t) => `A ${t}-minute workout`,
  prs: (t) => (t === 1 ? 'First personal record' : `${t} personal records`),
  goalWins: () => 'First goal crushed',
  weeklyWins: (t) => `${t} winning weeks`,
  monthlyWins: () => 'A monthly goal crushed',
  longWins: () => 'A long-term goal crushed',
  ringWeeks: (t) => (t === 1 ? 'All 3 rings closed in a week' : `All 3 rings closed in ${t} weeks`),
  mix3: () => '3 kinds of workout in one week',
  feel5: (t) => `${t} workouts that felt amazing`,
  photo: () => 'First workout photo',
  hard: (t) => `${t} hard workouts`,
  rest: (t) => `${t} rest days taken`,
  kmMax: (t, u) => `${fmtDistance(t, u)} in one workout`,
  kmCum: (t, u) => `${fmtDistance(t, u)} in total`,
  early: (t) => `${t} workouts before 7 a.m.`,
  owl: (t) => `${t} workouts after 9 p.m.`,
  weekend: () => 'Saturday and Sunday, both owned',
  comeback: () => 'Back after a 2-week break',
  jan1: () => "A workout on New Year's Day",
  feb14: () => "A workout on Valentine's Day",
};
const CRITERIA_KIND = {
  gm3: () => 'Monthly goals 3 months in a row',
  crown: () => 'Weekly, monthly and long-term wins',
  allTypes: () => 'Every kind of workout tried',
};

function criteria(def) {
  const m = def.measure;
  const fn = CRITERIA_KIND[m.kind] || CRITERIA[m.key];
  return fn ? fn(m.target, store.settings.units) : def.how;
}

function badgeCard(spec) {
  const def = BADGE_BY_ID.get(spec.id);
  if (!def) return null;
  const rec = spec.snapshot || store.awards.badges?.[def.id];
  if (!rec || !DAY_RE.test(rec.on)) return null;
  const all = pastWorkouts();
  const mins = all.reduce((s, w) => s + (w.duration || 0), 0);
  const { earned, visible } = store.rewards().totals;
  const count = Math.max(earned, store.awards.badges?.[def.id] ? earned : earned + 1);
  const tiles = [
    { color: 'A', value: fmtNum(all.length), unit: '', label: all.length === 1 ? 'WORKOUT' : 'WORKOUTS', spoken: plural(all.length, 'workout') },
    { color: 'C', value: hoursText(mins), unit: '', label: 'HOURS', spoken: `${hoursText(mins)} hours` },
    { color: 'B', value: fmtNum(count), unit: `/${visible}`, label: 'BADGES', spoken: `${count} of ${visible} badges` },
  ];
  const subtitle = criteria(def);
  const first = all.reduce((min, w) => (w.date < min ? w.date : min), todayKey());
  const weeks = store.derived().weekly.current;
  const since = parseKey(first).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return {
    kind: 'badge',
    footer: `Glowing since ${since}${weeks > 0 ? ` · ${weeks}-week streak` : ''}`,
    seed: `badge:${def.id}`,
    on: rec.on,
    kicker: `${RARITY_LABEL[def.rarity].toUpperCase()} BADGE`,
    kickerColor: def.rarity === 'legendary' ? 'holo' : RARITY_COLOR[def.rarity],
    title: def.name.toUpperCase(),
    subtitle,
    context: `Earned ${fullDay(rec.on)}`,
    tiles,
    hero: { type: 'badge', def },
    strip: earnedBadges((id) => id !== def.id),
    photoIds: [],
    fileName: `glow-badge-${def.id}.png`,
    shareTitle: `New badge: ${def.name}`,
    alt: `${RARITY_LABEL[def.rarity]} badge unlocked: ${def.name}. ${subtitle}. ${tiles.map((t) => t.spoken).join(', ')}.`,
  };
}

const RECORD_NAME = {
  longestWorkout: 'Longest workout', bestWeek: 'Best week', bestMonth: 'Best month',
  dailyStreak: 'Longest daily streak', weeklyStreak: 'Longest weekly streak',
};
const RECORD_UNIT = { dailyStreak: ['day', 'days'], weeklyStreak: ['week', 'weeks'] };

function recordText(record, v) {
  const u = RECORD_UNIT[record];
  return u ? `${fmtNum(v)} ${v === 1 ? u[0] : u[1]}` : `${fmtNum(v)} min`;
}

function prCard(spec) {
  let entry = spec.snapshot || store.awards.wins?.[spec.key];
  const [, record, holder] = String(spec.key || '').split(':');
  if (!entry && RECORD_NAME[record]) {
    const r = store.derived().records[record];
    if (r?.holder && r.holder === holder) entry = { kind: 'pr', on: r.date, record, value: r.value, prev: r.prev };
  }
  if (!entry) return null;
  const rec = RECORD_NAME[entry.record] ? entry.record : RECORD_NAME[record] ? record : 'longestWorkout';
  const on = DAY_RE.test(entry.on) ? entry.on : todayKey();
  const value = Number(entry.value) || 0;
  const prev = Number(entry.prev) || 0;
  const unit = RECORD_UNIT[rec] ? (RECORD_UNIT[rec][1] === 'days' ? 'days' : 'wks') : 'min';
  const tiles = [
    { color: 'yellow', value: fmtNum(value), unit, label: 'NEW BEST', spoken: `new best ${recordText(rec, value)}` },
  ];
  if (prev > 0) {
    tiles.push({ color: 'B', value: fmtNum(prev), unit, label: 'PREVIOUS', spoken: `previous ${recordText(rec, prev)}` });
    tiles.push({ color: 'D', value: `+${fmtNum(value - prev)}`, unit, label: 'IMPROVEMENT', spoken: `${recordText(rec, value - prev)} more` });
  } else {
    const all = pastWorkouts();
    tiles.push({ color: 'A', value: fmtNum(all.length), unit: '', label: 'WORKOUTS', spoken: plural(all.length, 'workout') });
    tiles.push({ color: 'B', value: fmtNum(store.derived().weekly.current), unit: '', label: 'WK STREAK', spoken: `${store.derived().weekly.current}-week streak` });
  }
  const subtitle = `${RECORD_NAME[rec]} · ${recordText(rec, value)}`;
  return {
    kind: 'pr',
    seed: spec.key || `pr:${rec}:${on}`,
    on,
    kicker: 'NEW PERSONAL RECORD',
    kickerColor: 'yellow',
    title: 'NEW PR!',
    subtitle,
    context: prev > 0 ? `Previous best ${recordText(rec, prev)}` : `Set ${fullDay(on)}`,
    tiles,
    hero: { type: 'rings', colors: ['yellow', 'A', 'B'], glyph: 'trophy' },
    strip: earnedBadges(),
    photoIds: [],
    fileName: `glow-pr-${on}.png`,
    shareTitle: 'New PR!',
    alt: `New PR! ${subtitle}. ${prev > 0 ? `Previous best ${recordText(rec, prev)}.` : ''}`.trim(),
  };
}

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

/** Palette colors (dark set) plus a resolver for role names and badge color names. */
function paints(paletteId) {
  const set = (PALETTES[paletteId] || PALETTES.glow).dark;
  const P = {
    bg: set['--bg'], card: set['--card'], card2: set['--card-2'],
    A: set['--pink'], B: set['--cyan'], C: set['--purple'], D: set['--lime'],
    onAccent: set['--on-accent'],
  };
  P.hex = (name) => {
    if (P[name] && /^[A-D]$/.test(name)) return P[name];
    if (name === 'yellow') return YELLOW;
    if (String(name).startsWith('#')) return name;
    return hexOf(name, PALETTES[paletteId] ? paletteId : 'glow');
  };
  return P;
}

const setFont = (ctx, spec) => { ctx.font = `${spec} ${STACK}`; };

function shadow(ctx, color = 'transparent', blur = 0) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Width of text drawn with hand-made letter spacing. */
function spacedWidth(ctx, text, tracking) {
  const chars = [...text];
  return chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + tracking * Math.max(0, chars.length - 1);
}

/** Draw text one character at a time with `tracking` px between letters. Returns the pen x. */
function drawSpaced(ctx, text, x, y, tracking, align = 'left') {
  const w = spacedWidth(ctx, text, tracking);
  let pen = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.textAlign = 'left';
  for (const ch of text) {
    ctx.fillText(ch, pen, y);
    pen += ctx.measureText(ch).width + tracking;
  }
  return pen;
}

function ellipsize(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${chars.slice(0, mid).join('').trimEnd()}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`;
}

function radialGlow(ctx, x, y, r, color, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.55, rgba(color, a * 0.42));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Four-point sparkle; inner radius .28 of the size. */
function sparkle(ctx, x, y, r, color) {
  const i = r * 0.28;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + i, y - i);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + i, y + i);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - i, y + i);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - i, y - i);
  ctx.closePath();
  shadow(ctx, color, 12);
  ctx.fillStyle = color;
  ctx.fill();
}

/** A ring's stroke: darker where it starts, brighter where it ends (conic; linear on old Safari). */
function ringPaint(ctx, cx, cy, r, color) {
  const dark = mixHex(color, 84, '#000000');
  const light = mixHex(color, 80, '#FFFFFF');
  if (ctx.createConicGradient) {
    const g = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    g.addColorStop(0, dark);
    g.addColorStop(0.6, color);
    g.addColorStop(1, light);
    return g;
  }
  const g = ctx.createLinearGradient(cx - r, cy + r, cx + r, cy - r);
  g.addColorStop(0, dark);
  g.addColorStop(0.6, color);
  g.addColorStop(1, light);
  return g;
}

function drawBackground(ctx, P, h, story) {
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, h);
  radialGlow(ctx, 160, 180, 560, P.A, 0.30);
  radialGlow(ctx, 980, 420, 420, P.C, 0.18);
  if (story) {
    radialGlow(ctx, 120, 1180, 520, P.C, 0.12);
    radialGlow(ctx, 900, 1760, 700, P.B, 0.24);
  } else {
    radialGlow(ctx, 900, 1260, 600, P.B, 0.24);
  }
  // Dot grid
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  ctx.beginPath();
  const bottom = story ? 1848 : 1278;
  for (let y = 72; y <= bottom; y += 36) {
    for (let x = 72; x <= 1008; x += 36) ctx.rect(x - 1, y - 1, 2, 2);
  }
  ctx.fill();
}

function drawRays(ctx, P, cx, cy, colors = ['A', 'B']) {
  for (let i = 0; i < 16; i++) {
    const a = (i * TAU) / 16 - Math.PI / 2 + TAU / 32;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const tx = cx + ux * 330;
    const ty = cy + uy * 330;
    const g = ctx.createLinearGradient(cx, cy, tx, ty);
    const c = P.hex(colors[i % 2]);
    g.addColorStop(0, rgba(c, 0));
    g.addColorStop(0.4, rgba(c, 0.07));
    g.addColorStop(0.75, rgba(c, 0.07));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx - uy * 17, ty + ux * 17);
    ctx.lineTo(tx + uy * 17, ty - ux * 17);
    ctx.closePath();
    ctx.fill();
  }
}

function drawSparkles(ctx, P, rnd, dy, keepOut) {
  const ANCHORS = [
    [232, 252, 22, 'A'], [848, 236, 26, 'B'], [196, 560, 14, 'D'], [884, 600, 18, 'A'],
    [300, 170, 10, '#FFFFFF'], [780, 150, 12, '#FFFFFF'], [150, 420, 10, 'B'], [930, 430, 12, 'C'],
    [470, 120, 8, 'C'], [612, 118, 9, YELLOW], [118, 300, 9, YELLOW], [962, 320, 10, 'D'],
  ];
  for (const [x, y, s, c] of ANCHORS) {
    const jx = (rnd() * 2 - 1) * 16;
    const jy = (rnd() * 2 - 1) * 16;
    const r = s * (0.8 + rnd() * 0.4);
    const sx = x + jx;
    let sy = y + dy + jy;
    if (sy - r < 160 && keepOut.some(([a, b]) => sx + r > a && sx - r < b)) sy = 166 + r;
    sparkle(ctx, sx, sy, r, P.hex(c));
  }
  shadow(ctx);
}

/** A white glyph from icons.js, centered and scaled, with a glow. */
function drawGlyph(ctx, name, cx, cy, scale, width, color, glow, blur) {
  ctx.save();
  ctx.translate(cx - 12 * scale, cy - 12.25 * scale);
  ctx.scale(scale, scale);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  const path = iconPath2D(name);
  shadow(ctx, glow, blur);
  ctx.stroke(path);
  shadow(ctx);
  ctx.stroke(path);
  ctx.restore();
}

function drawRings(ctx, P, m, cx, cy, photo) {
  const R = [176, 138, 100];
  const OVER = [0.055, 0.085, 0.12]; // each end runs a little past the top: closed and then some
  const cols = m.hero.colors.map((c) => P.hex(c));
  const circle = (r) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineWidth = 28;
  shadow(ctx);
  R.forEach((r, i) => { ctx.strokeStyle = rgba(cols[i], 0.15); circle(r); });
  // Glow pass
  R.forEach((r, i) => {
    ctx.strokeStyle = cols[i];
    shadow(ctx, cols[i], 26);
    circle(r);
  });
  shadow(ctx);
  // Keep the gaps between rings dark so each ring reads on its own.
  ctx.lineWidth = 10;
  ctx.strokeStyle = rgba(P.bg, 0.6);
  circle(157);
  circle(119);
  // Crisp pass, then the end cap casting a soft shadow on the start
  ctx.lineWidth = 28;
  R.forEach((r, i) => {
    const c = cols[i];
    ctx.strokeStyle = ringPaint(ctx, cx, cy, r, c);
    ctx.lineCap = 'round';
    circle(r);
    const a = -Math.PI / 2 + OVER[i] * TAU;
    const ex = cx + Math.cos(a) * r;
    const ey = cy + Math.sin(a) * r;
    const light = mixHex(c, 80, '#FFFFFF');
    ctx.fillStyle = light;
    shadow(ctx, 'rgba(0,0,0,0.55)', 14);
    ctx.beginPath();
    ctx.arc(ex, ey, 14, 0, TAU);
    ctx.fill();
    shadow(ctx);
    ctx.strokeStyle = light;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2 - 0.12, a);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 14, 0, TAU);
    ctx.fill();
    // Cap highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(ex + Math.cos(a + Math.PI / 2) * 1.5, ey + Math.sin(a + Math.PI / 2) * 1.5, 7, 0, TAU);
    ctx.fill();
  });
  ctx.lineCap = 'round';

  if (photo) {
    drawPhoto(ctx, photo, cx, cy, 84);
    // Check badge
    const bx = cx + 64;
    const by = cy + 64;
    ctx.fillStyle = P.card;
    ctx.beginPath();
    ctx.arc(bx, by, 32, 0, TAU);
    ctx.fill();
    shadow(ctx, rgba(P.D, 0.8), 18);
    ctx.fillStyle = P.D;
    ctx.beginPath();
    ctx.arc(bx, by, 26, 0, TAU);
    ctx.fill();
    shadow(ctx);
    drawGlyph(ctx, m.hero.glyph, bx, by, 2.2, 3.6, P.bg, 'transparent', 0);
    return;
  }
  // Center disc with the glyph
  shadow(ctx, 'rgba(0,0,0,0.5)', 20);
  ctx.fillStyle = P.card;
  ctx.beginPath();
  ctx.arc(cx, cy, 62, 0, TAU);
  ctx.fill();
  shadow(ctx);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (m.hero.glyph === 'trophy') drawGlyph(ctx, 'trophy', cx, cy, 4.2, 2.3, '#FFFFFF', rgba(YELLOW, 0.9), 18);
  else drawGlyph(ctx, 'check', cx, cy, 4.6, 3.2, '#FFFFFF', P.A, 18);
}

/** Her photo, cover-fit in a circle, with a dark bottom fade and a thin white ring. */
function drawPhoto(ctx, img, cx, cy, r) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max((r * 2) / iw, (r * 2) / ih);
  const dw = iw * s;
  const dh = ih * s;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  const g = ctx.createLinearGradient(0, cy, 0, cy + r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy, r * 2, r);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
}

function drawHero(ctx, P, m, assets, dy, rnd, keepOut) {
  const badge = m.hero.type === 'badge';
  const cx = 540;
  const cy = (badge ? 440 : 450) + dy;
  const b1 = badge ? P.hex(badgeColors(m.hero.def)[0]) : P.A;
  radialGlow(ctx, cx, cy, 300, b1, 0.22);
  drawRays(ctx, P, cx, cy);
  if (badge) {
    const img = assets.badges.get(`${m.hero.def.id}@380`);
    if (img) {
      shadow(ctx, b1, 40);
      ctx.drawImage(img, cx - 190, cy - 190, 380, 380);
      shadow(ctx);
      ctx.drawImage(img, cx - 190, cy - 190, 380, 380);
    }
  } else {
    drawRings(ctx, P, m, cx, cy, assets.photo);
  }
  drawSparkles(ctx, P, rnd, dy, keepOut);
}

function drawFrame(ctx, P, h) {
  const g = ctx.createLinearGradient(40, 40, 1040, h - 40);
  g.addColorStop(0, P.A);
  g.addColorStop(0.5, P.C);
  g.addColorStop(1, P.B);
  ctx.strokeStyle = g;
  ctx.lineWidth = 3;
  roundRect(ctx, 40, 40, 1000, h - 80, 56);
  shadow(ctx, rgba(P.A, 0.6), 30);
  ctx.stroke();
  shadow(ctx);
  ctx.stroke();
}

/** Horizontal extents of the brand and the date, so sparkles can keep clear of them. */
function headerSpans(ctx, m) {
  setFont(ctx, '800 30px');
  const brand = spacedWidth(ctx, 'GLOW//FIT', 8);
  setFont(ctx, '700 26px');
  const date = spacedWidth(ctx, fullDay(m.on).toUpperCase(), 3);
  return [[96 - 10, 96 + brand + 10], [984 - date - 10, 984 + 10]];
}

function drawHeader(ctx, P, m) {
  ctx.textBaseline = 'alphabetic';
  setFont(ctx, '800 30px');
  ctx.fillStyle = TEXT;
  let x = drawSpaced(ctx, 'GLOW', 96, 140, 8);
  ctx.fillStyle = P.A;
  shadow(ctx, P.A, 14);
  drawSpaced(ctx, '//', x, 140, 8);
  shadow(ctx);
  x = drawSpaced(ctx, '//', x, 140, 8);
  ctx.fillStyle = TEXT;
  drawSpaced(ctx, 'FIT', x, 140, 8);

  setFont(ctx, '700 26px');
  ctx.fillStyle = TEXT2;
  drawSpaced(ctx, fullDay(m.on).toUpperCase(), 984, 140, 3, 'right');
}

function drawTexts(ctx, P, m, dy) {
  ctx.textBaseline = 'alphabetic';
  // Kicker
  setFont(ctx, '800 28px');
  const kw = spacedWidth(ctx, m.kicker, 6);
  let kfill;
  let kglow;
  if (m.kickerColor === 'holo') {
    const g = ctx.createLinearGradient(540 - kw / 2, 0, 540 + kw / 2, 0);
    HOLO.forEach((c, i) => g.addColorStop(i / (HOLO.length - 1), c));
    kfill = g;
    kglow = HOLO[1];
  } else {
    kfill = P.hex(m.kickerColor);
    kglow = kfill;
  }
  ctx.fillStyle = kfill;
  shadow(ctx, kglow, 12);
  drawSpaced(ctx, m.kicker, 540, 712 + dy, 6, 'center');
  shadow(ctx);

  // Title: shrinks in 4 px steps until it fits 920 px
  let size = 112;
  setFont(ctx, `italic 900 ${size}px`);
  while (ctx.measureText(m.title).width > 920 && size > 40) {
    size -= 4;
    setFont(ctx, `italic 900 ${size}px`);
  }
  const tw = ctx.measureText(m.title).width;
  const g = ctx.createLinearGradient(540 - tw / 2, 0, 540 + tw / 2, 0);
  g.addColorStop(0, P.A);
  g.addColorStop(0.5, P.C);
  g.addColorStop(1, P.B);
  ctx.textAlign = 'center';
  ctx.fillStyle = g;
  shadow(ctx, rgba(P.A, 0.7), 36);
  ctx.fillText(m.title, 540, 812 + dy);
  shadow(ctx);
  ctx.fillText(m.title, 540, 812 + dy);

  // Subtitle: 44 → 34 px, then ellipsized at 900
  let ss = 44;
  setFont(ctx, `700 ${ss}px`);
  while (ctx.measureText(m.subtitle).width > 900 && ss > 34) {
    ss -= 2;
    setFont(ctx, `700 ${ss}px`);
  }
  ctx.fillStyle = TEXT;
  ctx.fillText(ellipsize(ctx, m.subtitle, 900), 540, 878 + dy);

  // Context
  setFont(ctx, '600 28px');
  ctx.fillStyle = TEXT2;
  ctx.fillText(ellipsize(ctx, m.context, 900), 540, 928 + dy);
  ctx.textAlign = 'left';
}

function drawTiles(ctx, P, m, top) {
  const XS = [96, 404, 712];
  m.tiles.slice(0, 3).forEach((t, i) => {
    const x = XS[i];
    const c = P.hex(t.color);
    roundRect(ctx, x, top, 272, 176, 32);
    ctx.fillStyle = rgba(P.card, 0.92);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Accent bar
    ctx.fillStyle = c;
    shadow(ctx, c, 12);
    roundRect(ctx, x + 28, top + 24, 56, 4, 2);
    ctx.fill();
    shadow(ctx);
    // Value + unit, shrunk to fit 216 px. If the unit would squeeze the number below
    // 68 px, it moves into the label instead ("150 workouts" → "150" over WORKOUTS).
    let unit = t.unit;
    let label = t.label;
    let vs = 76;
    let us = 30;
    const measure = () => {
      setFont(ctx, `800 ${vs}px`);
      const v = ctx.measureText(t.value).width;
      setFont(ctx, `600 ${us}px`);
      return v + (unit ? 8 + ctx.measureText(unit).width : 0);
    };
    const shrink = (min) => {
      while (measure() > 216 && vs > min) {
        vs -= 4;
        us = Math.max(20, Math.round(vs * 0.4));
      }
    };
    shrink(68);
    if (measure() > 216 && unit && t.altLabel) {
      unit = '';
      label = t.altLabel;
      vs = 76;
    }
    shrink(40);
    setFont(ctx, `800 ${vs}px`);
    ctx.textAlign = 'left';
    ctx.fillStyle = c;
    shadow(ctx, rgba(c, 0.55), 18);
    ctx.fillText(t.value, x + 28, top + 112);
    shadow(ctx);
    ctx.fillText(t.value, x + 28, top + 112);
    if (unit) {
      const vw = ctx.measureText(t.value).width;
      setFont(ctx, `600 ${us}px`);
      ctx.fillStyle = TEXT2;
      ctx.fillText(unit, x + 28 + vw + 8, top + 112);
    }
    // Label
    let ls = 22;
    setFont(ctx, `700 ${ls}px`);
    while (spacedWidth(ctx, label, 3) > 216 && ls > 16) {
      ls -= 1;
      setFont(ctx, `700 ${ls}px`);
    }
    ctx.fillStyle = TEXT3;
    drawSpaced(ctx, label, x + 28, top + 150, 3);
  });
}

function drawStrip(ctx, P, m, assets) {
  const defs = m.strip;
  if (!defs.length) {
    // Nothing to show: a quiet sign-off instead of an empty band.
    setFont(ctx, '800 26px');
    ctx.fillStyle = TEXT3;
    drawSpaced(ctx, 'KEEP GLOWING', 540, 1600, 10, 'center');
    const w = spacedWidth(ctx, 'KEEP GLOWING', 10);
    sparkle(ctx, 540 - w / 2 - 40, 1591, 12, P.A);
    sparkle(ctx, 540 + w / 2 + 40, 1591, 12, P.B);
    shadow(ctx);
    return;
  }
  setFont(ctx, '700 24px');
  ctx.fillStyle = TEXT3;
  drawSpaced(ctx, 'BADGES EARNED', 540, 1500, 4, 'center');
  const more = defs.length > 5 ? defs.length - 5 : 0;
  const shown = defs.slice(0, 5);
  setFont(ctx, '800 30px');
  const chipW = more ? Math.ceil(ctx.measureText(`+${more}`).width) + 44 : 0;
  const total = shown.length * 120 + (shown.length - 1) * 36 + (more ? 36 + chipW : 0);
  let x = 540 - total / 2;
  for (const def of shown) {
    const img = assets.badges.get(`${def.id}@120`);
    if (img) {
      shadow(ctx, rgba(P.hex(badgeColors(def)[0]), 0.7), 18);
      ctx.drawImage(img, x, 1530, 120, 120);
      shadow(ctx);
      ctx.drawImage(img, x, 1530, 120, 120);
    }
    x += 156;
  }
  if (more) {
    roundRect(ctx, x, 1560, chipW, 60, 30);
    ctx.fillStyle = rgba(P.card2, 0.95);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.stroke();
    setFont(ctx, '800 30px');
    ctx.fillStyle = TEXT2;
    ctx.textAlign = 'center';
    ctx.fillText(`+${more}`, x + chipW / 2, 1601);
    ctx.textAlign = 'left';
  }
}

function drawLogo(ctx, P, x, y) {
  const cx = x + 28;
  const cy = y + 28;
  const rings = [[22.4, 0.833, P.A], [16.2, 0.694, P.C], [10.1, 0.597, P.B]];
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  for (const [r, f, c] of rings) {
    ctx.strokeStyle = rgba(c, 0.2);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = c;
    shadow(ctx, c, 10);
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + f * TAU);
    ctx.stroke();
    shadow(ctx);
    ctx.stroke();
  }
}

function drawFooter(ctx, P, m, fy) {
  const name = String(store.settings.name || '').trim() || 'Glow Fitness';
  // Avatar
  const g = ctx.createLinearGradient(96, 1206 + fy, 152, 1262 + fy);
  g.addColorStop(0, P.A);
  g.addColorStop(1, P.C);
  ctx.fillStyle = g;
  shadow(ctx, rgba(P.A, 0.6), 16);
  ctx.beginPath();
  ctx.arc(124, 1234 + fy, 28, 0, TAU);
  ctx.fill();
  shadow(ctx);
  setFont(ctx, '800 28px');
  ctx.fillStyle = P.onAccent;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(firstChar(name), 124, 1235 + fy);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  // Name + totals
  setFont(ctx, '800 30px');
  ctx.fillStyle = TEXT;
  ctx.fillText(ellipsize(ctx, name, 560), 168, 1228 + fy);
  const all = pastWorkouts();
  const hours = Math.round(all.reduce((s, w) => s + (w.duration || 0), 0) / 60);
  const { earned } = store.rewards().totals;
  setFont(ctx, '600 24px');
  ctx.fillStyle = TEXT2;
  const line = m.footer || `${plural(all.length, 'workout')} · ${fmtNum(hours)} h · ${plural(earned, 'badge')}`;
  ctx.fillText(ellipsize(ctx, line, 700), 168, 1262 + fy);
  drawLogo(ctx, P, 928, 1206 + fy);
}

function drawCard(ctx, m, P, assets, story) {
  const h = story ? HEIGHT.story : HEIGHT.post;
  const dy = story ? STORY_DY : 0;
  const rnd = mulberry32(fnv1a(m.seed));
  drawBackground(ctx, P, h, story);
  drawHero(ctx, P, m, assets, dy, rnd, headerSpans(ctx, m));
  drawFrame(ctx, P, h);
  drawHeader(ctx, P, m);
  drawTexts(ctx, P, m, dy);
  drawTiles(ctx, P, m, 990 + dy);
  if (story) drawStrip(ctx, P, m, assets);
  drawFooter(ctx, P, m, story ? STORY_FOOT : 0);
}

// ---------------------------------------------------------------------------
// Assets and output
// ---------------------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed'));
    img.src = src;
  });
}

/** First photo id (in order) that is actually in IndexedDB, or null. */
async function firstStoredPhoto(ids) {
  for (const id of ids) {
    try {
      if (await photos.get(id)) return id;
    } catch {
      return null; // IndexedDB blocked
    }
  }
  return null;
}

async function loadAssets(m, palette, story, photo) {
  const badges = new Map();
  const jobs = [];
  const want = (def, size) => jobs.push(badgeImage(def, { size, palette })
    .then((img) => badges.set(`${def.id}@${size}`, img))
    .catch(() => {}));
  if (m.hero.type === 'badge') want(m.hero.def, 380);
  if (story) m.strip.slice(0, 5).forEach((def) => want(def, 120));

  let photoImg = null;
  let photoFailed = false;
  if (photo && m.kind === 'goal') {
    const ids = typeof photo === 'string' ? [photo] : m.photoIds;
    jobs.push((async () => {
      try {
        const id = await firstStoredPhoto(ids);
        const url = id ? await photos.get(id) : null;
        if (!url) throw new Error('no photo');
        photoImg = await loadImage(url);
      } catch {
        photoFailed = true;
      }
    })());
  }
  await Promise.all(jobs);
  return { badges, photo: photoImg, photoFailed };
}

function canvasBlob(canvas) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch {
      resolve(null);
    }
  }).then(async (blob) => {
    if (blob) return blob;
    try {
      const res = await fetch(canvas.toDataURL('image/png'));
      return await res.blob();
    } catch {
      return null;
    }
  });
}

async function renderModel(m, { format = 'post', palette, photo = false } = {}) {
  const pal = PALETTES[palette] ? palette : currentLook().palette;
  const story = format === 'story';
  const assets = await loadAssets(m, pal, story, photo);
  if (assets.photoFailed) toast("Couldn't add your photo", { urgent: true });
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = story ? HEIGHT.story : HEIGHT.post;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Couldn't make the image");
  drawCard(ctx, m, paints(pal), assets, story);
  const blob = await canvasBlob(canvas);
  canvas.width = 0; // frees the bitmap now (iOS caps total canvas memory)
  canvas.height = 0;
  if (!blob) throw new Error("Couldn't make the image");
  const file = new File([blob], m.fileName, { type: 'image/png' });
  return { blob, file, url: URL.createObjectURL(blob), photoFailed: assets.photoFailed };
}

/**
 * Render a share card to a PNG.
 * @param {object} spec  { kind: 'goal', key } | { kind: 'goal', goalId } | { kind: 'badge', id } | { kind: 'pr', key },
 *                       optionally with `snapshot` (sample/unsaved data; the store is never written)
 * @param {object} [o]
 * @param {'post'|'story'} [o.format]
 * @param {string} [o.palette]  palette id (default: the equipped one); always its dark set
 * @param {boolean|string} [o.photo]  true = her best photo for the goal window, or a photo id
 * @returns {Promise<{blob: Blob, file: File, url: string}>}  `url` is an object URL; the caller revokes it
 */
export async function renderShareCard(spec, opts = {}) {
  const m = resolveCard(spec);
  if (!m) throw new Error('Nothing to share');
  return renderModel(m, opts);
}

// ---------------------------------------------------------------------------
// "Share your win" sheet
// ---------------------------------------------------------------------------

function readPhotoPref() {
  try { return localStorage.getItem(PHOTO_PREF) === '1'; } catch { return false; }
}

function savePhotoPref(on) {
  try { localStorage.setItem(PHOTO_PREF, on ? '1' : '0'); } catch { /* storage blocked */ }
}

/** Can this browser share PNG files at all? (probed before the real file exists) */
function canShareFiles() {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'glow.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new window.FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const ACTION = {
  share: { label: 'Share', icon: 'share' },
  save: { label: 'Save image', icon: 'download' },
  copy: { label: 'Copy image', icon: 'copy' },
};

/** Open the "Share your win" sheet for a spec (see renderShareCard). Returns the sheet, or null. */
export function openShareSheet(spec) {
  const m = resolveCard(spec);
  if (!m) {
    toast('Nothing to share yet', { urgent: true });
    return null;
  }
  const embedded = isEmbedded();
  const action = embedded
    ? (window.ClipboardItem && navigator.clipboard?.write ? 'copy' : null)
    : canShareFiles() ? 'share' : 'save';
  const look = currentLook().palette;
  const unlocked = store.rewards().unlocked;
  const palettes = Object.keys(PALETTES).filter((id) => id === 'glow' || id === look || unlocked.has(`palette:${id}`));
  const opts = { format: 'post', palette: PALETTES[look] ? look : 'glow', photo: false };
  const dark = (id) => PALETTES[id].dark;
  const hint = isTouchDevice() ? 'Press and hold the image to save or share it' : 'Right-click the image to save it';

  const swatches = palettes.length > 1 ? `
    <div class="share-swatches" role="radiogroup" aria-label="Card colors">${palettes.map((id) => `
      <button type="button" class="share-swatch${id === opts.palette ? ' on' : ''}" role="radio" aria-checked="${id === opts.palette}"
        aria-label="${esc(PALETTES[id].name)}" data-action="share-palette" data-value="${id}"
        style="--sw-a:${dark(id)['--pink']};--sw-b:${dark(id)['--cyan']};--sw-c:${dark(id)['--purple']}"><span></span></button>`).join('')}
    </div>` : '';

  const body = `
    <div class="share-sheet">
      <div class="share-frame is-loading${embedded ? ' is-embedded' : ''}${prefersReducedMotion() ? ' calm' : ''}">
        <div class="share-shimmer" aria-hidden="true"></div>
        <img class="share-img" alt="" hidden>
      </div>
      ${embedded ? `<p class="share-hint muted small">${esc(hint)}</p>` : ''}
      ${segmented('share-format', [['post', 'Post'], ['story', 'Story']], opts.format, { ariaLabel: 'Image shape' })}
      ${swatches}
      <div class="set-row share-photo" hidden>
        <span class="set-label">${icon('camera')} Add my photo</span>
        ${toggle('share-photo', false, 'Add my photo')}
      </div>
    </div>`;
  const footer = action
    ? `<button type="button" class="btn btn-primary" data-action="share-${action}" disabled>${icon(ACTION[action].icon)}<span>Preparing…</span></button>`
    : '';

  let closed = false;
  let current = null; // { blob, file, url }
  let token = 0;
  let timer = 0;
  let sharing = false;
  let photoId = null;

  const sheet = openSheet({
    title: 'Share your win',
    body,
    footer,
    className: 'share-layer',
    onClose: () => {
      closed = true;
      token++;
      clearTimeout(timer);
      if (current) URL.revokeObjectURL(current.url);
      current = null;
    },
  });
  const frame = sheet.body.querySelector('.share-frame');
  const img = sheet.body.querySelector('.share-img');
  const photoRow = sheet.body.querySelector('.share-photo');
  const btn = sheet.el.querySelector('.sheet-foot .btn');

  const paintFrame = () => {
    const story = opts.format === 'story';
    frame.style.setProperty('--share-ar', story ? '9 / 16' : '4 / 5');
    frame.style.setProperty('--share-r', story ? '0.5625' : '0.8');
    frame.style.setProperty('--share-glow', dark(opts.palette)['--pink']);
    frame.style.setProperty('--share-bg', dark(opts.palette)['--bg']);
  };

  const setBusy = (busy) => {
    frame.classList.toggle('is-busy', busy && !!current);
    if (!btn) return;
    const ready = !busy && !!current;
    btn.disabled = !ready;
    btn.querySelector('span').textContent = ready ? ACTION[action].label : 'Preparing…';
  };

  img.addEventListener('load', () => frame.classList.remove('is-loading'));

  async function run() {
    const my = ++token;
    try {
      const res = await renderModel(m, opts);
      const src = embedded ? await blobToDataURL(res.blob) : res.url;
      if (closed || my !== token) {
        URL.revokeObjectURL(res.url);
        return;
      }
      if (current) URL.revokeObjectURL(current.url);
      current = res;
      img.alt = m.alt;
      img.src = src;
      img.hidden = false;
      if (res.photoFailed) {
        photoRow.hidden = true;
        opts.photo = false;
      }
      setBusy(false);
    } catch {
      if (closed || my !== token) return;
      toast("Couldn't make the image", { urgent: true });
      setBusy(false);
    }
  }

  const schedule = (delay = 120) => {
    clearTimeout(timer);
    token++; // anything in flight is now stale
    setBusy(true);
    timer = setTimeout(run, delay);
  };

  paintFrame();
  setBusy(true);
  // Show the photo switch only when the window really has a stored photo.
  (m.photoIds.length ? firstStoredPhoto(m.photoIds) : Promise.resolve(null)).then((id) => {
    if (closed) return;
    photoId = id;
    if (id) {
      photoRow.hidden = false;
      if (readPhotoPref()) {
        opts.photo = id;
        const sw = photoRow.querySelector('.switch');
        sw.classList.add('on');
        sw.setAttribute('aria-checked', 'true');
      }
    }
    schedule(0);
  });

  function onShare() {
    if (!current || sharing) return;
    const { file } = current;
    if (!navigator.canShare?.({ files: [file] })) {
      download(file);
      return;
    }
    sharing = true;
    let p;
    try {
      p = navigator.share({ files: [file], title: m.shareTitle }); // synchronously inside the tap
    } catch {
      sharing = false;
      download(file);
      return;
    }
    Promise.resolve(p)
      .catch((err) => { if (err?.name !== 'AbortError') download(file); })
      .finally(() => { sharing = false; });
  }

  function onCopy() {
    if (!current || sharing) return;
    sharing = true;
    let p;
    try {
      p = navigator.clipboard.write([new window.ClipboardItem({ 'image/png': current.blob })]);
    } catch (err) {
      p = Promise.reject(err);
    }
    Promise.resolve(p)
      .then(() => toast('Image copied'), () => toast('Press and hold the image instead', { urgent: true }))
      .finally(() => { sharing = false; });
  }

  sheet.el.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    if (act === 'share-share') onShare();
    else if (act === 'share-save') { if (current) download(current.file); }
    else if (act === 'share-copy') onCopy();
    else if (act === 'share-format') {
      if (el.dataset.value === opts.format) return;
      opts.format = el.dataset.value;
      el.parentElement.querySelectorAll('.seg').forEach((s) => {
        const on = s === el;
        s.classList.toggle('on', on);
        s.setAttribute('aria-checked', String(on));
      });
      // New shape: show the placeholder until the new image is ready.
      frame.classList.add('is-loading');
      img.hidden = true;
      paintFrame();
      schedule();
    } else if (act === 'share-palette') {
      if (el.dataset.value === opts.palette) return;
      opts.palette = el.dataset.value;
      sheet.body.querySelectorAll('.share-swatch').forEach((s) => {
        const on = s === el;
        s.classList.toggle('on', on);
        s.setAttribute('aria-checked', String(on));
      });
      paintFrame();
      schedule();
    } else if (act === 'share-photo') {
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', String(on));
      opts.photo = on ? photoId : false;
      savePhotoPref(on);
      schedule();
    }
  });

  return sheet;
}
