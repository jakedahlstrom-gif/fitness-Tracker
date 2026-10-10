// Reusable bits of UI markup: progress rings, type badges, segmented controls.

import { esc, clamp } from './util.js';
import { icon } from './icons.js';
import { store } from './store.js';

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
      <circle class="ring-arc c-${r.color}${p >= 1 ? ' closed' : ''}" cx="60" cy="60" r="${R}" stroke-width="${stroke}"
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
