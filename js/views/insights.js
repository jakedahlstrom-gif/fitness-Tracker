// Insights: the Glow calendar (swipeable month pages and a year of mini months),
// trends for a range (KPIs, the two charts, best day, feel by type) and the Year in
// Glow tiles. Also the Home teaser + recap pill and the Goals trends card.
// Numbers come from the pure stats engine (js/insights.js) via store.insightIndex()
// and store.insights(range); both are memoized per data revision and day.

import { store } from '../store.js';
import { icon } from '../icons.js';
import { esc, fmtNum, plural, fmtMinutes, prefersReducedMotion } from '../util.js';
import { addDaysKey, fmtDayLabel } from '../dates.js';
import {
  monthGrid, yearMonths, recentWeeks, highlights, recapYears, recapOffer, heatLevel, dayNum, MIN,
} from '../insights.js';
import {
  monthPageHTML, miniMonthSVG, weekStripHTML, heatLegendHTML, monthTitle, monthShort, monthLong, dayTypes,
} from '../heatmap.js';
import { segmented, typeBadge } from '../components.js';
import { navigate } from '../router.js';
import { haptic } from '../effects.js';
import { toast } from '../toast.js';
import { paletteStyle, currentLook } from '../looks.js';
import { fnv1a } from '../rewards.js';

const PREF_RANGE = 'glow-fitness:insights-range';
const PREF_HEAT = 'glow-fitness:insights-heat';
const RANGE_OPTS = [['3m', '3M'], ['6m', '6M'], ['1y', '1Y'], ['all', 'All']];
const MODE_OPTS = [['month', 'Month'], ['year', 'Year']];
const FROM_LABEL = { home: 'Home', history: 'History', goals: 'Goals', profile: 'Profile' };
const SECTION_ID = { calendar: 'ins-calendar', trends: 'ins-trends', year: 'ins-year' };
const FEEL_WORD = ['', 'Rough', 'Meh', 'Okay', 'Good', 'Amazing'];
const SILHOUETTE = [0.45, 0.62, 0.38, 0.7, 0.5, 0.82, 0.42]; // best-day capsules before there's enough data

// The charts module is loaded alongside this one but never blocks it: if it is slow or
// fails, the screen renders without the two chart cards and fills them in when it arrives.
let charts = null;
const chartsReady = import('../charts.js')
  .then((m) => (charts = m))
  .catch((err) => { console.warn('Charts unavailable', err); return null; });

let view = null;    // live screen state while Insights is showing; null after leaveInsights()
let from = 'home';  // the tab she came from (label of the back chip)
let backFn = null;  // app.js: history.back() when it pushed the entry, else show(from)
let seq = 0;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function readPref(key, allowed, fallback) {
  try { const v = localStorage.getItem(key); return allowed.includes(v) ? v : fallback; } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage blocked: the choice lasts this visit */ }
}

const hash = (v) => String(fnv1a(JSON.stringify(v)));
const weekdayName = (dow, style = 'long') => new Date(2023, 0, 1 + dow).toLocaleDateString(undefined, { weekday: style });
const pct = (x) => Math.round(Math.abs(x) * 100);
const fmt1 = (x) => (Math.round(x * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** The year promoted in season: this year in December, last year in January. */
function seasonYear(today) {
  const m = Number(today.slice(5, 7));
  const y = Number(today.slice(0, 4));
  return m === 12 ? String(y) : m === 1 ? String(y - 1) : null;
}

/** meta.recapSeen, read defensively: { 'YYYY': 'watched' | 'dismissed' }. */
export function recapSeen() {
  const raw = store.meta?.recapSeen;
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (/^\d{4}$/.test(k) && (v === 'watched' || v === 'dismissed')) out[k] = v;
  }
  return out;
}

/** "▲ 12%", "▼ 8%" or "—" (no comparison, or under 1%). */
export function deltaChip(d) {
  if (d == null || !Number.isFinite(d) || Math.abs(d) < 0.01) return '<span class="ins-delta flat" aria-label="no change to compare">—</span>';
  return d > 0
    ? `<span class="ins-delta up" aria-label="up ${pct(d)}%">▲ ${pct(d)}%</span>`
    : `<span class="ins-delta down" aria-label="down ${pct(d)}%">▼ ${pct(d)}%</span>`;
}

/** Play a story: the Year in Glow player is loaded on demand. */
export function openYear(year) {
  return import('../recap.js')
    .then((m) => m.openRecap(String(year)))
    .catch((err) => {
      console.error(err);
      toast("Couldn't open your Year in Glow");
    });
}

/** The Home pill's ×: don't promote this year's story again. */
export function dismissRecap(year) {
  const y = String(year);
  const seen = recapSeen();
  if (seen[y]) return;
  store.updateMeta({ recapSeen: { ...seen, [y]: 'dismissed' } });
}

/** Start fetching Chart.js early (Home and Goals cards call this on pointerdown). */
export function warmCharts() {
  if (!store.state.workouts.length) return;
  chartsReady.then((m) => m?.loadChart?.()).catch(() => {});
}

/** app.js registers what the back chip does (it knows whether it pushed a history entry). */
export function setInsightsBack(fn) { backFn = fn; }

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render or patch the Insights screen.
 * @param {HTMLElement} el
 * @param {object} [params]
 * @param {'home'|'history'|'goals'|'profile'} [params.from]  the tab she came from
 * @param {'calendar'|'trends'|'year'} [params.section]        scroll to a section and flash it
 * @param {string} [params.recap]                               play that year's story ('YYYY')
 */
export function renderInsights(el, params = {}) {
  if (FROM_LABEL[params.from]) from = params.from;
  const ix = store.insightIndex();
  const hasData = !!ix.first;
  const fresh = !view || view.el !== el || view.hasData !== hasData || !el.querySelector('.ins-top');
  if (fresh) mount(el, ix, hasData);
  else patch(ix);
  if (!el.dataset.bound) bind(el);
  if (params.section) revealSection(params.section, fresh);
  if (params.recap) openYear(params.recap);
}

/** Leaving Insights: destroy the charts (iOS caps canvas memory) and stop the observers. */
export function leaveInsights() {
  if (!view) return;
  try { view.ctl?.destroy?.(); } catch (err) { console.error(err); }
  [...view.ios, ...(view.cal?.ios || [])].forEach((io) => io.disconnect());
  view.timers.forEach(clearTimeout);
  document.removeEventListener('glow:look', onLook);
  view = null;
}

function mount(el, ix, hasData) {
  leaveInsights();
  view = {
    el, ix, hasData,
    token: ++seq,
    mode: readPref(PREF_HEAT, ['month', 'year'], 'month'),
    range: readPref(PREF_RANGE, RANGE_OPTS.map(([v]) => v), '3m'),
    month: ix.today.slice(0, 7),
    year: Number(ix.today.slice(0, 4)),
    sel: null,
    focus: null,
    sigs: {},
    cal: null,
    ctl: null,
    ios: [],
    timers: [],
    todayLevel: heatLevel(ix.days.get(ix.today), ix.scale),
  };
  const ins = hasData ? store.insights(view.range) : null;
  const hero = hasData ? heroHTML(ix) : '';

  el.innerHTML = `
    <header class="top ins-top">
      <button type="button" class="nav-back" data-action="back">${icon('chevronLeft')}<span class="nav-back-label">${FROM_LABEL[from] || 'Home'}</span></button>
      <div class="brand">GLOW<i>//</i>FIT</div>
      <h1>Insights</h1>
      <p class="subtle">Your glow, by the numbers</p>
    </header>
    <section class="ins-hero" id="ins-hero" aria-label="Your Year in Glow"${hero ? '' : ' hidden'}>${hero}</section>
    <article class="card hm-card" id="ins-calendar" aria-labelledby="hm-label">${calendarShellHTML(ix)}</article>
    ${hasData ? trendsHTML(ins) : emptyHTML()}
    <article class="card ins-year" id="ins-year" aria-labelledby="yr-label"${hasData ? '' : ' hidden'}>${hasData ? yearCardInner(ix) : ''}</article>`;

  view.sigs.hero = heroSig(ix);
  view.sigs.year = yearSig(ix);

  // Cards rise in once, on the first render only.
  const risers = [...el.children].filter((c) => !c.classList.contains('top') && !c.hidden)
    .flatMap((c) => (c.classList.contains('trends') ? [...c.children].filter((x) => !x.classList.contains('ins-rangebar')) : [c]));
  risers.forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 8))));
  el.classList.add('ins-enter');
  later(() => el.classList.remove('ins-enter'), 1000);

  mountCalendar(ix, { wave: true });
  if (hasData) mountTrends(ins);
  document.addEventListener('glow:look', onLook);
}

function patch(ix) {
  view.ix = ix;
  const label = view.el.querySelector('.nav-back-label');
  if (label) label.textContent = FROM_LABEL[from] || 'Home';
  patchYearCards(ix);
  patchCalendar(ix);
  if (view.hasData) patchTrends(store.insights(view.range));
}

const later = (fn, ms) => { if (view) view.timers.push(setTimeout(fn, ms)); };

function revealSection(section, fresh) {
  const target = view?.el.querySelector(`#${SECTION_ID[section] || ''}`);
  if (!target || target.hidden) return;
  const flash = section === 'trends' ? (view.el.querySelector('#ins-minutes') || view.el.querySelector('#ins-kpis')) : target;
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: 'start', behavior: fresh || prefersReducedMotion() ? 'auto' : 'smooth' });
    flash?.classList.add('flash');
    setTimeout(() => flash?.classList.remove('flash'), 1600);
  });
}

function emptyHTML() {
  return `
    <article class="card empty ins-empty" id="ins-empty">
      <div class="empty-art">${icon('sparkle')}</div>
      <h3>Your insights light up after your first workout.</h3>
      <p class="muted">Hold the pink button to log one.</p>
    </article>`;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function bind(el) {
  el.dataset.bound = '1';
  el.addEventListener('click', (e) => {
    if (!view) return;
    const cell = e.target.closest('.hm-cell[data-k]');
    if (cell) { selectDay(cell.dataset.k); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'back':
        haptic('tick');
        if (backFn) backFn();
        else navigate(from);
        break;
      case 'hm-mode':
        haptic('tick');
        setMode(btn.dataset.value);
        break;
      case 'hm-prev':
      case 'hm-next':
        haptic('tick');
        step(btn.dataset.action === 'hm-next' ? 1 : -1);
        break;
      case 'hm-mini':
        haptic('tick');
        view.month = btn.dataset.m;
        setMode('month', { wave: true });
        break;
      case 'hm-view':
        navigate('history', { day: btn.dataset.day });
        break;
      case 'ins-range':
        if (btn.dataset.value !== view.range) haptic('tick');
        setRange(btn.dataset.value);
        break;
      case 'year':
        haptic('tick');
        openYear(btn.dataset.year);
        break;
      default:
    }
  });
  el.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (!view) return;
  // Segmented controls: arrows move between options (radiogroup pattern).
  const seg = e.target.closest('.segmented .seg');
  if (seg && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const opts = [...seg.parentElement.querySelectorAll('.seg')];
    const next = opts[(opts.indexOf(seg) + (e.key === 'ArrowRight' ? 1 : opts.length - 1)) % opts.length];
    e.preventDefault();
    next.click();
    view?.el.querySelector(`.seg[data-action="${next.dataset.action}"][data-value="${next.dataset.value}"]`)?.focus();
    return;
  }
  // Calendar: ←/→ one day, ↑/↓ one week, crossing months.
  const cell = e.target.closest('.hm-cell[data-k]');
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (!cell || !delta) return;
  e.preventDefault();
  const first = `${view.cal.months[0]}-01`;
  let key = addDaysKey(cell.dataset.k, delta);
  if (key > view.ix.today) key = view.ix.today;
  if (key < first) key = first;
  if (key === cell.dataset.k) return;
  const mk = key.slice(0, 7);
  if (mk !== view.month) jumpTo(mk);
  view.focus = key;
  syncTabStops();
  view.cal.pager.querySelector(`.hm-cell[data-k="${key}"]`)?.focus({ preventScroll: true });
}

function onLook() {
  if (view) patchYearCards(view.ix);
}

// ---------------------------------------------------------------------------
// Glow calendar
// ---------------------------------------------------------------------------

function weekdayRow(ws) {
  return Array.from({ length: 7 }, (_, i) => `<span>${esc(weekdayName((ws + i) % 7, 'narrow'))}</span>`).join('');
}

function calendarShellHTML(ix) {
  return `
    <div class="card-head hm-head">
      <h2 class="label" id="hm-label">Glow calendar</h2>
      ${segmented('hm-mode', MODE_OPTS, view.mode, { ariaLabel: 'Calendar view' })}
    </div>
    <div class="hm-titlebar">
      <button type="button" class="icon-btn hm-nav" data-action="hm-prev">${icon('chevronLeft')}</button>
      <span class="hm-title" aria-live="polite"></span>
      <button type="button" class="icon-btn hm-nav" data-action="hm-next">${icon('chevronRight')}</button>
      <span class="hm-cmp"></span>
    </div>
    <div class="hm-month"${view.mode === 'month' ? '' : ' hidden'}>
      <div class="hm-dow" aria-hidden="true">${weekdayRow(ix.ws)}</div>
      <div class="hm-pager">${ix.months.map((mk) => `<div class="hm-page" data-m="${mk}"></div>`).join('')}</div>
    </div>
    <div class="hm-year"${view.mode === 'year' ? '' : ' hidden'}></div>
    <div class="hm-detail" aria-live="polite"></div>
    <div class="hm-foot">${heatLegendHTML(ix.scale)}</div>`;
}

const calSig = (ix) => `${ix.months.join(',')}|${ix.ws}|${ix.today}|${ix.scale.join(',')}`;

function mountCalendar(ix, { wave = false } = {}) {
  const card = view.el.querySelector('#ins-calendar');
  const pager = card.querySelector('.hm-pager');
  const pages = [...pager.children];
  const months = ix.months.slice();
  if (!months.includes(view.month)) view.month = months[months.length - 1];
  const years = [Number(months[0].slice(0, 4)), Number(ix.today.slice(0, 4))];
  view.year = Math.min(years[1], Math.max(years[0], view.year));
  view.cal = { card, pager, pages, months, years, sig: calSig(ix), detail: null, yearSig: null, ios: [] };

  if (view.mode === 'month') showPage(months.indexOf(view.month), { wave: wave && !prefersReducedMotion() });
  else renderYear();
  updateTitle();
  updateDetail(false);

  if (!window.IntersectionObserver) return;
  // Fill pages as they come near (±1 page), and follow the page she swipes to.
  const fillIO = new window.IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) fillPage(pages.indexOf(e.target));
  }, { root: pager, rootMargin: '0px 100%' });
  const seeIO = new window.IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) setMonth(e.target.dataset.m);
  }, { root: pager, threshold: 0.6 });
  pages.forEach((p) => { fillIO.observe(p); seeIO.observe(p); });
  view.cal.ios.push(fillIO, seeIO);
}

/** Fill page i (and its neighbors) and scroll the pager to it instantly. */
function showPage(i, { wave = false } = {}) {
  const { pager } = view.cal;
  fillPage(i, { wave, force: wave });
  fillPage(i - 1);
  fillPage(i + 1);
  pager.scrollLeft = i * pager.clientWidth;
}

function focusKeyFor(mk) {
  if (mk !== view.month) return null;
  const today = view.ix.today;
  if (view.focus?.startsWith(mk)) return view.focus;
  if (view.sel?.startsWith(mk)) return view.sel;
  return today.startsWith(mk) ? today : `${mk}-01`;
}

function fillPage(i, { wave = false, force = false } = {}) {
  const page = view?.cal.pages[i];
  if (!page || (page.dataset.sig && !force)) return;
  const grid = monthGrid(view.ix, page.dataset.m);
  page.innerHTML = monthPageHTML(grid, { ix: view.ix, selected: view.sel, focusKey: focusKeyFor(grid.key), wave });
  page.dataset.sig = hash(grid.cells);
}

/** Empty pages far from the visible one, so 5 years of months stay light. */
function trimPages() {
  const { pages, months } = view.cal;
  const at = months.indexOf(view.month);
  pages.forEach((p, j) => {
    if (Math.abs(j - at) > 2 && p.dataset.sig) {
      p.innerHTML = '';
      delete p.dataset.sig;
    }
  });
}

/** The visible month changed (swipe, arrows or keyboard). */
function setMonth(mk) {
  if (!view || mk === view.month || view.mode !== 'month') return;
  view.month = mk;
  if (view.sel && !view.sel.startsWith(mk)) view.sel = null;
  if (view.focus && !view.focus.startsWith(mk)) view.focus = null;
  markSelection();
  updateTitle();
  updateDetail();
  trimPages();
}

/** Arrow buttons: smooth scroll plus the enter wave. */
function goMonth(mk, { wave = true } = {}) {
  const { months, pager } = view.cal;
  const i = months.indexOf(mk);
  if (i < 0) return;
  const reduce = prefersReducedMotion();
  const far = Math.abs(i - months.indexOf(view.month)) > 1;
  fillPage(i, { wave: wave && !reduce, force: wave && !reduce });
  pager.scrollTo({ left: i * pager.clientWidth, behavior: reduce || far ? 'auto' : 'smooth' });
  setMonth(mk);
}

/** Keyboard: jump to another month instantly. */
function jumpTo(mk) {
  const i = view.cal.months.indexOf(mk);
  if (i < 0) return;
  showPage(i);
  setMonth(mk);
}

function step(dir) {
  if (view.mode === 'month') {
    const { months } = view.cal;
    const mk = months[months.indexOf(view.month) + dir];
    if (mk) goMonth(mk);
  } else {
    const y = view.year + dir;
    const [lo, hi] = view.cal.years;
    if (y < lo || y > hi) return;
    view.year = y;
    renderYear();
    updateTitle();
    updateDetail();
  }
}

function setMode(mode, { wave = false } = {}) {
  if (!MODE_OPTS.some(([v]) => v === mode)) return;
  const { card, months } = view.cal;
  const changed = mode !== view.mode;
  view.mode = mode;
  savePref(PREF_HEAT, mode);
  card.querySelectorAll('.seg[data-action="hm-mode"]').forEach((b) => {
    const on = b.dataset.value === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  card.querySelector('.hm-month').hidden = mode !== 'month';
  card.querySelector('.hm-year').hidden = mode !== 'year';
  view.sel = null;
  view.focus = null;
  if (mode === 'year') {
    view.year = Number(view.month.slice(0, 4));
    renderYear();
  } else {
    if (!months.includes(view.month)) view.month = months[months.length - 1];
    showPage(months.indexOf(view.month), { wave: wave && !prefersReducedMotion() });
    markSelection();
  }
  if (changed || wave) {
    updateTitle();
    updateDetail();
  }
}

function yearGrids() {
  return yearMonths(view.ix, view.year);
}

function renderYear(grids = yearGrids()) {
  const box = view.cal.card.querySelector('.hm-year');
  box.innerHTML = `<div class="hm-year-grid">${grids.map((g) => {
    const dim = g.state === 'before' || g.state === 'future';
    const t = g.totals || { active: 0, min: 0 };
    const label = dim ? monthTitle(g.key) : `${monthTitle(g.key)}: ${plural(t.active, 'active day')}, ${plural(t.min, 'minute')}`;
    return `
      <button type="button" class="hm-mini${dim ? ' dim' : ''}${g.state === 'current' ? ' is-current' : ''}" data-action="hm-mini" data-m="${g.key}"
        aria-label="${esc(label)}"${dim ? ' disabled' : ''}>
        <span class="hm-mini-label">${esc(monthShort(g.key))}</span>${miniMonthSVG(g, { cell: 10, gap: 2 })}
      </button>`;
  }).join('')}</div>`;
  view.cal.yearSig = hash(grids.map((g) => [g.state, g.cells]));
}

function updateTitle() {
  const { card, months, years } = view.cal;
  const [prev, next] = card.querySelectorAll('.hm-nav');
  const title = card.querySelector('.hm-title');
  const cmp = card.querySelector('.hm-cmp');
  if (view.mode === 'month') {
    const i = months.indexOf(view.month);
    title.textContent = monthTitle(view.month);
    prev.disabled = i <= 0;
    next.disabled = i >= months.length - 1;
    prev.setAttribute('aria-label', 'Previous month');
    next.setAttribute('aria-label', 'Next month');
    cmp.innerHTML = compareHTML(monthGrid(view.ix, view.month), i > 0 ? months[i - 1] : null);
  } else {
    title.textContent = String(view.year);
    prev.disabled = view.year <= years[0];
    next.disabled = view.year >= years[1];
    prev.setAttribute('aria-label', 'Previous year');
    next.setAttribute('aria-label', 'Next year');
    cmp.innerHTML = '';
  }
}

/** "↑ 18% vs Sep" when this month beats last month, else a neutral "Sep: 410 min". */
function compareHTML(grid, prevMk) {
  if (grid.best) {
    return `<span class="hm-best" aria-label="Best month ever">${icon('trophy')}<span>Best<span class="hm-long"> month ever</span></span></span>`;
  }
  if (!prevMk) return '';
  const was = grid.prevMin || 0;
  const now = grid.totals?.min || 0;
  if (was > 0 && now >= was * 1.01) {
    const p = Math.round(((now - was) / was) * 100);
    return `<span class="hm-up" aria-label="${esc(`${p}% more minutes than ${monthLong(prevMk)}`)}">↑ ${p}%<span class="hm-long"> vs ${esc(monthShort(prevMk))}</span></span>`;
  }
  return `<span class="hm-prev">${esc(monthShort(prevMk))}: ${fmtNum(was)} min</span>`;
}

function selectDay(key) {
  view.sel = view.sel === key ? null : key;
  view.focus = key;
  haptic('tick');
  markSelection();
  updateDetail();
}

function markSelection() {
  const { pager } = view.cal;
  pager.querySelectorAll('.hm-cell.is-sel').forEach((c) => c.classList.remove('is-sel'));
  if (view.sel) pager.querySelector(`.hm-cell[data-k="${view.sel}"]`)?.classList.add('is-sel');
  syncTabStops();
}

/** Roving tabindex: one calendar cell (in the visible month) takes Tab focus. */
function syncTabStops() {
  const { pager } = view.cal;
  const key = focusKeyFor(view.month);
  pager.querySelectorAll('.hm-cell[tabindex="0"]').forEach((c) => { if (c.dataset.k !== key) c.tabIndex = -1; });
  const cell = pager.querySelector(`.hm-cell[data-k="${key}"]`);
  if (cell && !cell.disabled) cell.tabIndex = 0;
}

function totalsLine({ active, n, min }) {
  const parts = [`<b>${fmtNum(active)}</b> active ${active === 1 ? 'day' : 'days'}`, `<b>${fmtNum(n)}</b> ${n === 1 ? 'workout' : 'workouts'}`];
  if (min) parts.push(`<b>${esc(fmtMinutes(min))}</b>`);
  return `<span class="hm-d-text">${parts.join(' · ')}</span>`;
}

function detailHTML() {
  const ix = view.ix;
  const key = view.sel;
  if (key) {
    const day = ix.days.get(key);
    const label = esc(fmtDayLabel(key));
    if (day?.n) {
      const parts = [label, plural(day.n, 'workout')];
      if (day.min) parts.push(esc(fmtMinutes(day.min)));
      const badges = dayTypes(ix, key).slice(0, 3).map((id) => typeBadge(id, 'xs')).join('');
      return `<span class="hm-d-text">${parts.join(' · ')}</span><span class="hm-d-types" aria-hidden="true">${badges}</span>
        <button type="button" class="hm-view" data-action="hm-view" data-day="${key}" aria-label="${esc(`View ${fmtDayLabel(key)} in History`)}">View${icon('chevronRight')}</button>`;
    }
    if (ix.rest.has(key)) return `${icon('moon', 'hm-d-moon')}<span class="hm-d-text">${label} · Rest day</span>`;
    if (key === ix.today) return '<span class="hm-d-text">Today\'s square is waiting. Hold the pink button.</span>';
    return `<span class="hm-d-text">${label} · No workout</span>`;
  }
  if (view.mode === 'year') {
    const t = yearGrids().reduce((a, g) => {
      a.active += g.totals?.active || 0; a.n += g.totals?.n || 0; a.min += g.totals?.min || 0;
      return a;
    }, { active: 0, n: 0, min: 0 });
    return t.n ? totalsLine(t) : `<span class="hm-d-text">No workouts in ${view.year}</span>`;
  }
  const t = monthGrid(ix, view.month).totals;
  if (t.n) return totalsLine(t);
  return view.month === ix.today.slice(0, 7)
    ? '<span class="hm-d-text">Today\'s square is waiting. Hold the pink button.</span>'
    : `<span class="hm-d-text">No workouts in ${esc(monthLong(view.month))}</span>`;
}

/** The live line under the grid; crossfades when its content changes. */
function updateDetail(fade = true) {
  const box = view.cal.card.querySelector('.hm-detail');
  const html = detailHTML();
  if (html === view.cal.detail) return;
  view.cal.detail = html;
  box.innerHTML = html;
  box.classList.toggle('has-view', !!box.querySelector('.hm-view'));
  if (fade && !prefersReducedMotion()) {
    box.classList.remove('swap');
    void box.offsetWidth; // restart the fade
    box.classList.add('swap');
  }
}

function patchCalendar(ix) {
  const { card } = view.cal;
  if (calSig(ix) !== view.cal.sig) {
    // A new month, day, week start or heat scale: rebuild the calendar (no wave).
    view.cal.ios.forEach((io) => io.disconnect());
    card.innerHTML = calendarShellHTML(ix);
    mountCalendar(ix);
  } else {
    const focused = document.activeElement?.closest?.('.hm-cell[data-k]')?.dataset.k;
    view.cal.pages.forEach((p, i) => {
      if (!p.dataset.sig) return;
      const grid = monthGrid(ix, p.dataset.m);
      if (hash(grid.cells) !== p.dataset.sig) fillPage(i, { force: true });
    });
    if (focused) view.cal.pager.querySelector(`.hm-cell[data-k="${focused}"]`)?.focus({ preventScroll: true });
    if (view.mode === 'year') {
      const grids = yearGrids();
      if (hash(grids.map((g) => [g.state, g.cells])) !== view.cal.yearSig) renderYear(grids);
    }
    updateTitle();
    updateDetail();
  }
  // She logged while here: today's square ignites.
  const lvl = heatLevel(ix.days.get(ix.today), ix.scale);
  if (lvl > view.todayLevel) ignite(ix.today);
  view.todayLevel = lvl;
}

function ignite(today) {
  if (prefersReducedMotion()) return;
  const { card, pager } = view.cal;
  if (view.mode === 'month' && view.month !== today.slice(0, 7)) goMonth(today.slice(0, 7), { wave: false });
  const el = view.mode === 'month'
    ? pager.querySelector(`.hm-cell[data-k="${today}"]`)
    : card.querySelector(`.hm-year rect[data-k="${today}"]`);
  if (!el) return;
  el.classList.remove('ignite');
  void el.getBoundingClientRect();
  el.classList.add('ignite');
  later(() => el.classList.remove('ignite'), 700);
}

// ---------------------------------------------------------------------------
// Trends: range bar, KPIs, charts, best day, feel by type
// ---------------------------------------------------------------------------

const typesSig = () => hash(store.settings.types);

function trendsHTML(ins) {
  return `
    <section class="trends" id="ins-trends" aria-labelledby="ins-trends-label">
      <div class="ins-sentinel" aria-hidden="true"></div>
      <div class="ins-rangebar">
        <div class="ins-rangebar-row">
          <h2 class="label" id="ins-trends-label">Trends</h2>
          ${segmented('ins-range', RANGE_OPTS, view.range, { ariaLabel: 'Time range' })}
        </div>
        <div class="ins-charts-note" data-charts-note></div>
      </div>
      <div class="kpis" id="ins-kpis" role="group" aria-label="Totals">${kpisInner(ins)}</div>
      ${charts ? charts.minutesCardHTML(ins) : '<div class="ins-chart-slot bars" data-chart-slot="minutes"></div>'}
      ${charts ? charts.mixCardHTML(ins) : '<div class="ins-chart-slot mix" data-chart-slot="mix"></div>'}
      <article class="card ins-power" id="ins-power" aria-labelledby="pw-label">${powerInner(ins.power, { wait: true })}</article>
      <article class="card ins-feel" id="ins-feel" aria-labelledby="fl-label">${feelInner(ins.feel)}</article>
    </section>`;
}

function mountTrends(ins) {
  const t = typesSig();
  view.sigs.kpis = `${view.range}|${ins.sig.kpis}`;
  view.sigs.power = `${t}|${ins.sig.power}`;
  view.sigs.feel = `${t}|${ins.sig.feel}`;
  watchPower();
  watchSticky();
  const token = view.token;
  const start = (m) => {
    if (!m || !view || view.token !== token) return;
    const sec = view.el.querySelector('#ins-trends');
    if (!sec?.isConnected) return;
    const now = store.insights(view.range);
    sec.querySelectorAll('[data-chart-slot]').forEach((slot) => {
      slot.outerHTML = slot.dataset.chartSlot === 'minutes' ? m.minutesCardHTML(now) : m.mixCardHTML(now);
    });
    try {
      m.loadChart?.();
      view.ctl = m.createChartCards(sec);
      view.ctl?.update?.(now);
    } catch (err) {
      console.error(err); // the CSS fallbacks stay
    }
  };
  if (charts) start(charts);
  else chartsReady.then(start);
}

function patchTrends(ins) {
  const t = typesSig();
  const root = view.el;
  const kpis = `${view.range}|${ins.sig.kpis}`;
  if (kpis !== view.sigs.kpis) {
    root.querySelector('#ins-kpis').innerHTML = kpisInner(ins);
    view.sigs.kpis = kpis;
  }
  try { view.ctl?.update?.(ins); } catch (err) { console.error(err); }
  const power = `${t}|${ins.sig.power}`;
  if (power !== view.sigs.power) {
    root.querySelector('#ins-power').innerHTML = powerInner(ins.power);
    view.sigs.power = power;
  }
  const feel = `${t}|${ins.sig.feel}`;
  if (feel !== view.sigs.feel) {
    root.querySelector('#ins-feel').innerHTML = feelInner(ins.feel);
    view.sigs.feel = feel;
  }
}

function setRange(range) {
  if (!RANGE_OPTS.some(([v]) => v === range) || range === view.range) return;
  view.range = range;
  savePref(PREF_RANGE, range);
  view.el.querySelectorAll('.seg[data-action="ins-range"]').forEach((b) => {
    const on = b.dataset.value === range;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  patchTrends(store.insights(range));
}

/** Shadow under the range bar once it sticks. */
function watchSticky() {
  const sentinel = view.el.querySelector('.ins-sentinel');
  const bar = view.el.querySelector('.ins-rangebar');
  if (!window.IntersectionObserver || !sentinel) return;
  const io = new window.IntersectionObserver(([e]) => {
    bar.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 0);
  });
  io.observe(sentinel);
  view.ios.push(io);
}

/** Best-day capsules grow when the card scrolls into view (first render only). */
function watchPower() {
  const caps = view.el.querySelector('.pw-caps.pw-wait');
  if (!caps) return;
  if (!window.IntersectionObserver || prefersReducedMotion()) { caps.classList.remove('pw-wait'); return; }
  const io = new window.IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    caps.classList.remove('pw-wait');
  }, { threshold: 0.4 });
  io.observe(caps);
  view.ios.push(io);
}

function kpisInner(ins) {
  const k = ins.kpis;
  const hours = k.min >= 600;
  const tiles = [
    ['Workouts', 'pink', fmtNum(k.count), k.delta?.count],
    [hours ? 'Hours' : 'Minutes', 'purple', hours ? fmt1(k.min / 60) : fmtNum(k.min), k.delta?.min],
    ['Active days', 'cyan', fmtNum(k.active), k.delta?.active],
  ];
  return tiles.map(([label, c, val, d]) => `
    <div class="card kpi c-${c}">
      <span class="kpi-label">${label}</span>
      <span class="kpi-val">${val}</span>
      ${deltaChip(d)}
    </div>`).join('');
}

/** Power-day fields, tolerant of the stats engine's exact naming. */
function powerView(p) {
  const days = p?.days || [];
  const byDow = (x) => (typeof x === 'number' ? days.find((d) => d.dow === x) : x) || null;
  const best = byDow(p?.best);
  const second = byDow(p?.second);
  return { days, best, second, show: !!(p?.show && best), tie: !!(p?.tie && second), need: p?.need ?? 0 };
}

function powerInner(p, { wait = false } = {}) {
  const v = powerView(p);
  const max = Math.max(0, ...v.days.map((d) => d.score || 0));
  const winners = v.show ? [v.best, ...(v.tie ? [v.second] : [])].map((d) => d.dow) : [];
  const name = (d) => `<b>${esc(weekdayName(d.dow))}</b>`;
  let headline;
  if (!v.show) headline = `<span class="ins-hl-sub">Log on ${plural(Math.max(1, v.need), 'more day')} to find your power day</span>`;
  else if (v.tie) headline = `${name(v.best)}<span class="ins-hl-sub"> and </span>${name(v.second)}<span class="ins-hl-sub"> are neck and neck</span>`;
  else headline = `${name(v.best)}<span class="ins-hl-sub"> is your power day</span>`;

  const caps = v.days.map((d, i) => {
    const win = winners.includes(d.dow);
    const h = v.show ? (max ? (d.score || 0) / max : 0) : SILHOUETTE[i % 7];
    return `
      <span class="pw-col${win ? ' win' : ''}">
        <span class="pw-crown">${win ? icon('crown') : ''}</span>
        <span class="pw-track">${h > 0 ? `<i class="pw-fill" style="--h:${h.toFixed(3)};--i:${i}"></i>` : ''}</span>
        <span class="pw-day">${esc(weekdayName(d.dow, 'narrow'))}</span>
      </span>`;
  }).join('');
  const aria = v.show
    ? `Average minutes by weekday: ${v.days.map((d) => `${weekdayName(d.dow)} ${Math.round(d.score || 0)}`).join(', ')}`
    : 'Not enough workouts yet to compare weekdays';

  const showed = (d) => `${fmtNum(d.active || 0)} of ${fmtNum(d.occ || 0)} ${esc(weekdayName(d.dow))}s`;
  let foot = '';
  if (v.show && v.tie) foot = `You showed up ${showed(v.best)} and ${showed(v.second)}`;
  else if (v.show) foot = `You showed up ${showed(v.best)} · ${esc(fmtMinutes(v.best.min || 0))} in all`;

  return `
    <div class="card-head"><h2 class="label" id="pw-label">Best day</h2></div>
    <p class="ins-headline">${headline}</p>
    <div class="pw-caps${v.show ? '' : ' muted-caps'}${wait ? ' pw-wait' : ''}" role="img" aria-label="${esc(aria)}">${caps}</div>
    ${foot ? `<p class="ins-foot">${foot}</p>` : ''}`;
}

function feelInner(f) {
  const rows = f?.rows || [];
  const rated = f?.rated ?? rows.reduce((a, r) => a + r.n, 0);
  const head = '<div class="card-head"><h2 class="label" id="fl-label">Feel by type</h2></div>';
  if (!rows.length) {
    return `${head}<p class="ins-empty-line">Rate how a workout felt (1–5) when you log it, and you'll see which ones make you glow. ${fmtNum(rated)} rated so far.</p>`;
  }
  const type = (id) => store.typeById(id);
  let headline;
  if (f.best) headline = `<b>${esc(type(f.best).label)}</b><span class="ins-hl-sub"> leaves you feeling best</span>`;
  else if (rows.length > 1) headline = '<span class="ins-hl-sub">You feel about the same across your workouts</span>';
  else headline = `<b>${esc(type(rows[0].typeId).label)}</b><span class="ins-hl-sub"> · avg ${fmt1(rows[0].avg)} of 5</span>`;

  const list = rows.map((r) => {
    const t = type(r.typeId);
    const best = r.typeId === f.best;
    const w = Math.max(0, Math.min(1, (r.avg - 1) / 4));
    return `
      <div class="fl-row c-${t.color}" role="listitem" aria-label="${esc(`${t.label}: average ${fmt1(r.avg)} of 5 over ${plural(r.n, 'workout')}${best ? ', feels best' : ''}`)}">
        <span class="type-badge fl-badge" aria-hidden="true">${icon(t.icon)}</span>
        <span class="fl-main" aria-hidden="true">
          <span class="fl-name"><span class="fl-label">${esc(t.label)}</span>${best ? '<span class="fl-tag">Feels best</span>' : ''}</span>
          <span class="bar"><i style="width:${(w * 100).toFixed(1)}%"></i></span>
        </span>
        <span class="fl-val" aria-hidden="true"><b>${fmt1(r.avg)}</b><small>${FEEL_WORD[Math.round(r.avg)] || ''}</small></span>
      </div>`;
  }).join('');
  const hidden = f.hidden || 0;
  const more = hidden ? ` · ${plural(hidden, 'type')} ${hidden === 1 ? 'needs' : 'need'} 3 ratings` : '';
  return `${head}
    <p class="ins-headline">${headline}</p>
    <div class="fl-rows" role="list">${list}</div>
    <p class="ins-foot">Based on ${plural(rated, 'rated workout')}${more}</p>`;
}

// ---------------------------------------------------------------------------
// Year in Glow: season hero and the tiles card
// ---------------------------------------------------------------------------

const darkLook = () => esc(paletteStyle(currentLook().palette, 'dark'));

function heroYear(ix) {
  const Y = seasonYear(ix.today);
  const y = Y && recapYears(ix).find((r) => String(r.year) === Y);
  return y && y.n >= MIN.recapPromo ? y : null;
}

function heroHTML(ix) {
  const y = heroYear(ix);
  if (!y) return '';
  const Y = String(y.year);
  const watched = recapSeen()[Y] === 'watched';
  return `
    <button type="button" class="yr-hero" data-action="year" data-year="${Y}" style="${darkLook()}"
      aria-label="${esc(`Your ${Y} in Glow is ready. ${watched ? 'Watch again' : 'Play'}`)}">
      <span class="yr-ghost" aria-hidden="true">${Y}</span>
      <span class="yr-kicker">Your year in Glow</span>
      <span class="yr-hero-title">Your ${Y} in Glow is ready</span>
      <span class="yr-hero-sub">${plural(y.n, 'workout')} · a story in squares</span>
      <span class="yr-cta">${icon('play')}${watched ? 'Watch again' : 'Play'}</span>
    </button>`;
}

function yearCardInner(ix) {
  const years = recapYears(ix);
  const offer = recapOffer(ix, recapSeen());
  const style = darkLook();
  const tiles = years.map((y) => {
    const Y = String(y.year);
    const soFar = !!y.current && ix.today < `${Y}-12-01`;
    return `
      <button type="button" class="yr-tile${offer && String(offer) === Y ? ' pulse' : ''}" data-action="year" data-year="${Y}" style="${style}"
        aria-label="${esc(`Your ${Y} in Glow${soFar ? ' so far' : ''}: ${plural(y.n, 'workout')}. Play`)}">
        ${soFar ? '<span class="yr-chip">So far</span>' : ''}
        <span class="yr-num">${Y}</span>
        <span class="yr-n">${plural(y.n, 'workout')}</span>
        <span class="yr-play" aria-hidden="true">${icon('play')}</span>
      </button>`;
  }).join('');
  return `
    <div class="card-head"><h2 class="label" id="yr-label">Your Year in Glow</h2></div>
    <div class="yr-row">${tiles}</div>
    <p class="ins-foot">Tap a year to play its story.</p>`;
}

const heroSig = (ix) => hash([heroYear(ix), recapSeen(), currentLook().palette]);
const yearSig = (ix) => hash([recapYears(ix), recapOffer(ix, recapSeen()), ix.today.slice(0, 7), currentLook().palette]);

function patchYearCards(ix) {
  if (!view.hasData) return;
  const hs = heroSig(ix);
  if (hs !== view.sigs.hero) {
    const box = view.el.querySelector('#ins-hero');
    const html = heroHTML(ix);
    box.innerHTML = html;
    box.hidden = !html;
    view.sigs.hero = hs;
  }
  const ys = yearSig(ix);
  if (ys !== view.sigs.year) {
    view.el.querySelector('#ins-year').innerHTML = yearCardInner(ix);
    view.sigs.year = ys;
  }
}

// ---------------------------------------------------------------------------
// Home: teaser card and recap pill
// ---------------------------------------------------------------------------

/** Copy for one highlight (spec §4.2) from its `data`. */
function highlightCopy(h, ix) {
  const d = h?.data || {};
  switch (h?.id) {
    case 'bestMonth':
      return { icon: 'trophy', color: 'yellow', title: `${monthLong(d.month)} is your biggest month ever`, sub: `${fmtMinutes(d.min)} and counting` };
    case 'minutesUp':
      return { icon: 'bolt', color: 'purple', title: `Minutes are up ${d.pct}%`, sub: 'Last 4 weeks vs the 4 before' };
    case 'powerDay': {
      const day = weekdayName(d.dow);
      return { icon: 'calendar', color: 'pink', title: `${day}s are your power day`, sub: `${fmtNum(d.active)} of the last ${fmtNum(d.occ)} ${day}s` };
    }
    case 'feelBest': {
      const t = store.typeById(d.typeId);
      return { icon: 'heart', color: t.color, title: `${t.label} feels best`, sub: `Avg ${fmt1(d.avg)} of 5 over ${plural(d.n, 'workout')}` };
    }
    case 'streak':
      return { icon: 'flame', color: 'orange', title: `${d.weeks} weeks and counting`, sub: 'Your weekly streak is glowing' };
    default:
      return { icon: 'sparkle', color: 'pink', title: 'Your month in squares', sub: ix.first ? 'Heatmap, trends and your Year in Glow' : 'Log a workout and watch it light up' };
  }
}

/** Home: the Insights card under the tiles (week strip + one highlight that's stable for the day). */
export function insightsTeaserHTML() {
  const ix = store.insightIndex();
  let line;
  if (ix.first) {
    const ins = store.insights('3m');
    const list = highlights(ix, ins) || [];
    const h = list.length ? list[dayNum(ix.today) % Math.min(3, list.length)] : null;
    line = highlightCopy(h, ix);
  } else {
    line = highlightCopy(null, ix);
  }
  return `
    <button type="button" class="card insights-teaser" id="insights-teaser" data-action="open-insights" aria-label="Open Insights" aria-describedby="it-line">
      <span class="card-head it-head"><span class="label">Insights</span><span class="it-more">See all${icon('chevronRight')}</span></span>
      ${weekStripHTML(recentWeeks(ix, 26))}
      <span class="it-line" id="it-line">
        <span class="type-badge c-${line.color}" aria-hidden="true">${icon(line.icon)}</span>
        <span class="it-text"><span class="it-title">${esc(line.title)}</span><span class="it-sub">${esc(line.sub)}</span></span>
      </span>
    </button>`;
}

/** Home: "Your 2026 in Glow is ready · Unwrap" while the year is in season and unseen. */
export function recapPillHTML() {
  const ix = store.insightIndex();
  if (!ix.first) return '';
  const Y = recapOffer(ix, recapSeen());
  if (!Y) return '';
  return `
    <div class="gift-pill recap-pill">
      <button type="button" class="rp-main" data-action="recap-open" data-year="${esc(Y)}">${icon('play')}<span>Your ${esc(Y)} in Glow<span class="rp-long"> is ready</span> · <b>Unwrap</b></span></button>
      <button type="button" class="rp-x" data-action="recap-dismiss" data-year="${esc(Y)}" aria-label="Not now">${icon('close')}</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Goals: trends card
// ---------------------------------------------------------------------------

/** Goals: "{avg} min / week", a delta chip and the last 8 weeks as mini bars. */
export function trendsTeaserHTML() {
  const ix = store.insightIndex();
  const head = `<span class="card-head"><span class="label">Trends</span><span class="it-more">Insights${icon('chevronRight')}</span></span>`;
  if (!ix.first) {
    return `
      <button type="button" class="card trends-teaser is-empty" id="trends-link" data-action="open-trends">
        ${head}<span class="tt-empty">Your trends start with your first workout</span>
      </button>`;
  }
  const ins = store.insights('3m');
  const weeks = (ins.series || []).slice(-8);
  const max = Math.max(1, ...weeks.map((b) => Math.max(b.min || 0, b.target || 0)));
  const bars = [
    ...Array.from({ length: 8 - weeks.length }, () => '<i class="tt-ghost" style="--h:.08"></i>'),
    ...weeks.map((b) => {
      const cls = b.partial ? 'tt-now' : b.met ? 'tt-met' : 'tt-under';
      return `<i class="${cls}" style="--h:${Math.max(0.08, (b.min || 0) / max).toFixed(3)}"></i>`;
    }),
  ].join('');
  const avg = ins.avg;
  const cur = weeks[weeks.length - 1];
  const num = avg != null
    ? `<b>${fmtNum(avg)}</b> min / week`
    : `<b>${fmtNum(cur?.min || 0)}</b> min this week`;
  const aria = `Trends: ${avg != null ? `${fmtNum(avg)} minutes a week on average` : `${fmtNum(cur?.min || 0)} minutes this week`}. Open Insights`;
  return `
    <button type="button" class="card trends-teaser" id="trends-link" data-action="open-trends" aria-label="${esc(aria)}">
      ${head}
      <span class="tt-body">
        <span class="tt-left">
          <span class="tt-num">${num}</span>
          ${avg != null ? deltaChip(ins.kpis?.delta?.min) : ''}
        </span>
        <span class="mini-bars tt-bars" aria-hidden="true">${bars}</span>
      </span>
      <span class="tt-cap">Last 8 weeks · glowing bars hit your minutes goal</span>
    </button>`;
}
