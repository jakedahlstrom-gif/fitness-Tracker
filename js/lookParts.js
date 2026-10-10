// Shared pieces for the unlockable looks: miniature hold buttons wearing a skin,
// palette swatch orbs, the hold-to-test behavior and the "equip" transition.
// Used by the Glow Studio, the Rewards card, the Profile card and the unlock reveal.
// Nothing here touches the DOM until a function is called.

import { PALETTES, SKINS, paletteStyle } from './looks.js';
import { store } from './store.js';
import { icon } from './icons.js';
import { esc, prefersReducedMotion } from './util.js';
import { confetti, sound, haptic, unlockAudio } from './effects.js';
import { toast } from './toast.js';

const MINI_R = 46; // ring radius in the mini's 100×100 viewBox (same geometry as the main button)
const MINI_C = 2 * Math.PI * MINI_R;
const MINI_HOLD_MS = 800;

const currentTheme = () => (document.documentElement.dataset.glowTheme === 'light' ? 'light' : 'dark');

/**
 * A miniature live hold button wearing a skin (its own ring, core and icon).
 * @param {string} skinId
 * @param {{ size?: number, holdable?: boolean, label?: string }} [o]
 *   holdable: bindHoldMinis() makes it hold-to-test; label: small text under the icon.
 */
export function holdMiniHTML(skinId, { size = 56, holdable = false, label = '' } = {}) {
  const id = SKINS[skinId] ? skinId : 'classic';
  const skin = SKINS[id];
  const hold = holdable
    ? ` data-holdable role="button" tabindex="0" aria-label="${esc(`Hold to test ${skin.name}`)}"`
    : ' aria-hidden="true"';
  return `<span class="hold-mini${size < 40 ? ' is-tiny' : ''}" data-skin="${id}" style="--size:${Math.round(size)}px"${hold}>
    <svg class="hold-mini-ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle class="mini-track" cx="50" cy="50" r="${MINI_R}"/>
      <circle class="mini-progress" cx="50" cy="50" r="${MINI_R}" stroke-dasharray="${MINI_C.toFixed(2)}" stroke-dashoffset="${MINI_C.toFixed(2)}"/>
    </svg>
    <span class="hold-core"><span class="hold-plus">${icon(skin.icon)}</span>${label ? `<span class="hold-label">${esc(label)}</span>` : ''}</span>
  </span>`;
}

/**
 * A palette swatch orb: a conic sweep of its accents (A → C → B → A) with a highlight and glow.
 * @param {string} paletteId
 * @param {{ size?: number, theme?: 'dark'|'light' }} [o]  theme defaults to the current mode
 */
export function paletteOrbHTML(paletteId, { size = 28, theme = currentTheme() } = {}) {
  const id = PALETTES[paletteId] ? paletteId : 'glow';
  return `<span class="palette-orb" data-palette="${id}" style="${paletteStyle(id, theme)};--size:${Math.round(size)}px" aria-hidden="true"></span>`;
}

/** Confetti colors for a mini: 'A'..'D' resolve against the colors the mini itself is wearing. */
function miniColors(el, skin) {
  const cs = getComputedStyle(el);
  const a = { A: '--pink', B: '--cyan', C: '--purple', D: '--lime' };
  const get = (k) => cs.getPropertyValue(a[k]).trim() || '#FF2D78';
  const list = skin.confetti.colors || ['A', 'B', 'C', 'D', 'A', 'B'];
  return list.map((c) => (a[c] ? get(c) : c));
}

/**
 * Make every `.hold-mini[data-holdable]` inside root hold-to-test: a 0.8 s press fills
 * its ring, then it bursts that skin's confetti and plays its sound. Nothing is logged.
 * Uses event delegation, so minis re-rendered later inside root work too.
 * @returns {() => void} unbind
 */
export function bindHoldMinis(root) {
  let active = null; // { el, start, raf, pointerId }

  const ring = (el) => el.querySelector('.mini-progress');
  const setP = (el, p) => {
    const r = ring(el);
    if (r) r.style.strokeDashoffset = `${MINI_C * (1 - p)}`;
    el.style.setProperty('--p', p.toFixed(3));
  };

  function begin(el, pointerId = null) {
    if (active || el.classList.contains('cooldown')) return;
    unlockAudio();
    const r = ring(el);
    if (r) r.style.transition = 'none';
    el.classList.remove('done');
    el.classList.add('holding');
    haptic('press');
    sound.chargeStart(MINI_HOLD_MS / 1000);
    active = { el, start: performance.now(), raf: 0, pointerId };
    active.raf = requestAnimationFrame(step);
  }

  function step(now) {
    if (!active) return;
    const p = Math.min(1, (now - active.start) / MINI_HOLD_MS);
    setP(active.el, p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
    if (p >= 1) complete();
    else active.raf = requestAnimationFrame(step);
  }

  function complete() {
    const { el } = active;
    active = null;
    sound.chargeStop();
    el.classList.remove('holding');
    el.classList.add('done', 'cooldown');
    const id = SKINS[el.dataset.skin] ? el.dataset.skin : 'classic';
    const skin = SKINS[id];
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const size = Math.max(28, rect.width);
    const look = { shapes: skin.confetti.shapes, colors: miniColors(el, skin) };
    haptic('success');
    sound.skin(id);
    confetti({ x, y, count: Math.round(50 + size * 0.5), angle: 90, spread: 70, power: 10 + size / 14, ...look });
    setTimeout(() => {
      confetti({ x, y, count: Math.round(18 + size * 0.2), angle: 130, spread: 40, power: 8 + size / 20, ...look });
      confetti({ x, y, count: Math.round(18 + size * 0.2), angle: 50, spread: 40, power: 8 + size / 20, ...look });
    }, 110);
    setTimeout(() => {
      const r = ring(el);
      if (r) r.style.transition = 'stroke-dashoffset .5s ease';
      setP(el, 0);
      el.classList.remove('done', 'cooldown');
    }, 900);
  }

  function cancel() {
    if (!active) return;
    const { el, raf } = active;
    active = null;
    cancelAnimationFrame(raf);
    sound.chargeStop();
    el.classList.remove('holding');
    const r = ring(el);
    if (r) r.style.transition = 'stroke-dashoffset .35s ease';
    setP(el, 0);
  }

  const target = (e) => e.target.closest?.('.hold-mini[data-holdable]');

  function onDown(e) {
    const el = target(e);
    if (!el || !root.contains(el) || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    begin(el, e.pointerId);
  }
  function onUp(e) {
    if (active && (active.pointerId == null || e.pointerId === active.pointerId)) cancel();
  }
  function onKeyDown(e) {
    const el = target(e);
    if (el && (e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(el); }
  }
  function onKeyUp(e) {
    if (active && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); cancel(); }
  }
  function onContext(e) { if (target(e)) e.preventDefault(); }
  function onClick(e) { if (target(e)) e.preventDefault(); }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('lostpointercapture', onUp, true);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('keyup', onKeyUp);
  root.addEventListener('focusout', cancel);
  root.addEventListener('contextmenu', onContext);
  root.addEventListener('click', onClick);

  return () => {
    cancel();
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
    root.removeEventListener('lostpointercapture', onUp, true);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('keyup', onKeyUp);
    root.removeEventListener('focusout', cancel);
    root.removeEventListener('contextmenu', onContext);
    root.removeEventListener('click', onClick);
  };
}

/** "Sunset Drive", "Gold Rush & Holo": the names of the parts of `patch` that change. */
function equipName(patch) {
  const s = store.settings;
  const parts = [];
  if (patch.palette && PALETTES[patch.palette]) parts.push({ name: PALETTES[patch.palette].name, changed: patch.palette !== s.palette });
  if (patch.skin && SKINS[patch.skin]) parts.push({ name: SKINS[patch.skin].name, changed: patch.skin !== s.skin });
  const changed = parts.filter((p) => p.changed);
  return (changed.length ? changed : parts).map((p) => p.name).join(' & ') || 'Look';
}

/**
 * Equip a look: a circular wipe from originEl (View Transitions; instant when unsupported or
 * under reduced motion), then the settings commit (the app's subscriber applies the look),
 * haptic, shimmer and a toast. Resolves when the wipe has finished.
 * @param {{ palette?: string, skin?: string }} patch
 * @param {Element} [originEl]
 */
export function equipLook(patch, originEl) {
  const name = equipName(patch);
  haptic('success'); // first, while still inside her tap (iOS)
  sound.shimmer();
  const apply = () => {
    store.updateSettings(patch);
    toast(`${name} equipped`);
  };
  const root = document.documentElement;
  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
    apply();
    return Promise.resolve();
  }
  const r = originEl?.getBoundingClientRect?.();
  const x = r && r.width ? r.left + r.width / 2 : innerWidth / 2;
  const y = r && r.height ? r.top + r.height / 2 : innerHeight / 2;
  root.style.setProperty('--vt-x', `${Math.round(x)}px`);
  root.style.setProperty('--vt-y', `${Math.round(y)}px`);
  root.classList.add('vt-equip');
  const done = () => root.classList.remove('vt-equip');
  try {
    const t = document.startViewTransition(apply);
    return t.finished.then(done, done);
  } catch {
    done();
    apply();
    return Promise.resolve();
  }
}
