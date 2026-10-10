// Small shared helpers: DOM, escaping, ids, numbers, units.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape user-provided text before putting it in an HTML template. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Random id for workouts, photos and custom types. */
export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const fmtNum = (n) => Math.round(n).toLocaleString();

export const plural = (n, word, many = word + 's') => `${fmtNum(n)} ${n === 1 ? word : many}`;

export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Touch-first device (phone/tablet) rather than a mouse. */
export const isTouchDevice = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** True inside another page's frame (e.g. a claude.ai preview link), where downloads are blocked. */
export function isEmbedded() {
  try { return window.self !== window.top; } catch { return true; }
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// ---- Distance units (stored in km, shown in the user's unit) ----

const KM_PER_MI = 1.609344;

export const kmToUnit = (km, units) => (units === 'mi' ? km / KM_PER_MI : km);
export const unitToKm = (value, units) => (units === 'mi' ? value * KM_PER_MI : value);

export function fmtDistance(km, units) {
  const v = kmToUnit(km, units);
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units}`;
}

/** Format minutes as "45 min" or "2h 15m". */
export function fmtMinutes(min) {
  if (!min) return '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
