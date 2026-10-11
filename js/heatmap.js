// Glow calendar builders: month pages, mini months (SVG), the Home week strip and
// the cell labels. Pure string builders over the stats engine's grids (js/insights.js:
// monthGrid, yearMonths, recentWeeks). Heat colors come from CSS (css/insights.css):
// cells carry data-l="0..4", SVG rects carry classes hl0–hl4.

import { store } from './store.js';
import { icon } from './icons.js';
import { esc, plural } from './util.js';
import { parseKey } from './dates.js';

const fmt = (key, opts) => parseKey(key).toLocaleDateString(undefined, opts);

/** "October 2026" for a month key. */
export const monthTitle = (mk) => fmt(`${mk}-01`, { month: 'long', year: 'numeric' });
/** "Oct" for a month key. */
export const monthShort = (mk) => fmt(`${mk}-01`, { month: 'short' });
/** "October" for a month key. */
export const monthLong = (mk) => fmt(`${mk}-01`, { month: 'long' });

/** "Run and Yoga", "Run, Yoga and Walk". */
export function joinAnd(list) {
  if (list.length < 2) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** A day's type ids from the index, most-used first (count, then minutes). */
export function dayTypes(ix, key) {
  const types = ix?.days?.get(key)?.types;
  if (!types) return [];
  return [...types.entries()].sort((a, b) => b[1].n - a[1].n || b[1].min - a[1].min).map(([id]) => id);
}

/**
 * Screen-reader label for a calendar cell:
 * "Saturday, October 4: 2 workouts, 95 minutes, Run and Yoga, personal record".
 */
export function cellLabel(c, ix) {
  const day = fmt(c.key, { weekday: 'long', month: 'long', day: 'numeric' }) + (c.today ? ', today' : '');
  if (c.future) return day;
  if (c.n) {
    const parts = [plural(c.n, 'workout')];
    if (c.min) parts.push(plural(c.min, 'minute'));
    const names = dayTypes(ix, c.key).map((id) => store.typeById(id).label);
    if (names.length) parts.push(joinAnd(names));
    if (c.pr) parts.push('personal record');
    return `${day}: ${parts.join(', ')}`;
  }
  if (c.rest) return `${day}: rest day`;
  return `${day}: ${c.today ? 'no workout yet' : 'no workout'}`;
}

/**
 * The 42 cells of a month page (6 rows in week-start order). Days outside the month are
 * empty placeholders. Cells are buttons with a roving tabindex: only `focusKey` gets 0.
 * @param {object} grid  monthGrid() output
 * @param {object} [o]
 * @param {object} [o.ix]          the insight index (for type names in labels)
 * @param {string} [o.selected]    selected day key
 * @param {string} [o.focusKey]    the day that takes Tab focus
 * @param {boolean} [o.wave]       play the enter wave
 */
export function monthCellsHTML(grid, { ix = null, selected = null, focusKey = null, wave = false } = {}) {
  return grid.cells.map((c, i) => {
    if (!c.inMonth) return '<span class="hm-cell hm-out" aria-hidden="true"></span>';
    const cls = ['hm-cell'];
    if (c.today) cls.push('is-today');
    if (c.rest) cls.push('is-rest');
    if (c.future) cls.push('is-future');
    if (c.key === selected) cls.push('is-sel');
    const attrs = [
      `class="${cls.join(' ')}"`,
      `data-l="${c.future ? 0 : c.level}"`,
      `data-k="${c.key}"`,
      `tabindex="${c.key === focusKey ? 0 : -1}"`,
      `aria-label="${esc(cellLabel(c, ix))}"`,
    ];
    if (c.today) attrs.push('aria-current="date"');
    if (c.future) attrs.push('disabled');
    if (wave) attrs.push(`style="--w:${(Math.floor(i / 7) + (i % 7)) * 18}ms"`);
    return `<button type="button" ${attrs.join(' ')}><span class="hm-num" aria-hidden="true">${c.d}</span>${
      c.rest && !c.n ? icon('moon', 'hm-moon') : ''}${c.pr ? '<i class="hm-pr" aria-hidden="true"></i>' : ''}</button>`;
  }).join('');
}

/** One month page: a labelled group around the 42-cell grid. Same options as monthCellsHTML. */
export function monthPageHTML(grid, opts = {}) {
  const label = `${monthTitle(grid.key)}, ${plural(grid.totals?.active || 0, 'active day')}`;
  return `<div class="hm-grid${opts.wave ? ' wave' : ''}" role="group" aria-label="${esc(label)}">${monthCellsHTML(grid, opts)}</div>`;
}

/**
 * A month as a small SVG quilt (Insights year mode, the recap's squares slide).
 * Rects get `hl0`–`hl4` (+ `hlf` future, `hlt` today, `hlr` rest) and `data-k="YYYY-MM-DD"`.
 * The SVG has its natural pixel size as width/height; CSS may scale it (it keeps its viewBox).
 * @param {object} grid  monthGrid() output (or a yearMonths() entry)
 * @param {object} [o]
 * @param {number} [o.cell]   cell size in px (viewBox units)
 * @param {number} [o.gap]    gap between cells
 * @param {number} [o.radius] corner radius (default 24% of the cell)
 * @param {string} [o.className]
 * @param {(cell: object, index: number) => number} [o.delay]  per-rect `--d` in ms (for staggered reveals)
 * @returns {string}
 */
export function miniMonthSVG(grid, { cell = 10, gap = 2, radius = null, className = '', delay = null } = {}) {
  const step = cell + gap;
  const w = 7 * step - gap;
  const h = 6 * step - gap;
  const r = radius ?? Math.round(cell * 24) / 100;
  const rects = grid.cells.map((c, i) => {
    if (!c.inMonth) return '';
    let cls = `hl${c.future ? 0 : c.level}`;
    if (c.future) cls += ' hlf';
    if (c.today) cls += ' hlt';
    if (c.rest && !c.n) cls += ' hlr';
    const d = delay ? ` style="--d:${Math.round(delay(c, i))}ms"` : '';
    return `<rect class="${cls}" x="${(i % 7) * step}" y="${Math.floor(i / 7) * step}" width="${cell}" height="${cell}" rx="${r}" data-k="${c.key}"${d}/>`;
  }).join('');
  return `<svg class="hm-svg${className ? ` ${className}` : ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">${rects}</svg>`;
}

/**
 * The Home teaser's GitHub-style strip: one column per week (oldest → newest), 7 rows in
 * week-start order, and a month label over the column that holds each month's day 1.
 * CSS right-aligns the grid and clips old weeks that don't fit.
 * @param {{wk: string, cells: {key: string, level: number, today: boolean, future: boolean, rest: boolean}[]}[]} weeks  recentWeeks() output
 */
export function weekStripHTML(weeks) {
  const cols = weeks.map((w) => {
    const first = w.cells.find((c) => c.key.endsWith('-01'));
    const mark = first ? `<span class="hs-mark">${esc(monthShort(first.key.slice(0, 7)))}</span>` : '<span class="hs-mark"></span>';
    const cells = w.cells.map((c) => {
      let cls = 'hs-cell';
      if (c.today) cls += ' is-today';
      if (c.future) cls += ' is-future';
      else if (c.rest && !c.level) cls += ' is-rest';
      return `<i class="${cls}" data-l="${c.future ? 0 : c.level}"></i>`;
    }).join('');
    return mark + cells;
  }).join('');
  return `<span class="hs-strip" aria-hidden="true">${cols}</span>`;
}

/** "Less ▢▢▢▢▢ More · ☾ Rest" plus the scale line: "Squares fill at 1, 25, 50 and 75+ min". */
export function heatLegendHTML(scale) {
  const [t2, t3, t4] = scale || [25, 50, 75];
  return `
    <div class="hm-legend" aria-hidden="true">
      <span>Less</span>${[0, 1, 2, 3, 4].map((l) => `<i class="hm-sw" data-l="${l}"></i>`).join('')}<span>More</span>
      <span class="hm-leg-rest">${icon('moon')}Rest</span>
    </div>
    <p class="hm-scale">Squares fill at 1, ${t2}, ${t3} and ${t4}+ min</p>`;
}
