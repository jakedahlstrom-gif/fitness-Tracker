// Reusable bits of UI markup: progress rings, type badges, segmented controls.

import { esc, clamp, fmtNum, kmToUnit } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';
import { parseKey, fmtShortDate } from './dates.js';

const RADII = [53, 40, 27]; // outer → inner, in a 120×120 viewBox

/**
 * Concentric neon rings.
 * @param {{color: string, value: number, target: number, from?: number}[]} rings  outer first
 * `from` is the previous progress (0–1) so the arc can animate from where it was.
 */
export function ringsSVG(rings, { stroke = 11, label = 'Weekly progress rings' } = {}) {
  const arcs = rings.map((r, i) => {
    const R = RADII[i];
    const C = 2 * Math.PI * R;
    const p = r.target > 0 ? clamp(r.value / r.target, 0, 1) : 0;
    const from = clamp(r.from ?? 0, 0, 1);
    return `
      <circle class="ring-track c-${r.color}" cx="60" cy="60" r="${R}" stroke-width="${stroke}"/>
      <circle class="ring-arc c-${r.color}${p >= 1 ? ' closed' : ''}${r.pop ? ' pop' : ''}" cx="60" cy="60" r="${R}" stroke-width="${stroke}"
        stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - from)).toFixed(2)}"
        data-to="${(C * (1 - p)).toFixed(2)}"${p === 0 && from === 0 ? ' opacity="0"' : ''}/>`;
  }).join('');
  return `<svg class="rings" viewBox="0 0 120 120" role="img" aria-label="${esc(label)}">
    <g transform="rotate(-90 60 60)">${arcs}</g></svg>`;
}

/** Single small ring with a centered label (used in stat tiles). */
export function miniRingSVG({ value, target, color = 'cyan', from = 0 }) {
  const R = 17;
  const C = 2 * Math.PI * R;
  const p = target > 0 ? clamp(value / target, 0, 1) : 0;
  return `<svg class="mini-ring" viewBox="0 0 44 44" aria-hidden="true">
    <g transform="rotate(-90 22 22)">
      <circle class="ring-track c-${color}" cx="22" cy="22" r="${R}" stroke-width="5"/>
      <circle class="ring-arc c-${color}${p >= 1 ? ' closed' : ''}" cx="22" cy="22" r="${R}" stroke-width="5"
        stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - from)).toFixed(2)}"
        data-to="${(C * (1 - p)).toFixed(2)}"${p === 0 && from === 0 ? ' opacity="0"' : ''}/>
    </g></svg>`;
}

/** After inserting ring markup, animate every arc to its target. */
export function animateRings(root) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('.ring-arc[data-to]').forEach((arc) => {
      arc.removeAttribute('opacity');
      arc.style.strokeDashoffset = arc.dataset.to;
    });
  }));
}

/** Rounded icon tile tinted with a workout type's color. */
export function typeBadge(typeId, size = '') {
  const t = store.typeById(typeId);
  return `<span class="type-badge ${size} c-${t.color}">${icon(t.icon)}</span>`;
}

/**
 * Segmented control. Options: [value, label][]; fires clicks with data-action/data-value.
 */
export function segmented(action, options, selected, { ariaLabel = '' } = {}) {
  return `<div class="segmented" role="radiogroup" aria-label="${esc(ariaLabel)}">${options.map(([v, label]) => `
    <button type="button" role="radio" aria-checked="${String(v) === String(selected)}" class="seg${String(v) === String(selected) ? ' on' : ''}"
      data-action="${action}" data-value="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
}

/** iOS-style on/off switch. */
export function toggle(action, on, label) {
  return `<button type="button" class="switch${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-action="${action}"><span></span></button>`;
}

// ---- Goals ----

/** Accent color per goal metric (matches the rings: workouts pink, minutes purple, days cyan). */
export const METRIC_COLOR = { workouts: 'pink', minutes: 'purple', days: 'cyan', distance: 'lime', longestDistance: 'orange' };

/** Unit word shown after a goal number ("min", "days", "mi"…). */
export function goalUnit(metric, value = 2) {
  if (metric === 'minutes') return 'min';
  if (metric === 'days') return value === 1 ? 'day' : 'days';
  if (metric === 'workouts') return value === 1 ? 'workout' : 'workouts';
  return store.settings.units;
}

/** A goal number in her units: distances converted from km, others rounded. */
export function goalNum(metric, value) {
  if (metric === 'distance' || metric === 'longestDistance') {
    const v = kmToUnit(value, store.settings.units);
    return String(Math.round(v * 10) / 10);
  }
  return fmtNum(value);
}

const RACES = [[5, 'First 5K'], [10, 'First 10K'], [21.0975, 'First half marathon'], [42.195, 'First marathon']];

/** Readable name for a goal, e.g. "600 min this month", "First 5K", "150 workouts in 2026". */
export function goalLabel(goal) {
  if (goal.name) return goal.name;
  const n = goal.target;
  const type = goal.typeId ? store.typeById(goal.typeId).label : '';
  let text;
  switch (goal.metric) {
    case 'workouts': text = `${fmtNum(n)} ${type ? `${type} ` : ''}${n === 1 ? 'workout' : 'workouts'}`; break;
    case 'minutes': text = `${fmtNum(n)} min${type ? ` of ${type}` : ''}`; break;
    case 'days': text = `${fmtNum(n)} active ${n === 1 ? 'day' : 'days'}`; break;
    case 'distance': text = `${type ? `${type} ` : ''}${goalNum('distance', n)} ${store.settings.units}`; break;
    case 'longestDistance': {
      const race = RACES.find(([km]) => Math.abs(n - km) <= km * 0.005);
      text = race ? race[1] : `One ${goalNum('longestDistance', n)} ${store.settings.units} ${type || 'workout'}`;
      break;
    }
    default: text = 'Goal';
  }
  if (goal.tier === 'short') return `${text} this week`;
  if (goal.tier === 'medium') return `${text} this month`;
  if (goal.start && goal.end) {
    const y = goal.start.slice(0, 4);
    if (goal.start === `${y}-01-01` && goal.end === `${y}-12-31`) return `${text} in ${y}`;
    return `${text} by ${fmtShortDate(parseKey(goal.end))}`;
  }
  return text;
}

/** "120 / 600 min" style progress text for a goal. */
export function goalProgressText(p) {
  return `${goalNum(p.metric, p.value)} / ${goalNum(p.metric, p.target)} ${goalUnit(p.metric, p.target)}`;
}
