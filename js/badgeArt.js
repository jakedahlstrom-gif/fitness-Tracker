// Badge artwork as inline SVG. Rarity sets the frame (circle, hexagon, shield,
// rosette) and its rim; the family sets the colors and glyph.
//
// Two modes:
//   badgeSVG(def, opts)            inline markup for the page; colors are CSS
//                                  variables so it follows the theme and palette
//   badgeSVG(def, { standalone })  self-contained markup with literal colors, for
//                                  turning into an <img> or drawing on a canvas

import { BADGE_BY_ID, badgeColors, badgeGlyph } from './badges.js';
import { iconMarkup } from './icons.js';
import { PALETTES } from './looks.js';
import { esc } from './util.js';

export const FIXED_COLORS = { orange: '#FF8A3D', yellow: '#FFD43B', blue: '#5B8CFF' };
const PALETTE_VAR = { pink: '--pink', cyan: '--cyan', purple: '--purple', lime: '--lime' };
export const HOLO = ['#FF5CC8', '#FFC85C', '#5CF2FF', '#B98CFF', '#FF5CC8'];
export const RARITY_COLOR = { common: 'cyan', rare: 'blue', epic: 'purple', legendary: 'yellow' };

/** Mix two #RRGGBB colors: `pct` percent of `a` over `b` (like CSS color-mix). */
export function mixHex(a, pct, b) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v * pct / 100 + y[i] * (1 - pct / 100)).toString(16).padStart(2, '0')).join('')}`;
}

/** A color name ('pink', 'orange'…) as a literal hex in a palette's dark set. */
export function hexOf(name, palette = 'glow') {
  if (FIXED_COLORS[name]) return FIXED_COLORS[name];
  const set = (PALETTES[palette] || PALETTES.glow).dark;
  return set[PALETTE_VAR[name]] || set['--pink'];
}

const ROSETTE = (() => {
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const a = ((-90 + 15 * i) * Math.PI) / 180;
    const r = i % 2 ? 41 : 48;
    pts.push(`${(50 + Math.cos(a) * r).toFixed(2)} ${(50 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
})();

/** Frame outline per rarity, in a 100×100 box. */
export const FRAME_PATHS = {
  common: 'M50 6 A44 44 0 1 1 49.99 6 Z',
  rare: 'M50 4 L89.8 27 V73 L50 96 L10.2 73 V27 Z',
  epic: 'M50 4 L87 15 V47 C87 70 71 87 50 96 C29 87 13 70 13 47 V15 Z',
  legendary: ROSETTE,
};

const RIM_WIDTH = { common: 4, rare: 5, epic: 6, legendary: 6 };
const SPECKS = [[30, 30, 3], [70, 28, 2.4], [24, 56, 2], [76, 58, 2.6], [36, 74, 2.2], [64, 76, 2.8]];
const SPARKLES = [[9, 14, 0], [91, 20, 0.8], [86, 90, 1.6]];
const fourPoint = (x, y, r) =>
  `M${x} ${y - r} L${x + r * 0.28} ${y - r * 0.28} L${x + r} ${y} L${x + r * 0.28} ${y + r * 0.28} L${x} ${y + r} L${x - r * 0.28} ${y + r * 0.28} L${x - r} ${y} L${x - r * 0.28} ${y - r * 0.28} Z`;

let seq = 0;

/**
 * @param {object|string} def  a badge definition (or its id)
 * @param {object} [o]
 * @param {'earned'|'locked'|'secret'|'new'} [o.state]
 * @param {number} [o.size]       rendered width/height in px
 * @param {number} [o.progress]   0–1, shown as an arc on locked badges
 * @param {boolean} [o.standalone]  literal colors and inline filters (for images/canvas)
 * @param {string} [o.palette]    palette for standalone colors (its dark set)
 * @param {string} [o.className]
 */
export function badgeSVG(def, { state = 'earned', size = 64, progress = 0, standalone = false, palette = 'glow', className = '', label = null } = {}) {
  if (typeof def === 'string') def = BADGE_BY_ID.get(def);
  if (!def) return '';
  const id = `ba${++seq}`;
  const rarity = def.rarity;
  const [c1, c2] = badgeColors(def);
  const col = (name) => (standalone ? hexOf(name, palette) : `var(--${name})`);
  const b1 = col(c1);
  const b2 = col(c2);
  const locked = state === 'locked' || state === 'secret';
  const shape = FRAME_PATHS[rarity] || FRAME_PATHS.common;
  const plate = def.plate || null;
  const legendary = rarity === 'legendary';

  // Colors for this state (standalone art is always the earned, dark-face look).
  const rimStroke = locked ? 'var(--border-strong)'
    : rarity === 'common' ? b1 : `url(#${id}-rim)`;
  const faceFill = locked ? 'var(--card-2)'
    : standalone ? mixHex(b1, 20, '#10131A') : null;
  const glyphColor = locked ? 'var(--text-3)' : b1;
  const plateFill = locked ? 'var(--card-3)' : legendary ? '#FFD43B' : b1;
  const plateText = locked ? 'var(--text-3)' : '#0B0D12';

  const defs = [];
  if (!locked) {
    if (legendary) {
      defs.push(`<linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1">${HOLO.map((c, i) => `<stop offset="${i / (HOLO.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient>`);
    } else if (rarity !== 'common') {
      const stops = rarity === 'epic' ? [b1, b2, b1] : [b1, b2];
      defs.push(`<linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1">${stops.map((c, i) => `<stop offset="${i / (stops.length - 1)}" style="stop-color:${c}"/>`).join('')}</linearGradient>`);
    }
    defs.push(`<radialGradient id="${id}-hi" cx="50%" cy="30%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
    defs.push(`<clipPath id="${id}-face"><path d="${shape}" transform="translate(50 50) scale(.82) translate(-50 -50)"/></clipPath>`);
    if (standalone) {
      defs.push(`<filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    }
  }

  const parts = [];
  // 1. Rim
  if (legendary && !locked) {
    parts.push(`<g class="ba-holo"><path d="${shape}" fill="none" stroke="${rimStroke}" stroke-width="${RIM_WIDTH[rarity]}" stroke-linejoin="round"/></g>`);
  } else {
    parts.push(`<path class="ba-rim" d="${shape}" fill="none" style="stroke:${rimStroke}" stroke-width="${locked ? 2 : RIM_WIDTH[rarity]}" stroke-linejoin="round"/>`);
  }
  if (rarity === 'epic' && !locked) {
    parts.push(`<path d="${shape}" transform="translate(50 50) scale(.9) translate(-50 -50)" fill="none" style="stroke:${b2}" stroke-width="1.5"/>`);
  }
  // 2. Face
  parts.push(`<path class="ba-face" d="${shape}" transform="translate(50 50) scale(.82) translate(-50 -50)"${faceFill ? ` style="fill:${faceFill}"` : ''}/>`);
  if (!locked) {
    // 3. Highlight, rare ring, specks, shine
    parts.push(`<path d="${shape}" transform="translate(50 50) scale(.82) translate(-50 -50)" fill="url(#${id}-hi)"/>`);
    if (rarity === 'rare') parts.push(`<circle cx="50" cy="50" r="33" fill="none" style="stroke:${b2}" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="2 4"/>`);
    if (rarity === 'epic') parts.push(`<path d="${SPECKS.map(([x, y, r]) => fourPoint(x, y, r)).join(' ')}" style="fill:${b2}" fill-opacity=".6"/>`);
    if (rarity !== 'common') {
      parts.push(`<g clip-path="url(#${id}-face)"><rect class="ba-shine" x="-20" y="34" width="140" height="14" fill="#fff" fill-opacity=".16" transform="rotate(-30 50 50)"/></g>`);
    }
  }
  // 5. Glyph
  if (state === 'secret') {
    parts.push(`<text x="50" y="${plate ? 56 : 63}" text-anchor="middle" font-size="36" font-weight="800" font-family="-apple-system, system-ui, sans-serif" style="fill:var(--text-3)">?</text>`);
  } else {
    const filter = locked ? '' : standalone ? ` filter="url(#${id}-glow)"` : ' filter="url(#neon-glow)"';
    parts.push(`<g transform="translate(29 ${plate ? 19 : 25}) scale(1.75)" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="stroke:${glyphColor};color:${glyphColor}"${locked ? ' opacity=".5"' : ''}${filter}>${iconMarkup(badgeGlyph(def))}</g>`);
  }
  // 6. Plate
  if (plate && state !== 'secret') {
    parts.push(`<rect x="31" y="78" width="38" height="15" rx="7.5" style="fill:${plateFill}"/>`);
    parts.push(`<text x="50" y="89" text-anchor="middle" font-size="${plate.length > 3 ? 8.5 : 10}" font-weight="800" font-family="-apple-system, system-ui, sans-serif" style="fill:${plateText}">${esc(plate)}</text>`);
  }
  // Legendary sparkles
  if (legendary && !locked) {
    parts.push(SPARKLES.map(([x, y, delay]) => `<path class="ba-sparkle" style="animation-delay:${delay}s" d="${fourPoint(x, y, 5)}" fill="#FFF8D6"/>`).join(''));
  }
  // Locked progress arc
  if (state === 'locked' && progress > 0) {
    const C = 2 * Math.PI * 49;
    const done = Math.max(0, Math.min(1, progress)) * C;
    parts.push(`<circle class="ba-progress" cx="50" cy="50" r="49" fill="none" stroke-width="2" stroke-linecap="round" style="stroke:color-mix(in srgb, ${b1} 70%, transparent)" stroke-dasharray="${done.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/>`);
  }

  const cls = ['badge-art', `r-${rarity}`, `s-${state === 'new' ? 'earned' : state}`];
  if (state === 'new') cls.push('is-new');
  if (state === 'locked' && progress >= 0.75) cls.push('almost');
  if (className) cls.push(className);
  const style = standalone ? '' : ` style="--b1:${b1};--b2:${b2}"`;
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  const xmlns = standalone ? ' xmlns="http://www.w3.org/2000/svg"' : '';
  return `<svg${xmlns} class="${cls.join(' ')}" viewBox="0 0 100 100" width="${size}" height="${size}"${style}${a11y} focusable="false">${
    defs.length ? `<defs>${defs.join('')}</defs>` : ''}${parts.join('')}</svg>`;
}

/** A badge as a loaded <img> (always the earned look, literal colors), for canvas drawing. */
export function badgeImage(def, { size = 256, palette = 'glow' } = {}) {
  const svg = badgeSVG(def, { state: 'earned', size, standalone: true, palette });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('badge image failed'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** The frame outline as a Path2D (100×100 box) for canvas drawing. */
export function badgePath2D(def) {
  if (typeof def === 'string') def = BADGE_BY_ID.get(def);
  return new Path2D(FRAME_PATHS[def?.rarity] || FRAME_PATHS.common);
}
