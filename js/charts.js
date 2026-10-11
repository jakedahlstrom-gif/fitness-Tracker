// Insights charts: Chart.js (pinned UMD + SRI, loaded on demand), colors read from
// the CSS tokens, the "Minutes per week" bars and the "Workout mix" donut, and the
// CSS fallbacks both start as. Every chart renders as HTML first and is upgraded in
// place once Chart.js is ready, so a blocked CDN or an offline first visit still
// shows a full, accessible card.

import { store } from './store.js';
import { icon } from './icons.js';
import { segmented } from './components.js';
import { mixHex } from './badgeArt.js';
import { esc, fmtNum, prefersReducedMotion } from './util.js';
import { parseKey, addDays, fmtWeekRange } from './dates.js';

// Keep CHART_URL identical to the allowlisted URL in sw.js.
export const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.js';
export const CHART_SRI = 'sha384-4W8gMhOYqk0FPg9sAMkb3g/P2fXtzbUyDUUgMlA1EEig8z/U/13EYUjErc1H382b';

// ---- Loader ----

let status = 'idle';
let pending = null;
let disabled = false;
const statusFns = new Set();
const prepared = new WeakSet();

function setStatus(next) {
  if (next === status) return;
  status = next;
  for (const fn of statusFns) {
    try { fn(next); } catch { /* one card failing never blocks the other */ }
  }
}

/** 'idle' | 'loading' | 'ready' | 'failed' */
export const chartStatus = () => status;

/** Lab "Charts offline" toggle: while on, loadChart() resolves null for the session. */
export function setChartsDisabled(on) {
  disabled = !!on;
  if (disabled) setStatus('failed');
  else if (status === 'failed') setStatus('idle');
}

function adopt(Chart) {
  if (!prepared.has(Chart)) {
    prepared.add(Chart);
    try {
      const d = Chart.defaults;
      d.font.family = getComputedStyle(document.body).fontFamily;
      d.font.size = 11;
      d.font.weight = '600';
      d.color = chartTheme().text3;
      if (prefersReducedMotion()) d.animation = false;
    } catch { /* defaults are cosmetic */ }
  }
  setStatus('ready');
  return Chart;
}

/**
 * Load Chart.js once (memoized). Resolves the Chart class, or null when the CDN is
 * blocked, the integrity check fails, or `timeout` ms pass; a later call retries.
 */
export function loadChart({ timeout = 8000 } = {}) {
  if (disabled) { setStatus('failed'); return Promise.resolve(null); }
  if (window.Chart) return Promise.resolve(adopt(window.Chart));
  if (pending) return pending;
  setStatus('loading');
  pending = new Promise((resolve) => {
    const s = document.createElement('script');
    let timer = 0;
    const finish = () => {
      clearTimeout(timer);
      s.onload = s.onerror = null;
      if (window.Chart && !disabled) { resolve(adopt(window.Chart)); return; }
      s.remove();
      pending = null;
      // A slow script still runs after the timeout: upgrade the charts when it lands.
      s.onload = () => { if (window.Chart && !disabled) adopt(window.Chart); };
      setStatus('failed');
      resolve(null);
    };
    s.onload = finish;
    s.onerror = finish;
    timer = setTimeout(finish, timeout);
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.integrity = CHART_SRI;
    s.referrerPolicy = 'no-referrer';
    s.src = CHART_URL;
    document.head.append(s);
  });
  return pending;
}

const chartReady = () => !disabled && status === 'ready' && !!window.Chart;

// ---- Theme (read from CSS, never hard-coded) ----

const THEME_VARS = {
  text: '--text', text2: '--text-2', text3: '--text-3', card: '--card', card2: '--card-2', card3: '--card-3',
  pink: '--pink', cyan: '--cyan', purple: '--purple', lime: '--lime', orange: '--orange', yellow: '--yellow', blue: '--blue',
};

/** Any CSS color the tokens use (#RGB, #RRGGBB, rgb()) as #RRGGBB for mixHex. */
function toHex(value) {
  const s = String(value || '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return `#${m[1].split('').map((c) => c + c).join('')}`;
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return `#${[m[1], m[2], m[3]].map((n) => Math.round(+n).toString(16).padStart(2, '0')).join('')}`;
  return '#808080';
}

/** '#RRGGBB' at opacity `a` as an rgba() string (canvas color-mix isn't reliable). */
export function alpha(hex, a) {
  const h = toHex(hex);
  return `rgba(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')}, ${a})`;
}

/** Current theme + palette colors for canvas drawing. A–D alias pink, cyan, purple, lime. */
export function chartTheme() {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const T = { light: root.dataset.glowTheme === 'light' };
  for (const [k, v] of Object.entries(THEME_VARS)) T[k] = toHex(cs.getPropertyValue(v));
  T.border = cs.getPropertyValue('--border').trim() || alpha(T.text, 0.08);
  const g = parseFloat(cs.getPropertyValue('--glow-a'));
  T.glowA = Number.isFinite(g) ? g : 0.5;
  T.A = T.pink; T.B = T.cyan; T.C = T.purple; T.D = T.lime;
  T.font = getComputedStyle(document.body).fontFamily;
  return T;
}

const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

function tooltipStyle(T) {
  return {
    backgroundColor: T.card3, borderColor: T.border, borderWidth: 1, cornerRadius: 12,
    padding: { top: 10, bottom: 10, left: 12, right: 12 },
    titleColor: T.text2, titleFont: { size: 12, weight: '600' }, titleMarginBottom: 4,
    bodyColor: T.text, bodyFont: { size: 15, weight: '700' },
    footerColor: T.text2, footerFont: { size: 12, weight: '600' }, footerMarginTop: 4,
    displayColors: false, caretSize: 6, caretPadding: 8,
  };
}

// ---- Shared bits ----

let lastIns = null;   // the ins the card HTML was last built from (createChartCards default)
let mixBy = 'count';  // Count/Time choice, kept for the session

const monthShort = (d) => d.toLocaleDateString(undefined, { month: 'short' });

function deltaChip(d) {
  if (d == null || !Number.isFinite(d)) return '';
  const p = Math.round(Math.abs(d) * 100);
  if (p < 1) return '<span class="ch-delta flat" aria-label="About the same as the period before">—</span>';
  return d > 0
    ? `<span class="ch-delta up" aria-label="Up ${p}% on the period before">▲ ${fmtNum(p)}%</span>`
    : `<span class="ch-delta down" aria-label="Down ${p}% on the period before">▼ ${fmtNum(p)}%</span>`;
}

function countUp(el, to, fmt, ms = 700) {
  if (!el) return;
  if (prefersReducedMotion() || !to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    if (!el.isConnected) return;
    const p = Math.min(1, (t - t0) / ms);
    el.textContent = fmt(to * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = fmt(0);
  requestAnimationFrame(step);
}

// ---- Minutes per week: model + HTML ----

const CSS_BARS = 26;
const GHOST = [28, 40, 22, 36, 45, 30, 20, 38];
const BAR = { grouped: false, borderRadius: 6, borderSkipped: 'start', barPercentage: 0.72, categoryPercentage: 0.9, maxBarThickness: 22 };

function barsModel(ins) {
  const b = Array.isArray(ins?.series) ? ins.series : [];
  const unit = ins?.r?.unit === 'month' ? 'month' : 'week';
  let n = 0;
  let min = 0;
  for (const x of b) { n += x.n || 0; min += x.min || 0; }
  return {
    b, unit,
    empty: n === 0 ? 'none' : min === 0 ? 'untimed' : '',
    best: b.findIndex((x) => x.best),
    avg: ins?.avg ?? null,
    delta: ins?.kpis?.delta?.min ?? null,
  };
}

function barsSig(ins) {
  const m = barsModel(ins);
  return [ins?.sig?.series ?? JSON.stringify(m.b), m.unit, m.avg == null ? '' : Math.round(m.avg),
    m.delta == null ? '' : Math.round(m.delta * 100)].join('|');
}

/** Solid (dataset 0) bars: weekly when the goal is met; monthly every finished month. */
const solid = (unit, x) => (unit === 'month' ? !x.partial : !!x.met);

/** Sparse x labels: the week holding the 1st of a month gets that month's name. */
function axisLabels(b, unit) {
  const out = b.map(() => '');
  if (!b.length) return out;
  if (unit === 'month') {
    b.forEach((x, i) => { const d = parseKey(x.from); if (d.getMonth() === 0) out[i] = String(d.getFullYear()); });
    if (!out.slice(0, 4).some(Boolean)) {
      const d = parseKey(b[0].from);
      out[0] = `${monthShort(d)} ’${String(d.getFullYear()).slice(2)}`;
    }
    return out;
  }
  if (b.length <= 4) return b.map((x) => parseKey(x.from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  const every = b.length > 30 ? 2 : 1;
  b.forEach((x, i) => {
    const from = parseKey(x.from);
    const end = addDays(from, 6);
    const first = from.getDate() === 1 ? from
      : end.getMonth() !== from.getMonth() ? new Date(end.getFullYear(), end.getMonth(), 1) : null;
    if (first && first.getMonth() % every === 0) out[i] = monthShort(first);
  });
  if (!out.slice(0, every === 2 ? 8 : 3).some(Boolean)) out[0] = monthShort(parseKey(b[0].from));
  return out;
}

function bucketTitle(x, unit) {
  if (!x) return '';
  const d = parseKey(x.from);
  return unit === 'month' ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : fmtWeekRange(d);
}

const bucketLine = (x) => (x ? `${fmtNum(x.min)} min · ${fmtNum(x.n)} ${x.n === 1 ? 'workout' : 'workouts'}` : '');

function bucketFoot(x, unit) {
  if (!x) return '';
  if (unit === 'month') return x.partial ? 'This month so far' : '';
  if (x.met) return 'Goal met ✓';
  if (x.partial) return 'This week so far';
  return x.target ? `${fmtNum(x.target - x.min)} min short` : '';
}

function niceScale(max) {
  const raw = Math.max(max, 1) / 3;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw));
  return { step, top: Math.ceil(Math.max(max, 1) / step) * step };
}

/** The CSS bars: the last 26 buckets, goal line, ticks and month labels. */
function barsCSS(m) {
  const b = m.b.slice(-CSS_BARS);
  const off = m.b.length - b.length;
  const labels = axisLabels(b, m.unit);
  const goal = m.unit === 'week' ? b[b.length - 1]?.target || 0 : 0;
  const { step, top } = niceScale(Math.max(goal, ...b.map((x) => x.min || 0)) * 1.08);
  const pct = (v) => `${((Math.min(v, top) / top) * 100).toFixed(2)}%`;
  const ticks = [];
  for (let v = step; v <= top; v += step) ticks.push(v);
  const cols = b.map((x, i) => {
    const cls = solid(m.unit, x) ? 'met' : x.partial ? 'cur' : 'under';
    const h = pct(x.min || 0);
    return `<span class="bc-col"><i class="bc-bar ${cls}" style="--h:${h};--i:${i}"></i>${off + i === m.best
      ? `<em class="bc-best" style="--h:${h};--i:${i}">BEST</em>` : ''}</span>`;
  }).join('');
  return `<div class="bars-css" aria-hidden="true" style="--n:${b.length}">
      <div class="bc-plot">
        ${ticks.map((v) => `<i class="bc-tick" style="bottom:${pct(v)}"><b>${fmtNum(v)}</b></i>`).join('')}
        <i class="bc-tick bc-zero"><b>0</b></i>
        ${goal ? `<i class="bc-goal" style="bottom:${pct(goal)}"></i>` : ''}
        <div class="bc-cols">${cols}</div>
      </div>
      <div class="bc-axis">${labels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
    </div>`;
}

function ghostHTML(msg) {
  return `<div class="ch-ghost" aria-hidden="true">${GHOST.map((h) => `<i style="height:${h}%"></i>`).join('')}</div>
    <p class="ch-empty-msg">${esc(msg)}</p>`;
}

function barsBoxHTML(m) {
  if (m.empty) {
    return ghostHTML(m.empty === 'none' ? 'Log a workout to start the chart' : 'Add a duration when you log to see minutes here.');
  }
  return `<div class="ch-shimmer" aria-hidden="true"></div>${barsCSS(m)}<div class="ch-canvas"></div>`;
}

function summaryHTML(m) {
  const show = m.avg != null && !m.empty;
  return `<div class="ch-summary"${show ? '' : ' hidden'}>
      <b class="ch-avg">${show ? fmtNum(m.avg) : ''}</b><span class="ch-avg-unit">min / week avg</span>${show ? deltaChip(m.delta) : ''}
    </div>`;
}

function tableHTML(m) {
  if (m.empty) return '';
  const weekly = m.unit === 'week';
  const met = (x) => (x.met ? 'Yes' : x.partial ? 'In progress' : x.target ? 'No' : '—');
  return `<table>
      <caption>Minutes per ${m.unit}</caption>
      <thead><tr><th scope="col">${weekly ? 'Week' : 'Month'}</th><th scope="col">Minutes</th><th scope="col">Workouts</th>${weekly ? '<th scope="col">Goal met</th>' : ''}</tr></thead>
      <tbody>${m.b.map((x) => `<tr><th scope="row">${esc(bucketTitle(x, m.unit))}</th><td>${fmtNum(x.min)}</td><td>${fmtNum(x.n)}</td>${weekly ? `<td>${met(x)}</td>` : ''}</tr>`).join('')}</tbody>
    </table>`;
}

const goalKey = (m) => m.unit === 'week' && !m.empty;

/** The complete "Minutes per week / month" card (§4.6). */
export function minutesCardHTML(ins) {
  lastIns = ins;
  const m = barsModel(ins);
  return `<section class="card ch-card" id="ins-minutes" aria-labelledby="ins-minutes-title" data-sig="${esc(barsSig(ins))}">
    <div class="card-head">
      <h2 class="label" id="ins-minutes-title">Minutes per ${m.unit}</h2>
      <span class="ch-goal-key"${goalKey(m) ? '' : ' hidden'} aria-hidden="true"><i></i>goal</span>
    </div>
    ${summaryHTML(m)}
    <div class="chart-box bars" data-state="${m.empty ? 'empty' : 'wait'}">${barsBoxHTML(m)}</div>
    <div class="ch-sr" data-ch-table>${tableHTML(m)}</div>
  </section>`;
}

// ---- Workout mix: model + HTML ----

const DUP = [100, 70, 50, 35]; // % of the color kept for the 1st, 2nd, 3rd… type sharing it

function typeOf(id) {
  if (id === '__more') return { id, label: 'More', icon: 'sparkle', color: null };
  if (id === '__unknown') return { id, label: 'Workout', icon: 'star', color: 'pink' };
  return store.typeById(id);
}

function mixModel(ins) {
  const mc = ins?.mix?.count || { rows: [], total: 0 };
  const mm = ins?.mix?.min;
  const canTime = !!mm && mm.canTime !== false && mm.by === 'min';
  const by = canTime && mixBy === 'min' ? 'min' : 'count';
  const src = by === 'min' ? mm : mc;
  const rows = (src.rows || []).filter((r) => r.value > 0);
  const types = rows.map((r) => typeOf(r.typeId));
  const seen = new Map();
  const shades = types.map((t) => {
    if (!t.color) return { name: null, k: 0 };
    const k = seen.get(t.color) || 0;
    seen.set(t.color, k + 1);
    return { name: t.color, k: Math.min(k, DUP.length - 1) };
  });
  const total = src.total || rows.reduce((s, r) => s + r.value, 0);
  return { by, canTime, rows, types, shades, total, empty: !rows.length };
}

function mixSig(ins, m) {
  return [ins?.sig?.mix ?? JSON.stringify(ins?.mix ?? null), m.by, m.types.map((t) => `${t.label}:${t.color}:${t.icon}`).join(',')].join('|');
}

/** Slice color as CSS (follows theme + palette on its own). */
function cssColor(s) {
  if (!s.name) return 'var(--text-3)';
  return s.k ? `color-mix(in srgb, var(--${s.name}) ${DUP[s.k]}%, var(--ch-shade))` : `var(--${s.name})`;
}

/** Slice color as a canvas hex from chartTheme(). */
function canvasColor(s, T) {
  if (!s.name) return T.text3;
  const c = T[s.name] || T.pink;
  return s.k ? mixHex(c, DUP[s.k], T.light ? '#000000' : '#FFFFFF') : c;
}

function pctText(share) {
  const p = share * 100;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/** Conic fallback with ~1% gaps; unselected slices fade while one is selected. */
function conicCSS(m, sel = null) {
  const n = m.rows.length;
  const gap = n > 1 ? 1 : 0;
  let at = 0;
  const parts = [];
  m.rows.forEach((r, i) => {
    const end = i === n - 1 ? 100 : at + r.share * 100;
    const fill = Math.max(at + 0.3, end - gap);
    const c = sel == null || sel === i ? cssColor(m.shades[i]) : `color-mix(in srgb, ${cssColor(m.shades[i])} 30%, transparent)`;
    parts.push(`${c} ${at.toFixed(2)}% ${fill.toFixed(2)}%`, `transparent ${fill.toFixed(2)}% ${end.toFixed(2)}%`);
    at = end;
  });
  return `conic-gradient(${parts.join(', ')})`;
}

function centerTotal(m) {
  if (m.by === 'min' && m.total >= 60) {
    const h = m.total / 60;
    return { value: h, unit: h === 1 ? 'hour' : 'hours', fmt: (v) => (h < 10 ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : fmtNum(v)) };
  }
  const unit = m.by === 'min' ? 'minutes' : m.total === 1 ? 'workout' : 'workouts';
  return { value: m.total, unit, fmt: (v) => fmtNum(v) };
}

function selHTML(m, i) {
  const t = m.types[i];
  return `<span class="type-badge ch-badge" style="--c:${cssColor(m.shades[i])}">${icon(t.icon)}</span>
    <b>${pctText(m.rows[i].share)}</b><span class="dc-unit">${esc(t.label)}</span>`;
}

function centerHTML(m) {
  const c = centerTotal(m);
  return `<div class="dc-total"><b class="dc-num">${c.fmt(c.value)}</b><span class="dc-unit">${c.unit}</span></div>
    <div class="dc-sel"></div>`;
}

function legendHTML(m) {
  return m.rows.map((r, i) => `
    <button type="button" class="mix-row" data-mix-sel="${i}" aria-pressed="false" style="--c:${cssColor(m.shades[i])}">
      <i class="mix-dot"></i><span class="mix-name">${esc(m.types[i].label)}</span><span class="mix-pct">${pctText(r.share)}</span>
    </button>`).join('');
}

function mixLine(m) {
  if (m.empty) return 'Your mix fills in as you log.';
  if (m.rows.length === 1) return `All ${esc(m.types[0].label)}, all the time.`;
  const more = m.rows.find((r) => r.typeId === '__more');
  const k = more ? m.rows.length - 1 + (more.ids?.length || 2) : m.rows.length;
  return `<b>${esc(m.types[0].label)}</b> is your go-to · ${k} types`;
}

const legendLabel = (m) => `Workout mix by ${m.by === 'min' ? 'time' : 'count'}: ${centerTotal(m).fmt(centerTotal(m).value)} ${centerTotal(m).unit}`;

/** The complete "Workout mix" card (§4.7). */
export function mixCardHTML(ins) {
  lastIns = ins;
  const m = mixModel(ins);
  return `<section class="card ch-card" id="ins-mix" aria-labelledby="ins-mix-title" data-sig="${esc(mixSig(ins, m))}">
    <div class="card-head">
      <h2 class="label" id="ins-mix-title">Workout mix</h2>
      <div class="ch-by"${m.canTime ? '' : ' hidden'}>${segmented('mix-by', [['count', 'Count'], ['min', 'Time']], m.by, { ariaLabel: 'Measure the mix by' })}</div>
    </div>
    <div class="mix-body">
      <div class="chart-box donut-wrap" data-state="${m.empty ? 'empty' : 'wait'}" style="--halo:${m.empty ? 'transparent' : cssColor(m.shades[0])}">
        <div class="ch-shimmer" aria-hidden="true"></div>
        <div class="donut-css" aria-hidden="true" style="background-image:${m.empty ? 'none' : conicCSS(m)}"></div>
        <div class="ch-canvas"></div>
        <div class="donut-center" aria-hidden="true">${centerHTML(m)}</div>
      </div>
      <div class="mix-legend" role="group" aria-label="${esc(legendLabel(m))}">${legendHTML(m)}</div>
    </div>
    <p class="mix-line">${mixLine(m)}</p>
  </section>`;
}

// ---- Chart.js configs and inline plugins ----

const glowPlugin = {
  id: 'glow',
  beforeDatasetDraw(chart, args, o) {
    if (!o?.color || o.dataset !== args.index) return;
    chart.ctx.save();
    chart.ctx.shadowColor = o.color;
    chart.ctx.shadowBlur = (o.blur || 12) * (chart.currentDevicePixelRatio || 1); // shadows ignore the transform
  },
  afterDatasetDraw(chart, args, o) {
    if (o?.color && o.dataset === args.index) chart.ctx.restore();
  },
};

/** Dashed goal line that steps with each week's own target. */
const goalPlugin = {
  id: 'goal',
  afterDatasetsDraw(chart, args, o) {
    const vals = o?.values;
    if (!vals?.length) return;
    const { ctx, chartArea, scales: { x, y } } = chart;
    const w = (chartArea.right - chartArea.left) / vals.length;
    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top - 2, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top + 2);
    ctx.clip();
    ctx.strokeStyle = o.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    let prev = null;
    vals.forEach((v, i) => {
      if (!(v > 0)) { prev = null; return; }
      const cx = x.getPixelForValue(i);
      const yy = Math.round(y.getPixelForValue(v)) + 0.5;
      if (prev == null) ctx.moveTo(cx - w / 2, yy);
      else if (prev !== yy) ctx.lineTo(cx - w / 2, yy);
      ctx.lineTo(cx + w / 2, yy);
      prev = yy;
    });
    ctx.stroke();
    ctx.restore();
  },
};

/** "BEST" over the best bar (letter-spaced by hand; canvas letterSpacing is new). */
const bestPlugin = {
  id: 'best',
  afterDatasetsDraw(chart, args, o) {
    if (o?.index == null || o.index < 0) return;
    const el = [0, 1].map((d) => chart.getDatasetMeta(d)?.data?.[o.index])
      .find((e, d) => e && chart.data.datasets[d]?.data?.[o.index] != null);
    if (!el || !Number.isFinite(el.y)) return;
    const { ctx } = chart;
    ctx.save();
    ctx.font = `800 9px ${o.font}`;
    ctx.fillStyle = o.color;
    ctx.textBaseline = 'bottom';
    const chars = [...'BEST'];
    const track = 0.9;
    const width = chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + track * (chars.length - 1);
    let at = el.x - width / 2;
    for (const c of chars) { ctx.fillText(c, at, el.y - 6); at += ctx.measureText(c).width + track; }
    ctx.restore();
  },
};

function gradC(c, u) {
  const { chart } = c;
  const area = chart.chartArea;
  if (!area) return undefined;
  const key = `${area.top}|${area.bottom}|${u.T.C}`;
  if (u.gradKey !== key) {
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, mixHex(u.T.C, 85, '#FFFFFF'));
    g.addColorStop(0.7, u.T.C);
    g.addColorStop(1, alpha(u.T.C, 0.55));
    u.grad = g;
    u.gradKey = key;
  }
  return u.grad;
}

/** 8×8 pattern: a 45° line of C at .7 over C at .18 ("this week, still going"). */
function hatch(c, u) {
  if (u.hatchKey !== u.T.C) {
    const r = dpr();
    const s = Math.round(8 * r);
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const x = cv.getContext('2d');
    x.fillStyle = alpha(u.T.C, 0.18);
    x.fillRect(0, 0, s, s);
    x.strokeStyle = alpha(u.T.C, 0.7);
    x.lineWidth = 1.5 * r;
    x.beginPath();
    for (const k of [-s, 0, s]) { x.moveTo(k, s); x.lineTo(k + s, 0); }
    x.stroke();
    const p = c.chart.ctx.createPattern(cv, 'repeat');
    if (p?.setTransform && typeof window.DOMMatrix === 'function') p.setTransform(new window.DOMMatrix().scale(1 / r));
    u.hatch = p;
    u.hatchKey = u.T.C;
  }
  return u.hatch || alpha(u.T.C, 0.3);
}

function barConfig(u, animate) {
  const { m, T } = u;
  const n = m.b.length;
  const last = n - 1;
  const axis = axisLabels(m.b, m.unit);
  const goals = m.unit === 'week' ? m.b.map((x) => x.target ?? null) : null;
  const maxGoal = goals ? Math.max(0, ...goals.filter(Number.isFinite)) : 0;
  const solidFill = (c) => gradC(c, u);
  const underFill = (c) => (c.dataIndex === last && m.b[last]?.partial ? hatch(c, u) : alpha(T.C, 0.42));
  return {
    type: 'bar',
    data: {
      labels: m.b.map((x) => x.key),
      datasets: [
        { data: m.b.map((x) => (solid(m.unit, x) ? x.min : null)), backgroundColor: solidFill, hoverBackgroundColor: solidFill, ...BAR },
        { data: m.b.map((x) => (solid(m.unit, x) ? null : x.min)), backgroundColor: underFill, hoverBackgroundColor: underFill, ...BAR },
      ],
    },
    options: {
      maintainAspectRatio: false,
      devicePixelRatio: dpr(),
      layout: { padding: { top: 18 } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { display: false }, border: { display: false },
          ticks: { maxRotation: 0, autoSkip: false, color: T.text3, font: { size: 10 }, callback: (v, i) => axis[i] || '' },
        },
        y: {
          position: 'right', beginAtZero: true, grace: '8%', suggestedMax: maxGoal || undefined,
          grid: { color: T.border, drawTicks: false }, border: { display: false },
          ticks: { maxTicksLimit: 4, padding: 6, precision: 0, color: T.text3, font: { size: 10 }, callback: (v) => fmtNum(v) },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(T),
          filter: (item) => item.raw != null,
          callbacks: {
            title: (items) => bucketTitle(m.b[items[0]?.dataIndex], m.unit),
            label: (item) => bucketLine(m.b[item.dataIndex]),
            footer: (items) => bucketFoot(m.b[items[0]?.dataIndex], m.unit),
          },
        },
        glow: { dataset: 0, color: alpha(T.C, T.glowA * 0.8), blur: 12 },
        goal: { values: goals, color: alpha(T.text2, 0.55) },
        best: { index: m.best, color: T.C, font: T.font },
      },
      animation: animate ? {
        duration: 700, easing: 'easeOutCubic',
        delay: (c) => (c.type === 'data' && c.mode === 'default' ? c.dataIndex * Math.min(18, 360 / Math.max(1, n)) : 0),
      } : false,
    },
    plugins: [glowPlugin, goalPlugin, bestPlugin],
  };
}

function donutColors(u) {
  return u.m.shades.map((s, i) => {
    const c = canvasColor(s, u.T);
    return u.sel == null || u.sel === i ? c : alpha(c, 0.3);
  });
}

function donutConfig(u, animate) {
  const { m } = u;
  const colors = donutColors(u);
  const many = m.rows.length > 1;
  return {
    type: 'doughnut',
    data: {
      labels: m.rows.map((r) => r.typeId),
      datasets: [{
        data: m.rows.map((r) => r.value), backgroundColor: colors, hoverBackgroundColor: colors,
        borderWidth: 0, borderRadius: many ? 6 : 0, spacing: many ? 3 : 0, hoverOffset: 6,
      }],
    },
    options: {
      maintainAspectRatio: false,
      devicePixelRatio: dpr(),
      cutout: '72%',
      layout: { padding: 8 },
      events: ['click'],
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: animate ? { animateRotate: true, animateScale: false, duration: 900, easing: 'easeOutQuart' } : false,
      // Chart.js sets its own active element after onClick returns, so select on the next microtask.
      onClick: (e, els) => { const i = els[0]?.index ?? null; Promise.resolve().then(() => u.pick?.(i)); },
    },
  };
}

// ---- Controller ----

/**
 * Bring the two chart cards inside `root` to life: shimmer → Chart.js or the CSS
 * fallback (§4.11), in-place updates, Count/Time, slice selection, recolor on
 * 'glow:look', and the "Simple charts while offline · Retry" note in
 * [data-charts-note]. Call update(ins) on every patch; destroy() when leaving.
 */
export function createChartCards(root, ins = lastIns) {
  let alive = true;
  let autoRetried = false;
  let noteOn = false;
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(onSeen, { threshold: 0.25 }) : null;
  const unit = (kind) => ({
    kind, card: null, box: null, chart: null, state: 'wait', played: false, visible: !io,
    broken: false, timer: 0, sig: '', m: null, sel: null, T: null,
  });
  const units = [unit('minutes'), unit('mix')];
  const [bars, mix] = units;
  mix.pick = (i) => { if (alive) select(i); };

  const setState = (u, s) => { u.state = s; if (u.box) u.box.dataset.state = s; };

  function dropChart(u) {
    if (u.chart) {
      try { u.chart.destroy(); } catch { /* already gone */ }
      u.chart = null;
    }
    u.box?.querySelector('.ch-canvas')?.replaceChildren();
  }

  function release(u) {
    clearTimeout(u.timer);
    if (u.card) io?.unobserve(u.card);
    dropChart(u);
  }

  /** (Re)attach to the card's current element; a re-rendered card starts its timeline over. */
  function bind(u) {
    const card = root.querySelector(`#ins-${u.kind}`);
    if (card === u.card && card?.isConnected) return;
    release(u);
    Object.assign(u, { card, box: card?.querySelector('.chart-box') || null, sig: card?.dataset.sig || '', m: null,
      played: false, broken: false, sel: null, visible: !io, gradKey: '', hatchKey: '' });
    if (!card || !u.box) return;
    u.state = u.box.dataset.state || 'wait';
    io?.observe(card);
    if (u.state === 'wait' && status === 'failed') setState(u, 'css');
    u.timer = setTimeout(() => { u.timer = 0; if (u.state === 'wait') setState(u, 'css'); tick(u); }, 600);
  }

  function onSeen(entries) {
    for (const e of entries) {
      const u = units.find((x) => x.card === e.target);
      if (!u) continue;
      u.visible = e.isIntersecting && e.intersectionRatio >= 0.2;
      if (u.visible) tick(u);
    }
  }

  /** Advance one card's timeline: build the chart when ready and seen, else play the fallback. */
  function tick(u) {
    if (!alive || !u.m || !u.box?.isConnected || u.state === 'empty' || u.state === 'chart') return;
    if (u.visible && chartReady() && !u.broken) build(u);
    else if (u.state === 'css' && u.visible && !u.played) play(u);
  }

  function play(u) {
    u.played = true;
    u.box.classList.add('play');
    if (u.kind === 'mix') countCenter(u);
  }

  function build(u) {
    const host = u.box.querySelector('.ch-canvas');
    if (!host || !window.Chart) return;
    const late = u.played; // its fallback was already on screen: crossfade, no second entrance
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    host.replaceChildren(canvas);
    u.T = chartTheme();
    try {
      const cfg = u.kind === 'minutes' ? barConfig(u, !late && !prefersReducedMotion()) : donutConfig(u, !late && !prefersReducedMotion());
      u.chart = new window.Chart(canvas, cfg);
    } catch {
      u.chart = null;
      u.broken = true;
      host.replaceChildren();
      if (u.state === 'wait') setState(u, 'css');
      tick(u);
      return;
    }
    u.box.classList.toggle('fade', late);
    u.played = true;
    setState(u, 'chart');
    if (u.kind === 'mix') {
      if (u.sel != null) paintSelection(u);
      if (!late) countCenter(u);
    }
  }

  /** Push new data/colors into a live chart without rebuilding it. */
  function refresh(u, mode) {
    const { chart } = u;
    const animate = mode !== 'none' && !prefersReducedMotion();
    const cfg = u.kind === 'minutes' ? barConfig(u, animate) : donutConfig(u, animate);
    chart.data.labels = cfg.data.labels;
    cfg.data.datasets.forEach((ds, i) => {
      if (chart.data.datasets[i]) Object.assign(chart.data.datasets[i], ds);
      else chart.data.datasets.push(ds);
    });
    chart.options = cfg.options;
    if (u.kind === 'mix') chart.setActiveElements(u.sel == null ? [] : [{ datasetIndex: 0, index: u.sel }]);
    chart.update(mode);
  }

  function countCenter(u) {
    const c = centerTotal(u.m);
    countUp(u.card?.querySelector('.dc-num'), c.value, c.fmt);
  }

  // -- Minutes card --

  function updateBars(ins) {
    const u = bars;
    bind(u);
    if (!u.card) return;
    const m = barsModel(ins);
    const sig = barsSig(ins);
    if (sig === u.sig && u.m) return;
    const fresh = sig !== u.sig;
    u.m = m;
    u.sig = sig;
    if (!fresh) { tick(u); return; } // the markup was built from this same data
    u.card.dataset.sig = sig;
    u.card.querySelector('#ins-minutes-title').textContent = `Minutes per ${m.unit}`;
    u.card.querySelector('.ch-goal-key').hidden = !goalKey(m);
    u.card.querySelector('.ch-summary').outerHTML = summaryHTML(m);
    u.card.querySelector('[data-ch-table]').innerHTML = tableHTML(m);
    if (m.empty) {
      dropChart(u);
      u.box.classList.remove('play', 'fade', 'settled');
      setState(u, 'empty');
      u.box.innerHTML = barsBoxHTML(m);
      return;
    }
    if (u.state === 'empty') {
      u.box.innerHTML = barsBoxHTML(m);
      u.played = false;
      setState(u, 'css');
      tick(u);
      return;
    }
    const css = u.box.querySelector('.bars-css');
    if (css) css.outerHTML = barsCSS(m);
    if (u.played) u.box.classList.add('settled'); // redrawn in place, no second entrance
    if (u.chart) refresh(u);
    else tick(u);
  }

  // -- Mix card --

  function paintSelection(u) {
    const { m, sel, card } = u;
    if (!m || !card) return;
    card.querySelectorAll('.mix-row').forEach((b, i) => {
      b.classList.toggle('on', i === sel);
      b.classList.toggle('dim', sel != null && i !== sel);
      b.setAttribute('aria-pressed', String(i === sel));
    });
    const center = card.querySelector('.donut-center');
    if (sel != null) center.querySelector('.dc-sel').innerHTML = selHTML(m, sel);
    center.classList.toggle('sel', sel != null);
    const css = card.querySelector('.donut-css');
    if (css && !m.empty) css.style.backgroundImage = conicCSS(m, sel);
    if (u.chart) refresh(u);
  }

  function select(i) {
    const u = mix;
    if (!u.m || u.m.empty) return;
    u.sel = i == null || i === u.sel || i >= u.m.rows.length ? null : i;
    paintSelection(u);
  }

  function updateMix(ins) {
    const u = mix;
    bind(u);
    if (!u.card) return;
    const m = mixModel(ins);
    const sig = mixSig(ins, m);
    if (sig === u.sig && u.m) return;
    const fresh = sig !== u.sig;
    const keep = u.sel != null ? u.m?.rows[u.sel]?.typeId : null;
    u.m = m;
    u.sig = sig;
    if (!fresh) { tick(u); return; }
    const k = keep == null ? -1 : m.rows.findIndex((r) => r.typeId === keep);
    u.sel = k >= 0 ? k : null;
    u.card.dataset.sig = sig;
    const by = u.card.querySelector('.ch-by');
    by.hidden = !m.canTime;
    by.innerHTML = segmented('mix-by', [['count', 'Count'], ['min', 'Time']], m.by, { ariaLabel: 'Measure the mix by' });
    u.box.style.setProperty('--halo', m.empty ? 'transparent' : cssColor(m.shades[0]));
    u.card.querySelector('.donut-center').innerHTML = centerHTML(m);
    const legend = u.card.querySelector('.mix-legend');
    legend.innerHTML = legendHTML(m);
    legend.setAttribute('aria-label', legendLabel(m));
    u.card.querySelector('.mix-line').innerHTML = mixLine(m);
    const css = u.card.querySelector('.donut-css');
    css.style.backgroundImage = m.empty ? 'none' : conicCSS(m, u.sel);
    if (m.empty) {
      dropChart(u);
      u.box.classList.remove('play', 'fade', 'settled');
      setState(u, 'empty');
      return;
    }
    if (u.state === 'empty') {
      u.played = false;
      setState(u, 'css');
      tick(u);
      return;
    }
    if (u.played) u.box.classList.add('settled');
    paintSelection(u); // also refreshes a live chart
    if (!u.chart) tick(u);
  }

  function setMixBy(v) {
    if (v !== 'count' && v !== 'min') return;
    if (v === mixBy) return;
    mixBy = v;
    mix.sel = null;
    if (current) updateMix(current);
  }

  // -- Offline note --

  const needsChart = () => units.some((u) => u.card && u.m && !u.m.empty);
  const onScreen = () => root.isConnected && !root.closest('[hidden]');

  function paintNote() {
    const note = root.querySelector('[data-charts-note]');
    if (!note) return;
    const on = alive && needsChart() && (status === 'failed' || (noteOn && status === 'loading'));
    if (!on) {
      if (noteOn) { note.hidden = true; note.replaceChildren(); }
      noteOn = false;
      return;
    }
    const busy = status === 'loading';
    let btn = note.querySelector('[data-ch-retry]');
    if (!btn) {
      note.classList.add('ch-note');
      note.innerHTML = '<span>Simple charts while offline</span><span aria-hidden="true"> · </span><button type="button" class="ch-retry" data-ch-retry></button>';
      btn = note.querySelector('[data-ch-retry]');
    }
    btn.disabled = busy;
    btn.textContent = busy ? 'Retrying…' : 'Retry';
    note.hidden = false;
    noteOn = true;
  }

  function retry() {
    if (alive && status !== 'loading') loadChart();
  }

  function onStatus(s) {
    if (!alive) return;
    if (s === 'failed') {
      for (const u of units) {
        if (u.state === 'wait' && u.m) setState(u, 'css');
        tick(u);
      }
    } else if (s === 'ready') {
      units.forEach(tick);
    }
    paintNote();
  }

  function onOnline() {
    if (autoRetried || !noteOn || !onScreen()) return;
    autoRetried = true;
    retry();
  }

  function onClick(e) {
    const seg = e.target.closest('#ins-mix [data-action="mix-by"]');
    if (seg) { setMixBy(seg.dataset.value); return; }
    const row = e.target.closest('#ins-mix [data-mix-sel]');
    if (row) { select(Number(row.dataset.mixSel)); return; }
    if (e.target.closest('[data-ch-retry]')) retry();
  }

  function recolor() {
    if (!alive) return;
    const T = chartTheme();
    if (window.Chart && prepared.has(window.Chart)) window.Chart.defaults.color = T.text3;
    for (const u of units) {
      if (!u.chart) continue;
      u.T = T;
      refresh(u, 'none');
    }
  }

  let current = null;

  function update(next) {
    if (!alive || !next) return;
    current = next;
    updateBars(next);
    updateMix(next);
    if (needsChart() && status === 'idle') loadChart();
    paintNote();
  }

  function destroy() {
    if (!alive) return;
    alive = false;
    for (const u of units) { release(u); u.sel = null; }
    io?.disconnect();
    statusFns.delete(onStatus);
    document.removeEventListener('glow:look', recolor);
    window.removeEventListener('online', onOnline);
    root.removeEventListener('click', onClick);
  }

  statusFns.add(onStatus);
  document.addEventListener('glow:look', recolor);
  window.addEventListener('online', onOnline);
  root.addEventListener('click', onClick);
  units.forEach(bind);
  if (ins) update(ins);

  return { update, recolor, destroy };
}
