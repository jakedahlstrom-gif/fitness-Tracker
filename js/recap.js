// "Your Year in Glow": a swipeable, story-style year in review. openRecap(year) plays the
// yearRecap() model (store.recap, or a lab sample) on its own always-dark layer above the
// app: progress segments, tap / hold / swipe / keys, 14 slides with their own motion and
// sound, and a finale that shares the year as a card. The only write is marking the year
// watched (never for samples). Loaded on demand: import('./recap.js').

import { store } from './store.js';
import { confetti, sound, haptic, unlockAudio, isCalm } from './effects.js';
import { createShow, skyColors, WHITE } from './fireworks.js';
import { badgeSVG, RARITY_COLOR } from './badgeArt.js';
import { BADGE_BY_ID, RARITY_LABEL } from './badges.js';
import { paletteStyle, currentLook, unlockInfo } from './looks.js';
import { paletteOrbHTML, holdMiniHTML } from './lookParts.js';
import { pickLine } from './rewards.js';
import { photos } from './photos.js';
import { icon } from './icons.js';
import { miniMonthSVG } from './heatmap.js';
import { modalKeys, openShare } from './celebrate.js';
import { toast } from './toast.js';
import { esc, fmtNum, fmtDistance, prefersReducedMotion } from './util.js';
import { parseKey, addDaysKey, daysBetween, fmtWeekRange } from './dates.js';

const ORDER = ['cover', 'first', 'count', 'minutes', 'squares', 'top', 'rhythm', 'bigWeek', 'streak', 'bests', 'trophies', 'vibe', 'moment', 'finale'];
const DUR = { first: 5000, count: 6000, minutes: 6500, squares: 7000, top: 6500, rhythm: 7000, bigWeek: 6000, streak: 6000, bests: 6000, trophies: 7000, vibe: 5500, moment: 7500 };
const LABEL = {
  cover: 'Your year in Glow', first: 'Day one', count: 'You showed up', minutes: 'Time for you', squares: 'Your year in squares',
  top: 'Your number one', rhythm: 'Your rhythm', bigWeek: 'Your biggest week', streak: 'On a roll', bests: 'Personal bests',
  trophies: 'Trophy case', vibe: 'Vibe check', moment: 'Your glow-iest day', finale: "That's a wrap",
};
const COLOR = { A: 'pink', B: 'cyan', C: 'purple', D: 'lime' };
const BG = {
  cover: ['A', 'C'], first: ['B', 'A'], count: ['A', 'B'], minutes: ['C', 'A'], squares: ['A', 'C'], top: [null, 'B'],
  rhythm: ['B', 'D'], bigWeek: ['A', 'C'], streak: ['orange', 'A'], bests: ['yellow', 'A'], trophies: ['C', 'B'],
  vibe: ['C', 'B'], moment: ['A', 'D'], finale: ['A', 'C'],
};
const FEEL_WORD = ['Rough', 'Meh', 'Okay', 'Good', 'Amazing'];
const BUCKET_PHRASE = { early: 'early morning', morning: 'morning', afternoon: 'afternoon', evening: 'evening', night: 'night' };
const PERSONA = {
  early: ['Up before the sun.', '{s}% of your workouts started before 8 AM.'],
  morning: ['Morning person, confirmed.', '{s}% happened before noon.'],
  afternoon: ['Afternoon power hour.', '{s}% between noon and 5 PM.'],
  evening: ['Golden-hour glow.', '{s}% between 5 and 9 PM.'],
  night: ['Night owl.', '{s}% after 9 PM. The moon has seen things.'],
};
const BUCKET_HOURS = { early: [4, 8], morning: [8, 12], afternoon: [12, 17], evening: [17, 21], night: [21, 28] };
const RECORD_NAME = { longestWorkout: 'Longest workout', bestWeek: 'Best week', bestMonth: 'Best month', dailyStreak: 'Daily streak', weeklyStreak: 'Weekly streak' };

const cvar = (name) => `var(--${COLOR[name] || name})`;
const fmt = (key, opts) => parseKey(key).toLocaleDateString(undefined, opts);
const monDay = (key) => fmt(key, { month: 'short', day: 'numeric' });
const longDay = (key) => fmt(key, { weekday: 'long', month: 'long', day: 'numeric' });
const monthName = (mk) => fmt(`${mk}-01`, { month: 'long' });
const dec1 = (x) => String(Math.round(x * 10) / 10);
const typeOf = (id) => store.typeById(id || '__unknown');
const plural = (n, one, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const an = (word) => (/^(8|11|18)/.test(word) || /^[aeiou]/i.test(word) ? 'An' : 'A');
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const recordUnit = (rec, v) => (rec === 'dailyStreak' ? (v === 1 ? 'day' : 'days') : rec === 'weeklyStreak' ? (v === 1 ? 'week' : 'weeks') : 'min');

/** A slide-local clock: timers and count-ups that stop while the story is paused. */
function makeClock() {
  let acc = 0;
  let base = performance.now();
  let paused = false;
  let stopped = false;
  let timer = 0;
  const jobs = [];
  const now = () => acc + (paused ? 0 : performance.now() - base);
  const pump = () => {
    clearTimeout(timer);
    if (paused || stopped) return;
    jobs.sort((a, b) => a.at - b.at);
    while (jobs.length && jobs[0].at <= now() + 1) {
      const job = jobs.shift();
      try { job.fn(); } catch (err) { console.error(err); }
      if (paused || stopped) return;
    }
    if (jobs.length) timer = setTimeout(pump, Math.max(0, jobs[0].at - now()));
  };
  return {
    now,
    get stopped() { return stopped; },
    at(ms, fn) { if (!stopped) { jobs.push({ at: ms, fn }); pump(); } },
    pause() { if (!paused) { acc = now(); paused = true; clearTimeout(timer); } },
    resume() { if (paused) { paused = false; base = performance.now(); pump(); } },
    stop() { stopped = true; jobs.length = 0; clearTimeout(timer); },
  };
}

// ---------------------------------------------------------------------------
// Markup helpers
// ---------------------------------------------------------------------------

const T = (ms) => `data-t style="--t:${ms}ms"`;
const kicker = (text, t = 80) => `<div class="rc-kicker" ${T(t)}>${esc(text)}</div>`;

/** A headline with a word-mask reveal. parts: strings, or { b } for an emphasized run. */
function headline(parts, { t = 200, cls = '' } = {}) {
  let i = 0;
  const plain = parts.map((p) => (typeof p === 'string' ? p : p.b)).join(' ');
  const words = parts.map((p) => {
    const em = typeof p !== 'string';
    return String(em ? p.b : p).split(/\s+/).filter(Boolean)
      .map((w) => `<span class="rc-w"><span${em ? ' class="rc-em"' : ''} style="--wi:${i++}">${esc(w)}</span></span>`).join(' ');
  }).join(' ');
  return `<h2 class="rc-h ${cls}" style="--t:${t}ms" tabindex="-1" data-focus aria-label="${esc(plain)}"><span aria-hidden="true">${words}</span></h2>`;
}

/** The giant gradient number; `data-count` makes it count up. */
function giant(value, { t = 200, unit = '', label = '', count = true, decimals = 0, from = 0, heading = false } = {}) {
  const final = decimals ? value.toFixed(decimals) : fmtNum(value);
  const tag = heading ? 'h2' : 'div';
  const shown = count && !prefersReducedMotion() ? (decimals ? from.toFixed(decimals) : fmtNum(from)) : final;
  return `<${tag} class="rc-giantwrap" ${T(t)}${heading ? ' tabindex="-1" data-focus' : ''} aria-label="${esc(`${final} ${label || unit}`.trim())}">
    <span class="rc-giant" aria-hidden="true"${count ? ` data-count="${value}" data-dec="${decimals}" data-from="${from}"` : ''}>${shown}</span>${unit ? `<span class="rc-unit" aria-hidden="true">${esc(unit)}</span>` : ''}
  </${tag}>`;
}

const chip = (html, t, cls = '') => `<span class="rc-chip ${cls}" ${T(t)}>${html}</span>`;
const ghost = (value) => `<div class="rc-ghost" aria-hidden="true">${esc(fmtNum(value))}</div>`;
const typeTile = (id, size = 120, cls = '') => {
  const t = typeOf(id);
  return `<span class="rc-tile ${cls}" style="--c:${cvar(t.color)};--sz:${size}px" aria-hidden="true">${icon(t.icon)}</span>`;
};
const crown = (cls = '') => `<span class="rc-crown ${cls}" aria-hidden="true">${icon('crown')}</span>`;

// ---------------------------------------------------------------------------
// Slides: each returns { html, run(ctx) }; run schedules on the slide clock
// ---------------------------------------------------------------------------

const BOW = `<svg class="rc-bow" viewBox="0 0 64 64" aria-hidden="true">
  <path d="M32 32 C18 14 4 18 8 30 C11 40 24 38 32 32Z" fill="var(--pink)"/>
  <path d="M32 32 C46 14 60 18 56 30 C53 40 40 38 32 32Z" fill="var(--purple)"/>
  <path d="M32 32 C26 42 22 52 18 58 L26 56 L32 34Z" fill="var(--pink)" opacity=".85"/>
  <path d="M32 32 C38 42 42 52 46 58 L38 56 L32 34Z" fill="var(--purple)" opacity=".85"/>
  <path d="M16 24 C20 21 26 25 30 30" stroke="#fff" stroke-opacity=".45" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M48 24 C44 21 38 25 34 30" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="7" fill="#fff"/><circle cx="32" cy="32" r="5.5" fill="var(--pink)"/>
</svg>`;

const S = {};

S.cover = (m, c) => {
  const kick = m.since ? 'YOUR FIRST CHAPTER' : m.soFar ? `${m.year} · SO FAR` : 'YOUR YEAR IN GLOW';
  const line = m.since ? `Since ${monDay(m.since)}, ${c.name}.` : m.soFar ? `The story so far, ${c.name}.` : `Ready, ${c.name}?`;
  const digits = [...m.year].map((d, i) => `<span class="rc-digit" style="--i:${i}">${d}</span>`).join('');
  return {
    html: `
      ${kicker(kick, 60)}
      <div class="rc-gift">
        <h2 class="rc-year" tabindex="-1" data-focus aria-label="Your ${m.year} in Glow"><span aria-hidden="true">${digits}</span></h2>
        ${c.rm ? '' : `<div class="rc-ribbons" aria-hidden="true"><i class="rc-band a"></i><i class="rc-band c"></i>${BOW}</div>`}
      </div>
      <p class="rc-line" ${T(760)}>${esc(line)}</p>
      <span class="rc-chip rc-unwrap" ${T(1150)}>${icon('gift')} Tap to unwrap</span>`,
    run(x) {
      [...m.year].forEach((_, i) => x.at(140 + i * 90, () => sound.introTick(i + 2)));
      x.at(1150, () => sound.chime(1));
    },
  };
};

S.first = (m, c) => {
  const f = m.first;
  const t = typeOf(f.typeId).label;
  let sub;
  if (m.since) sub = `One ${t}. You had no idea what was coming.`;
  else if (f.date.endsWith('-01-01')) sub = 'Day one of the year. Of course it was.';
  else {
    const what = f.min ? `${f.min}-min ${t}` : t;
    sub = `${an(what)} ${what}${f.bucket ? ` in the ${BUCKET_PHRASE[f.bucket]}` : ''}. Square one.`;
  }
  return {
    html: `
      ${kicker(m.since ? 'YOUR VERY FIRST GLOW' : 'DAY ONE')}
      <div class="rc-ignite" ${T(160)} aria-hidden="true"><i class="rc-ring"></i>${Array.from({ length: 8 }, (_, i) => `<b style="--r:${i * 45}deg"></b>`).join('')}<i class="rc-sq"></i></div>
      <p class="rc-pre" ${T(380)}>It all started on</p>
      ${headline([{ b: `${longDay(f.date)}.` }], { t: 520 })}
      <p class="rc-body" ${T(1250)}>${esc(sub)}</p>`,
    run(x) {
      x.at(900, () => { x.el.querySelector('.rc-ignite').classList.add('lit'); sound.chime(2); });
    },
  };
};

S.count = (m) => {
  const n = m.totals.n;
  const x1 = m.perWeek;
  const punch = x1 == null ? '' : x1 >= 4 ? `That's ${dec1(x1)} a week. Every. Single. Week.`
    : x1 >= 2 ? `About ${dec1(x1)} a week. A real habit.` : 'Every one of them counted.';
  // Rain: one square per workout (up to 365), colored by type share.
  const total = Math.min(n, 365);
  const pool = [];
  for (const r of m.topTypes || []) for (let k = 0; k < r.n; k++) pool.push(typeOf(r.typeId).color);
  while (pool.length < n) pool.push('text-3');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const rain = pool.slice(0, total).map((col, i) => `<i style="--c:var(--${col});--d:${Math.round((i / total) * 1300 + rnd() * 160)}ms"></i>`).join('');
  return {
    html: `
      ${ghost(n)}
      ${kicker('YOU SHOWED UP')}
      <div class="rc-countwrap">
        <div class="rc-rain" aria-hidden="true">${rain}</div>
        ${giant(n, { t: 160, unit: n === 1 ? 'workout' : 'workouts', heading: true })}
      </div>
      ${punch ? `<p class="rc-body" ${T(1700)}>${esc(punch)}</p>` : ''}
      <div class="rc-chips">
        ${chip(`${icon('calendar')}${esc(plural(m.totals.active, 'active day'))}`, 0, 'pop')}
        ${m.totals.types >= 2 ? chip(`${icon('sparkle')}${esc(plural(m.totals.types, 'workout type'))}`, 0, 'pop') : ''}
      </div>`,
    run(x) {
      x.count('.rc-giant', { ms: 1600, delay: 250 });
      x.at(250, () => sound.tickRoll(14, 1.6));
      x.at(1900, () => {
        sound.chime(3);
        x.el.querySelector('.rc-chips').classList.add('in');
        x.confettiFrom('.rc-giant', { count: 60 });
      });
    },
  };
};

S.minutes = (m, c) => {
  const min = m.totals.min;
  const hours = min >= 600;
  const value = hours ? Math.round(min / 60) : min;
  const compare = min < 600 ? `That's ${fmtNum(Math.round(min / 45))} episodes of your favorite show.`
    : min < 6000 ? `That's ${fmtNum(Math.round(min / 110))} movies' worth, credits included.`
      : `That's ${dec1(min / 1440)} full days of pure motion.`;
  const big = m.bigMonth;
  const max = Math.max(1, ...m.months.map((x) => x.min));
  const bars = m.months.map((x, i) => {
    const top = big && x.key === big.key;
    return `<div class="rc-mbar${top ? ' top' : ''}" style="--f:${Math.max(x.min ? 0.04 : 0.02, x.min / max).toFixed(3)};--i:${i}">
      <i>${top ? crown() : ''}</i><span>${esc(fmt(`${x.key}-01`, { month: 'narrow' }))}</span></div>`;
  }).join('');
  let dist = '';
  const km = m.totals.km;
  if (km > 0) {
    const extra = km >= 42.195 ? ` · ${dec1(km / 42.195)} marathons` : km >= 5 ? ` · ${dec1(km / 5)} 5Ks` : '';
    dist = chip(`${icon('route')}${esc(`${fmtDistance(km, c.units)} covered${extra}`)}`, 1500);
  }
  return {
    html: `
      ${ghost(value)}
      ${kicker('TIME FOR YOU')}
      ${giant(value, { t: 160, unit: hours ? 'hours' : 'minutes', heading: true })}
      <p class="rc-body" ${T(700)}>${esc(compare)}</p>
      <div class="rc-months" ${T(300)} aria-hidden="true">${bars}</div>
      ${big ? `<p class="rc-small" ${T(1100)}>Biggest month: <b>${esc(monthName(big.key))}</b> · ${fmtNum(big.min)} min</p>` : ''}
      ${dist}`,
    run(x) {
      x.count('.rc-giant', { ms: 1100, delay: 200 });
      x.at(200, () => sound.tickRoll(10, 1.1));
      x.at(900, () => { x.el.querySelector('.rc-months').classList.add('crowned'); sound.coin(); });
    },
  };
};

S.squares = (m) => {
  const y0 = `${m.year}-01-01`;
  const since = m.since;
  const bright = m.brightMonth;
  const months = (m.quilt || []).map((g, i) => {
    const dim = since && g.key < since.slice(0, 7);
    let svg = miniMonthSVG(g, { cell: 10, gap: 2, delay: (cell) => Math.max(0, daysBetween(y0, cell.key)) * 4 });
    if (since) svg = svg.replace(`data-k="${since}"`, `data-k="${since}" data-one="1"`);
    return `<div class="rc-mini${dim ? ' dim' : ''}${bright && g.key === bright.key ? ' bright' : ''}" style="--i:${i}">
      <span>${esc(fmt(`${g.key}-01`, { month: 'short' }))}</span>${svg}</div>`;
  }).join('');
  const rest = m.totals.rest;
  return {
    html: `
      ${kicker('YOUR YEAR IN SQUARES')}
      ${headline([{ b: fmtNum(m.totals.active) }, `${m.totals.active === 1 ? 'day' : 'days'} you glowed.`], { t: 180 })}
      <p class="rc-body" ${T(620)}>${esc(rest > 0 ? `Plus ${plural(rest, 'rest day')} you earned.` : 'Every square is a day you showed up for yourself.')}</p>
      <div class="rc-quilt" ${T(300)} aria-hidden="true">${months}</div>
      ${since ? `<p class="rc-pin" ${T(900)}><i></i>Day one: ${esc(monDay(since))}</p>` : ''}
      ${bright ? chip(`${icon('sparkle')}${esc(`Brightest month: ${monthName(bright.key)} · ${plural(bright.active, 'active day')}`)}`, 1700) : ''}`,
    run(x) {
      for (let k = 0; k < 10; k++) x.at(300 + k * 140, () => sound.introTick(k));
      x.at(1600, () => x.el.querySelector('.rc-quilt').classList.add('pulse'));
    },
  };
};

S.top = (m) => {
  const rows = m.topTypes || [];
  const top = rows[0];
  const t = typeOf(top.typeId);
  const one = rows.length === 1;
  const sparks = Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg">${icon(t.icon)}</i>`).join('');
  const list = rows.slice(1, 5).map((r, i) => `
    <div class="rc-row" style="--i:${i};--w:${Math.round((r.n / top.n) * 100)}%;--c:${cvar(typeOf(r.typeId).color)}">
      <b>#${i + 2}</b>${typeTile(r.typeId, 30)}<span>${esc(typeOf(r.typeId).label)}</span><em>${fmtNum(r.n)}</em></div>`).join('');
  return {
    bg: [t.color, 'B'],
    html: `
      ${kicker(one ? 'ALL IN' : 'YOUR #1')}
      <div class="rc-hero" style="--c:${cvar(t.color)}" aria-hidden="true">${typeTile(top.typeId, 120, 'flip')}<div class="rc-sparks">${sparks}</div></div>
      ${one ? headline([`All in on ${t.label}.`], { t: 520 }) : headline([{ b: t.label }], { t: 520 })}
      <p class="rc-body" ${T(900)}>${esc(one ? `100% ${t.label}. 0% doubt.` : `${plural(top.n, 'workout')} · ${Math.round(top.share * 100)}% of your year`)}</p>
      ${list ? `<div class="rc-rows">${list}</div>` : ''}`,
    run(x) {
      x.at(250, () => { sound.whoosh(); x.el.querySelector('.rc-hero').classList.add('burst'); });
      x.at(820, () => sound.chime(2));
      rows.slice(1, 5).forEach((_, i) => x.at(1200 + i * 120, () => sound.introTick(i + 4)));
    },
  };
};

/** One wedge of the 24-hour clock, as a path. */
function wedge(h, len, r0 = 30) {
  const a0 = ((h * 15 - 90 + 1.2) * Math.PI) / 180;
  const a1 = (((h + 1) * 15 - 90 - 1.2) * Math.PI) / 180;
  const r1 = r0 + len;
  const p = (r, a) => `${(80 + r * Math.cos(a)).toFixed(2)} ${(80 + r * Math.sin(a)).toFixed(2)}`;
  return `M${p(r0, a0)} L${p(r1, a0)} A${r1} ${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

S.rhythm = (m) => {
  const tod = m.timeOfDay;
  const wd = m.weekday;
  const dayName = (dow) => new Date(2026, 1, 1 + dow).toLocaleDateString(undefined, { weekday: 'long' });
  let clock = '';
  if (tod) {
    const max = Math.max(1, ...tod.hours);
    const [lo, hi] = BUCKET_HOURS[tod.bucket];
    const fav = (h) => (h >= lo && h < hi) || (h + 24 >= lo && h + 24 < hi);
    const paths = tod.hours.map((v, h) => `<path class="${fav(h) ? 'fav' : ''}${v ? '' : ' none'}" style="--i:${h}" d="${wedge(h, v ? 6 + (v / max) * 44 : 3)}"/>`).join('');
    const night = tod.bucket === 'evening' || tod.bucket === 'night';
    clock = `<div class="rc-clock" ${T(160)} aria-hidden="true">
      <svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="55" class="track"/><circle cx="80" cy="80" r="24" class="dial"/>${paths}
        <text x="80" y="8" class="tick">12a</text><text x="155" y="83" class="tick">6a</text><text x="80" y="158" class="tick">12p</text><text x="5" y="83" class="tick">6p</text></svg>
      <span class="rc-orb${night ? ' moon' : ''}">${icon(night ? 'moon' : 'sun')}</span></div>`;
  }
  // Clock ticks: 0h at the top, 6h on the right (6 AM), 12h at the bottom, 18h on the left.
  const [h1, sub] = tod ? PERSONA[tod.bucket] : ['Your power day.', ''];
  let power = '';
  if (wd?.show && wd.top) {
    const name = `${dayName(wd.best)}s`;
    const lead = tod ? 'And your power day? ' : '';
    power = wd.tie
      ? `${lead}<b>${esc(name)}</b> and <b>${esc(`${dayName(wd.second)}s`)}</b>, neck and neck.`
      : `${lead}<b>${esc(name)}.</b> You showed up ${fmtNum(wd.top.active)} of ${fmtNum(wd.top.occ)}.`;
  }
  const caps = wd?.show ? `<div class="rc-caps" ${T(tod ? 900 : 300)} aria-hidden="true">${wd.days.map((d, i) => `
    <div class="rc-cap${d.dow === wd.best ? ' win' : ''}" style="--f:${Math.max(0.06, d.frac || 0).toFixed(3)};--i:${i}">
      <i>${d.dow === wd.best ? crown() : ''}</i><span>${esc(new Date(2026, 1, 1 + d.dow).toLocaleDateString(undefined, { weekday: 'narrow' }))}</span></div>`).join('')}</div>` : '';
  return {
    html: `
      ${kicker('YOUR RHYTHM')}
      ${clock}
      ${headline([h1], { t: tod ? 420 : 200 })}
      ${sub ? `<p class="rc-body" ${T(760)}>${esc(sub.replace('{s}', Math.round(tod.share * 100)))}</p>` : ''}
      ${caps}
      ${power ? `<p class="rc-small" ${T(tod ? 1300 : 900)}>${power}</p>` : ''}`,
    run(x) {
      if (tod) x.at(1000, () => sound.chime(2));
      if (caps) x.at(1800, () => { x.el.querySelector('.rc-caps').classList.add('crowned'); sound.coin(); });
    },
  };
};

S.bigWeek = (m) => {
  const bw = m.bigWeek;
  const pool = ['You were unstoppable.', 'Whatever got into you that week: more of that.', 'Main-character week.'];
  const max = Math.max(1, ...m.weeks.map((w) => w.min));
  const bars = m.weeks.map((w, i) => `<i class="${w.key === bw.key ? 'top' : ''}" style="--f:${Math.max(w.min ? 0.06 : 0.02, w.min / max).toFixed(3)};--i:${i}">${w.key === bw.key ? crown() : ''}</i>`).join('');
  return {
    html: `
      ${kicker('YOUR BIGGEST WEEK')}
      ${headline([fmtWeekRange(parseKey(bw.key))], { t: 180 })}
      ${giant(bw.min, { t: 420, unit: 'min' })}
      <div class="rc-weeks" ${T(200)} aria-hidden="true">${bars}</div>
      <p class="rc-body" ${T(1400)}>${esc(`${plural(bw.n, 'workout')} in 7 days. ${pickLine(`recap:${m.year}:bigWeek`, pool)}`)}</p>
      ${bw.allTime ? chip(`${icon('trophy')}Best week ever`, 1700, 'gold') : ''}`,
    run(x) {
      x.count('.rc-giant', { ms: 900, delay: 420 });
      x.at(1200, () => { x.el.querySelector('.rc-weeks').classList.add('crowned'); sound.coin(); haptic('tick'); });
    },
  };
};

S.streak = (m) => {
  const { weekly, daily } = m.streaks;
  const weeks = weekly.value >= 2;
  const v = weeks ? weekly.value : daily.value;
  const from = weeks ? weekly.from : daily.from;
  const to = weeks ? addDaysKey(weekly.to, 6) : daily.to;
  const end = to > m.through ? m.through : to;
  const pills = Array.from({ length: Math.min(v, 26) }, (_, i) => `<i style="--i:${i}"></i>`).join('');
  const chips = [];
  if (weeks && daily.value >= 3) chips.push(chip(`${icon('sun')}and ${esc(plural(daily.value, 'day'))} in a row`, 1500));
  if (weeks && weekly.frozen > 0) chips.push(chip(`${icon('snowflake')}${esc(`${weekly.frozen} ${weekly.frozen === 1 ? 'freeze' : 'freezes'} saved it`)}`, 1650, 'ice'));
  const scale = 1 + Math.min(v, 26) / 26 * 0.7;
  return {
    bg: ['orange', 'A'],
    html: `
      ${ghost(v)}
      ${kicker('ON A ROLL')}
      <div class="rc-flame" data-t style="--t:120ms;--k:${scale.toFixed(2)}" aria-hidden="true">${icon('flame')}</div>
      ${giant(v, { t: 200, unit: weeks ? (v === 1 ? 'week in a row' : 'weeks in a row') : 'days in a row', heading: true })}
      <div class="rc-pills${weeks ? '' : ' days'}" aria-hidden="true">${pills}</div>
      <p class="rc-body" ${T(1100)}>${esc(`${monDay(from)} – ${monDay(end)}. You didn't break the chain.`)}</p>
      ${chips.length ? `<div class="rc-chips in">${chips.join('')}</div>` : ''}`,
    run(x) {
      x.count('.rc-giant', { ms: 900, delay: 200 });
      x.at(300, () => x.el.querySelector('.rc-pills').classList.add('lit'));
      for (let i = 0; i < Math.min(v, 26, 12); i++) x.at(300 + i * 60, () => sound.introTick(i));
    },
  };
};

S.bests = (m) => {
  const L = m.bests.longest;
  const prs = m.prs || [];
  const rows = prs.map((p, i) => {
    const gain = p.prev > 0 ? p.value - p.prev : 0;
    return `<div class="rc-pr" style="--i:${i + 1}"><span class="rc-trophy">${icon('trophy')}</span>
      <span>${esc(RECORD_NAME[p.record] || 'Record')} · ${fmtNum(p.value)} ${recordUnit(p.record, p.value)}</span>${gain > 0 ? `<em>+${fmtNum(gain)}</em>` : ''}</div>`;
  }).join('');
  const month = m.bests.month;
  return {
    html: `
      ${kicker('PERSONAL BESTS')}
      <div class="rc-best" data-t style="--t:160ms">
        <span class="rc-trophy big">${icon('trophy')}</span>
        <div class="rc-best-text">
          <span class="rc-label">LONGEST WORKOUT${L.allTime ? ' <span class="rc-tag">ALL-TIME</span>' : ''}</span>
          <h2 class="rc-bestnum" tabindex="-1" data-focus aria-label="${fmtNum(L.value)} minutes"><b data-count="${L.value}" aria-hidden="true">${prefersReducedMotion() ? fmtNum(L.value) : '0'}</b> <small aria-hidden="true">min</small></h2>
          <span class="rc-small">${esc(`${typeOf(L.typeId).label} · ${monDay(L.date)}`)}</span>
        </div>
      </div>
      ${m.prCount >= 1
        ? `<p class="rc-body" ${T(700)}>You set <b>${fmtNum(m.prCount)}</b> personal ${m.prCount === 1 ? 'record' : 'records'} this year.</p><div class="rc-prs">${rows}</div>`
        : month ? `<p class="rc-body" ${T(700)}>Best month: <b>${esc(monthName(month.key))}</b> · ${fmtNum(month.min)} min</p>` : ''}`,
    run(x) {
      x.count('.rc-bestnum b', { ms: 700, delay: 300 });
      x.at(300, () => sound.coin());
      prs.forEach((_, i) => x.at(1000 + i * 260, () => sound.coin()));
    },
  };
};

S.trophies = (m) => {
  const badges = (m.badges || []).filter((b) => BADGE_BY_ID.has(b.id));
  const g = m.goals || { weekly: 0, monthly: 0, long: [], total: 0 };
  const unlocks = (m.unlocks || []).map((u) => unlockInfo(u.id)).filter((u) => u.id !== 'glow' && u.id !== 'classic');
  let head;
  if (badges.length) head = [{ b: fmtNum(badges.length) }, `new ${badges.length === 1 ? 'badge' : 'badges'} in ${m.year}.`];
  else if (g.total) head = [{ b: fmtNum(g.total) }, `${g.total === 1 ? 'goal' : 'goals'} crushed in ${m.year}.`];
  else head = ['New looks unlocked.'];
  const lines = [];
  const wins = [g.weekly && plural(g.weekly, 'winning week'), g.monthly && plural(g.monthly, 'winning month'), g.long?.length && plural(g.long.length, 'long-term goal')].filter(Boolean);
  if (wins.length) lines.push(`<p class="rc-small" ${T(700)}>${esc(wins.join(' · '))}</p>`);
  const rarest = badges[0] ? BADGE_BY_ID.get(badges[0].id) : null;
  if (rarest) {
    lines.push(`<p class="rc-small" ${T(820)}>Rarest: <b class="rc-rar r-${rarest.rarity}" style="--c:${cvar(RARITY_COLOR[rarest.rarity])}">${esc(`${rarest.name} · ${RARITY_LABEL[rarest.rarity]}`)}</b></p>`);
  }
  if (unlocks.length) {
    const orbs = unlocks.slice(0, 4).map((u) => (u.type === 'palette' ? paletteOrbHTML(u.id, { size: 28, theme: 'dark' }) : holdMiniHTML(u.id, { size: 30 }))).join('');
    const names = unlocks.map((u) => u.name);
    const list = names.length > 3 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(', ');
    lines.push(`<p class="rc-small rc-unlocks" ${T(940)}><span class="rc-orbs">${orbs}</span><span>Unlocked: ${esc(list)}</span></p>`);
  }
  const shown = badges.slice(0, badges.length > 12 ? 11 : 12);
  const grid = shown.map((b, i) => `<span class="rc-badge" style="--i:${i}">${badgeSVG(b.id, { size: 56, className: 'no-glow' })}</span>`).join('')
    + (badges.length > 12 ? `<span class="rc-badge more" style="--i:11">+${badges.length - 11}</span>` : '');
  return {
    html: `
      ${kicker('TROPHY CASE')}
      ${rarest ? `<div class="rc-rarest" ${T(150)} aria-hidden="true"><div class="rc-rays"></div>${badgeSVG(rarest, { size: 96 })}</div>` : ''}
      ${headline(head, { t: 360 })}
      ${lines.join('')}
      ${grid ? `<div class="rc-badges" aria-hidden="true">${grid}</div>` : ''}`,
    run(x) {
      const n = shown.length;
      if (n) {
        x.at(1100, () => sound.bell());
        if (n > 1) x.at(1100 + (n - 1) * 90 + 200, () => sound.bell(0));
      } else x.at(500, () => sound.shimmer());
    },
  };
};

S.vibe = (m) => {
  const f = m.feel;
  const avg = Math.round(f.avg * 10) / 10;
  const head = f.avg >= 4.3 ? 'Mostly amazing.' : f.avg >= 3.6 ? 'Feeling good.' : f.avg >= 2.8 ? 'Honest work.' : 'Tough ones count double.';
  const max = Math.max(1, ...f.dist);
  const bars = f.dist.map((v, i) => `<div class="rc-vbar${i === 4 ? ' hi' : ''}" style="--f:${Math.max(v ? 0.06 : 0.02, v / max).toFixed(3)};--i:${i}"><i></i><span>${FEEL_WORD[i]}</span></div>`).join('');
  const lines = [f.amazing ? `${plural(f.amazing, 'workout')} felt Amazing.` : `Across ${plural(f.n, 'rated workout')}.`];
  if (f.topMood) lines.push(`${f.topMood.emoji} was your go-to mood.`);
  if (f.bestType) {
    lines.push(`${typeOf(f.bestType).label} made you feel best${f.bestAvg ? ` (${dec1(f.bestAvg)})` : ''}.`);
  }
  return {
    html: `
      ${kicker('VIBE CHECK')}
      ${f.topMood ? `<div class="rc-emoji" aria-hidden="true">${esc(f.topMood.emoji)}</div>` : ''}
      ${headline([head], { t: 220 })}
      ${giant(avg, { t: 400, unit: '/ 5', decimals: 1, from: 1, label: 'out of 5' })}
      <div class="rc-vbars" ${T(500)} aria-hidden="true">${bars}</div>
      ${lines.map((l, i) => `<p class="rc-small" ${T(1200 + i * 140)}>${esc(l)}</p>`).join('')}`,
    run(x) {
      x.count('.rc-giant', { ms: 1000, delay: 400 });
      if (f.topMood) x.at(150, () => sound.chime(2));
    },
  };
};

S.moment = (m, c) => {
  const mo = m.moment;
  const photo = c.photo;
  const t = typeOf(mo.typeId).label;
  const facts = [mo.min ? `${mo.min} min ${t}` : t, mo.feel ? `felt ${FEEL_WORD[mo.feel - 1]}` : ''].filter(Boolean).join(' · ');
  const visual = photo
    ? `<figure class="rc-polaroid" aria-hidden="true"><i class="tape l"></i><i class="tape r"></i><img src="${esc(photo)}" alt=""><span class="sweep"></span></figure>`
    : `<div class="rc-hero" style="--c:${cvar(typeOf(mo.typeId).color)}" aria-hidden="true">${typeTile(mo.typeId, 150, 'glowy')}</div>`;
  return {
    html: `
      ${kicker(mo.reason === 'photo' ? 'A MOMENT WORTH KEEPING' : 'YOUR GLOW-IEST DAY')}
      <div class="rc-moment${photo ? ' has-photo' : ''}" ${T(120)}>${visual}${mo.mood ? `<span class="rc-mood" aria-hidden="true">${esc(mo.mood)}</span>` : ''}</div>
      ${headline([{ b: longDay(mo.date) }], { t: 700 })}
      <p class="rc-body" ${T(1000)}>${esc(facts)}</p>
      ${mo.note ? `<p class="rc-note" ${T(1200)}>“${esc(mo.note)}”</p>` : ''}
      <p class="rc-small" ${T(1450)}>${esc(`Remember this one, ${c.name}?`)}</p>`,
    run(x) {
      x.at(200, () => sound.whoosh());
      x.at(820, () => sound.chime(2));
    },
  };
};

/** The year strip as a small SVG (finale poster). */
function stripSVG(strip, { pitch = 5, cell = 4 } = {}) {
  const cols = strip?.cols || [];
  const rects = [];
  cols.forEach((col, x) => col.levels.forEach((lv, y) => {
    if (lv < 0 && lv !== -2) return;
    rects.push(`<rect class="hl${lv < 0 ? '0 hlf' : lv}" x="${x * pitch}" y="${y * pitch}" width="${cell}" height="${cell}" rx="1" style="--d:${x * 14}ms"/>`);
  }));
  const w = cols.length * pitch - (pitch - cell);
  return `<svg class="rc-strip" viewBox="0 0 ${w} ${7 * pitch - (pitch - cell)}" aria-hidden="true">${rects.join('')}</svg>`;
}

S.finale = (m, c) => {
  const pool = m.soFar ? [`And ${m.year} isn't over yet.`] : ['What a year, {name}!', "That's a wrap, {name}.", '{Y}, you were glowing.'];
  const head = pickLine(`recap:${m.year}:finale`, pool, { name: c.name, Y: m.year });
  const min = m.totals.min;
  const top = m.topTypes?.[0];
  const tt = top ? typeOf(top.typeId) : null;
  const { weekly: sw, daily: sd } = m.streaks;
  const streak = sw.value >= 2 ? [fmtNum(sw.value), 'Wk streak'] : sd.value >= 2 ? [fmtNum(sd.value), 'Day streak'] : ['—', 'Best streak'];
  const tiles = [
    ['A', fmtNum(m.totals.n), m.totals.n === 1 ? 'Workout' : 'Workouts'],
    ['C', min >= 60 ? fmtNum(Math.round(min / 60)) : fmtNum(min), min >= 60 ? (Math.round(min / 60) === 1 ? 'Hour' : 'Hours') : 'Minutes'],
    ['B', fmtNum(m.totals.active), 'Active days'],
    [tt ? tt.color : 'A', tt ? esc(tt.label) : '—', 'Top type'],
    ['orange', ...streak],
    ['yellow', fmtNum((m.badges || []).length), 'Badges'],
  ].map(([col, v, l], i) => `<div class="rc-ftile" style="--c:${cvar(col)};--i:${i}"><b>${v}</b><span>${l}</span></div>`).join('');
  const line = m.soFar ? `${plural(m.daysLeft, 'more day')} to glow.` : `Here's to an even brighter ${Number(m.year) + 1}.`;
  return {
    html: `
      ${kicker("THAT'S A WRAP")}
      ${headline([head], { t: 160 })}
      <div class="rc-poster">
        <div class="rc-pyear">${esc(m.year)}</div>
        ${stripSVG(m.strip)}
        <div class="rc-ftiles">${tiles}</div>
      </div>
      <p class="rc-small" ${T(900)}>${esc(line)}</p>
      <div class="rc-actions" ${T(1100)}>
        <button type="button" class="btn btn-primary" data-act="share">${icon('share')}<span>Share my year</span></button>
        <div class="rc-actrow">
          <button type="button" class="btn btn-secondary" data-act="again">${icon('play')}<span>Watch again</span></button>
          <button type="button" class="btn btn-ghost" data-act="done">Done</button>
        </div>
      </div>`,
    run(x) {
      sound.chord();
      x.at(200, () => {
        const H = innerHeight;
        const W = innerWidth;
        confetti({ x: 0, y: H * 0.9, angle: 62, spread: 26, power: 24, count: 90, celebration: true });
        confetti({ x: W, y: H * 0.9, angle: 118, spread: 26, power: 24, count: 90, celebration: true });
      });
      if (!c.rm && !c.calm) {
        const show = x.fireworks();
        const sky = skyColors();
        [[300, 0.24, sky.A], [650, 0.76, sky.C], [1000, 0.5, sky.B]].forEach(([t, fx, col]) => x.at(t, () => {
          show.burst('peony', innerWidth * fx, innerHeight * (t === 1000 ? 0.16 : 0.22), { colors: [col, WHITE], scale: 0.8 });
        }));
      }
    },
  };
};

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

let active = null;

/** Mark the year watched in meta.recapSeen (read defensively; never for samples). */
function markWatched(Y) {
  const raw = store.meta?.recapSeen;
  const seen = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (/^\d{4}$/.test(k) && (v === 'watched' || v === 'dismissed')) seen[k] = v;
  }
  if (seen[Y] === 'watched') return;
  store.updateMeta({ recapSeen: { ...seen, [Y]: 'watched' } });
}

/** Load the moment's own photo (never another day's, which would mislabel it). */
async function prefetchPhoto(m) {
  const ids = [m.moment?.photoId].filter(Boolean);
  for (const id of ids.slice(0, 6)) {
    try {
      const url = await photos.get(id);
      if (!url) continue;
      const img = new Image();
      img.src = url;
      await img.decode();
      return url;
    } catch { /* missing photo or IndexedDB blocked: try the next */ }
  }
  return null;
}

/**
 * Play "Your Year in Glow" for a year.
 * @param {string|number} year
 * @param {object} [o]
 * @param {object} [o.model]  a yearRecap() model (default: store.recap(year))
 * @param {boolean} [o.sample]  lab sample: nothing is written, sharing uses the model as a snapshot
 * @returns {{ close: () => void } | null}
 */
export function openRecap(year, { model = null, sample = false } = {}) {
  const Y = String(year);
  if (active) return active;
  let m = model;
  if (!m) {
    try { m = typeof store.recap === 'function' ? store.recap(Y) : null; } catch (err) { console.error(err); m = null; }
  }
  if (!m || !m.totals?.n) {
    toast(`No workouts in ${Y} yet`);
    return null;
  }
  unlockAudio();
  active = play(m, { sample });
  return active;
}

function play(m, { sample }) {
  const rm = prefersReducedMotion();
  const calm = isCalm();
  const name = String(store.settings.name || '').trim() || 'friend';
  const ids = (Array.isArray(m.slides) && m.slides.length ? m.slides : ['cover', 'first', 'count', 'squares', 'finale'])
    .filter((id) => S[id] && ORDER.includes(id));
  if (ids[0] !== 'cover') ids.unshift('cover');
  if (ids[ids.length - 1] !== 'finale') ids.push('finale');
  const ctx = { name, rm, calm, units: store.settings.units, photo: null };
  let photoReady = prefetchPhoto(m).then((url) => { ctx.photo = url; });

  const prevFocus = document.activeElement;
  const app = document.getElementById('app');
  const tabbar = document.querySelector('.tabbar');
  const layer = document.createElement('div');
  layer.className = `recap-layer${rm ? ' rm' : ''}${calm ? ' calm' : ''}`;
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-roledescription', 'story');
  layer.setAttribute('aria-label', `Your ${m.year} in Glow`);
  layer.setAttribute('style', paletteStyle(currentLook().palette, 'dark'));
  layer.innerHTML = `
    <div class="rc-bg on"></div><div class="rc-bg"></div><div class="rc-grain" aria-hidden="true"></div>
    <div class="rc-stage"></div>
    <div class="rc-chrome">
      <div class="rc-progress" aria-hidden="true">${ids.map(() => '<span class="rc-seg"><i></i></span>').join('')}</div>
      <div class="rc-btns">
        <button type="button" class="icon-btn rc-pause" data-act="pause" aria-label="Pause">${icon('pause')}</button>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">${icon('close')}</button>
      </div>
    </div>
    <span class="rc-continue" aria-hidden="true">Tap to continue</span>
    <button type="button" class="rc-sr" data-act="prev">Previous slide</button>
    <button type="button" class="rc-sr" data-act="next">Next slide</button>`;
  document.body.appendChild(layer);
  document.body.classList.add('recap-open');
  if (app) app.inert = true;
  if (tabbar) tabbar.inert = true;

  const stage = layer.querySelector('.rc-stage');
  const segs = [...layer.querySelectorAll('.rc-seg')];
  const bgs = [...layer.querySelectorAll('.rc-bg')];
  let idx = -1;
  let cur = null; // { el, clock, show }
  let front = 0;
  let closed = false;
  let unwrapping = false;
  let stickyPause = false;
  let held = false;
  let hiddenPause = false;
  let watched = false;

  const paused = () => stickyPause || held || hiddenPause;
  const applyPause = () => {
    const p = paused();
    layer.classList.toggle('rc-paused', p);
    if (cur) (p ? cur.clock.pause() : cur.clock.resume());
    const btn = layer.querySelector('.rc-pause');
    btn.innerHTML = icon(stickyPause ? 'play' : 'pause');
    btn.setAttribute('aria-label', stickyPause ? 'Play' : 'Pause');
  };

  const setBg = (pair) => {
    const back = bgs[1 - front];
    back.style.setProperty('--s1', cvar(pair[0]));
    back.style.setProperty('--s2', cvar(pair[1]));
    back.classList.add('on');
    bgs[front].classList.remove('on');
    front = 1 - front;
  };

  function slideCtx(el, clock) {
    const x = {
      el,
      at: (ms, fn) => clock.at(rm ? Math.min(ms, 150) : ms, fn),
      /** Count an element's number up on the slide clock (final value under reduced motion). */
      count(sel, { ms = 1100, delay = 0 } = {}) {
        const node = el.querySelector(sel);
        if (!node) return;
        const to = Number(node.dataset.count);
        const dec = Number(node.dataset.dec) || 0;
        const from = Number(node.dataset.from) || 0;
        const show = (v) => { node.textContent = dec ? v.toFixed(dec) : fmtNum(v); };
        if (rm) { show(to); return; }
        show(from);
        clock.at(delay, () => {
          const tick = () => {
            if (clock.stopped) return;
            const k = Math.min(1, Math.max(0, (clock.now() - delay) / ms));
            show(from + (to - from) * easeOut(k));
            if (k < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      confettiFrom(sel, { count = 60 } = {}) {
        const r = el.querySelector(sel)?.getBoundingClientRect();
        if (r) confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count, spread: 110, power: 11, celebration: true });
      },
      fireworks() {
        if (!cur.show) {
          cur.show = createShow({ parent: layer, level: 2, blend: 'lighter' });
          layer.querySelector('.rc-grain').after(cur.show.canvas);
        }
        return cur.show;
      },
    };
    return x;
  }

  function go(i, { manual = false } = {}) {
    if (closed || i < 0 || i >= ids.length || i === idx) return;
    const id = ids[i];
    if (id === 'moment' && !ctx.photo && photoReady) {
      // The photo is usually decoded long before; wait briefly if it isn't.
      const p = photoReady;
      const from = idx;
      photoReady = null;
      Promise.race([p, new Promise((r) => setTimeout(r, 600))]).then(() => { if (idx === from) go(i, { manual }); });
      return;
    }
    const old = cur;
    if (old) {
      old.clock.stop();
      old.show?.stop(250);
      old.el.classList.remove('is-in');
      old.el.classList.add('is-out');
      old.el.setAttribute('aria-hidden', 'true');
      setTimeout(() => old.el.remove(), 230);
    }
    idx = i;
    unwrapping = false;
    if (manual) stickyPause = false;
    const s = S[id](m, ctx);
    const el = document.createElement('section');
    el.className = `rc-slide s-${id}`;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-roledescription', 'slide');
    el.setAttribute('aria-label', `${i + 1} of ${ids.length}: ${LABEL[id]}`);
    const pair = (s.bg || BG[id]).map((x) => x || 'A');
    el.style.setProperty('--s1', cvar(pair[0]));
    el.style.setProperty('--s2', cvar(pair[1]));
    el.innerHTML = `<div class="rc-content">${s.html}</div>`;
    stage.appendChild(el);
    const clock = makeClock();
    cur = { el, clock, show: null };
    setBg(pair);
    el.classList.add('is-in');
    layer.classList.toggle('on-finale', id === 'finale');
    layer.classList.toggle('on-cover', id === 'cover');

    // Progress: past segments full, this one filling (instant when manual or reduced motion).
    const auto = !rm && DUR[id];
    segs.forEach((seg, j) => {
      seg.classList.toggle('done', j < i);
      seg.classList.remove('on', 'manual');
    });
    void segs[i].offsetWidth;
    segs[i].style.setProperty('--dur', `${DUR[id] || 0}ms`);
    segs[i].classList.add('on');
    if (!auto) segs[i].classList.add('manual');

    sound.introTick(i);
    if (manual) {
      haptic('tick');
      el.querySelector('[data-focus]')?.focus({ preventScroll: true });
    }
    if (i >= 1 && !watched && !sample) {
      watched = true;
      try { markWatched(m.year); } catch (err) { console.error(err); }
    }
    try { s.run(slideCtx(el, clock)); } catch (err) { console.error(err); }
    applyPause();
  }

  function unwrap() {
    if (unwrapping) return;
    unwrapping = true;
    unlockAudio();
    if (rm) { go(1, { manual: true }); return; }
    const el = cur.el;
    el.classList.add('unwrapped');
    const r = el.querySelector('.rc-year').getBoundingClientRect();
    confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 80, spread: 140, power: 12, celebration: true });
    sound.whoosh();
    sound.chime(3);
    haptic('success');
    cur.clock.at(cur.clock.now() + 700, () => go(1, { manual: true }));
  }

  const next = (o = {}) => {
    const id = ids[idx];
    if (id === 'cover') unwrap();
    else if (id !== 'finale') go(idx + 1, o);
  };
  const prev = (o = {}) => { if (idx > 0) go(idx - 1, o); };

  function close() {
    if (closed) return;
    closed = true;
    cur?.clock.stop();
    cur?.show?.stop(200);
    unKeys();
    unsub();
    document.removeEventListener('visibilitychange', onVis);
    layer.classList.add('out');
    if (app) app.inert = false;
    if (tabbar) tabbar.inert = false;
    document.body.classList.remove('recap-open');
    active = null;
    setTimeout(() => {
      layer.remove();
      if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
    }, rm ? 0 : 280);
  }

  // A sheet (the share sheet) above the story owns the keyboard while it's open.
  const sheetOpen = () => !!document.querySelector('.sheet-layer');
  const unKeys = modalKeys(layer, () => { if (!sheetOpen()) close(); });
  const onKey = (e) => {
    if (closed || sheetOpen()) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); next({ manual: true }); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev({ manual: true }); }
    else if (e.key === ' ' && !e.target.closest?.('button')) {
      e.preventDefault();
      if (ids[idx] === 'cover') unwrap();
      else { stickyPause = !stickyPause; applyPause(); }
    }
  };
  layer.addEventListener('keydown', onKey);

  const onVis = () => {
    if (document.visibilityState === 'hidden') hiddenPause = true;
    else hiddenPause = false;
    applyPause();
  };
  document.addEventListener('visibilitychange', onVis);
  const unsub = store.subscribe((reason) => { if (reason === 'replace') close(); });

  // Buttons
  layer.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'close' || act === 'done') close();
    else if (act === 'pause') { stickyPause = !stickyPause; applyPause(); }
    else if (act === 'next') next({ manual: true });
    else if (act === 'prev') prev({ manual: true });
    else if (act === 'again') go(1, { manual: true });
    else if (act === 'share') {
      openShare(sample ? { kind: 'recap', year: m.year, snapshot: m } : { kind: 'recap', year: m.year }, { zIndex: 970 });
    }
  });

  // Gestures: tap zones, hold to pause, horizontal swipes, swipe down to close.
  let ptr = null;
  const endHold = () => { if (held) { held = false; layer.classList.remove('rc-holding'); applyPause(); } };
  layer.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.button !== undefined && e.button > 0)) return;
    if (e.target.closest('button, a, input, .rc-btns')) return;
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: 0 };
    ptr.timer = setTimeout(() => {
      if (!ptr || ids[idx] === 'cover' || ids[idx] === 'finale') return;
      held = true;
      layer.classList.add('rc-holding');
      applyPause();
    }, 200);
  });
  layer.addEventListener('pointermove', (e) => {
    if (ptr && e.pointerId === ptr.id && !held && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) > 12) clearTimeout(ptr.timer);
  });
  layer.addEventListener('pointerup', (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = ptr;
    ptr = null;
    clearTimeout(p.timer);
    if (held) { endHold(); return; }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) { (dx < 0 ? next : prev)({ manual: true }); return; }
    if (dy >= 90 && dy > Math.abs(dx)) { close(); return; }
    if (Math.hypot(dx, dy) < 12) {
      if (ids[idx] === 'cover') unwrap();
      else (e.clientX < innerWidth * 0.3 ? prev : next)({ manual: true });
    }
  });
  layer.addEventListener('pointercancel', () => { if (ptr) clearTimeout(ptr.timer); ptr = null; endHold(); });
  layer.addEventListener('contextmenu', (e) => e.preventDefault());

  // Progress fill finished → next slide.
  layer.querySelector('.rc-progress').addEventListener('animationend', (e) => {
    if (e.animationName === 'rc-fill' && e.target === segs[idx]?.firstElementChild) next();
  });

  requestAnimationFrame(() => layer.classList.add('in'));
  go(0);
  layer.querySelector('[data-focus]')?.focus({ preventScroll: true });
  return { close, get index() { return idx; }, get slides() { return [...ids]; }, go: (i) => go(i, { manual: true }) };
}
