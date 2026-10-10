// Canvas fireworks for the big celebrations: shells that climb and burst into
// peonies, rings, crossettes, willows and hearts. Sparks are cached glow sprites
// drawn with additive blending; trails come from fading the previous frame.
// One show = one canvas, created for the celebration and removed afterwards.

import { sound, panFor } from './effects.js';
import { PALETTES, currentLook } from './looks.js';

const MAX_SPARKS = 700;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

export const GOLD = '#FFC24A';
export const WHITE = '#FFFFFF';

/** The current palette's dark-set accents, which read best on a night sky. */
export function skyColors() {
  const p = (PALETTES[currentLook().palette] || PALETTES.glow).dark;
  return { A: p['--pink'], B: p['--cyan'], C: p['--purple'], D: p['--lime'], W: WHITE, G: GOLD };
}

function rgba(color, a) {
  const c = String(color).trim();
  let r = 255, g = 255, b = 255;
  if (c[0] === '#') {
    const h = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1, 7);
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  } else {
    const m = c.match(/[\d.]+/g);
    if (m && m.length >= 3) [r, g, b] = m.map(Number);
  }
  return `rgba(${r},${g},${b},${a})`;
}

const sprites = new Map();
function sprite(color) {
  let s = sprites.get(color);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 32;
  const c = s.getContext('2d');
  const grad = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.25, rgba(color, 0.35));
  grad.addColorStop(1, rgba(color, 0));
  c.fillStyle = grad;
  c.fillRect(0, 0, 32, 32);
  if (sprites.size > 40) sprites.clear();
  sprites.set(color, s);
  return s;
}

/**
 * Start a fireworks show on a new canvas inside `parent`.
 * @param {object} o
 * @param {HTMLElement} o.parent  where the canvas goes (a .cel-layer)
 * @param {number} o.level  2 (smaller bursts) or 3
 * @param {string} o.blend  'lighter' on dark skies, 'source-over' on light pages
 * @param {boolean} o.trails  fade previous frames instead of clearing
 */
export function createShow({ parent, level = 3, blend = 'lighter', trails = true, zIndex = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'cel-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  if (zIndex != null) canvas.style.zIndex = zIndex;
  parent.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let W = 0, H = 0;
  function resize() {
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  let sparks = [];
  let shells = [];
  let flashes = [];
  let raf = 0;
  let last = performance.now();
  let low = false;
  let frameMs = [];
  let alpha = 1;
  let fading = null;
  let stopped = false;
  const scaleN = (n) => Math.max(6, Math.round(low ? n / 2 : n));

  function spark(o) {
    sparks.push({
      x: o.x, y: o.y, vx: o.vx, vy: o.vy,
      g: o.g ?? 0.06, drag: o.drag ?? 0.982,
      ttl: o.ttl, life: 0, color: o.color, colorTo: o.colorTo || null,
      s: o.s ?? rand(2.4, 3.2), glitter: !!o.glitter, seed: Math.random(),
      split: o.split || null, ember: o.ember || 0, hot: o.hot !== false,
    });
  }

  function flash(x, y, color) {
    flashes.push({ x, y, r: level === 3 ? 70 : 45, color, life: 0, ttl: 8 });
  }

  // ---- Burst types ----

  const BURSTS = {
    peony(x, y, { colors, scale = 1, glitter = false }) {
      const N = scaleN(level === 3 ? 84 : 46);
      const V = 4.7 * scale;
      for (let i = 0; i < N; i++) {
        const pistil = i % 10 >= 7;
        const v = pistil ? V * 0.6 : rand(4.4, 5.0) * scale * (0.9 + 0.1 * Math.random());
        const a = (TAU * i) / N + Math.random() * 0.06;
        spark({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ttl: rand(72, 96), color: pistil ? colors[1] : colors[0], glitter });
      }
    },
    ring(x, y, { colors, scale = 1 }) {
      const N = scaleN(56);
      const tilt = (rand(-25, 25) * Math.PI) / 180;
      const cos = Math.cos(tilt), sin = Math.sin(tilt);
      for (let i = 0; i < N; i++) {
        const a = (TAU * i) / N;
        const ux = Math.cos(a) * 4.6 * scale, uy = Math.sin(a) * 4.6 * scale * 0.5;
        spark({ x, y, vx: ux * cos - uy * sin, vy: ux * sin + uy * cos, ttl: rand(70, 86), color: colors[i % 2] });
      }
    },
    crossette(x, y, { colors }) {
      const N = 14;
      for (let i = 0; i < N; i++) {
        const a = (TAU * i) / N + Math.random() * 0.1;
        spark({ x, y, vx: Math.cos(a) * 3.8, vy: Math.sin(a) * 3.8, ttl: 34, color: colors[0], split: colors[1] || colors[0] });
      }
    },
    willow(x, y, { colors }) {
      const N = scaleN(64);
      for (let i = 0; i < N; i++) {
        const a = (TAU * i) / N + Math.random() * 0.05;
        const v = 3.2 * (0.85 + Math.random() * 0.15);
        spark({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.035, drag: 0.972, ttl: rand(150, 190),
          color: colors[0] || GOLD, colorTo: '#FF8A3D', ember: 4, s: rand(2, 2.6) });
      }
    },
    heart(x, y, { colors, scale = 1 }) {
      const N = scaleN(72);
      for (let i = 0; i < N; i++) {
        const t = (TAU * i) / N;
        const hx = 16 * Math.sin(t) ** 3;
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        spark({ x, y, vx: hx * 0.3 * scale, vy: -hy * 0.3 * scale, g: 0.025, drag: 0.975, ttl: 100, color: colors[i % 7 === 0 ? 1 : 0] || colors[0] });
      }
    },
    salute(x, y, { colors }) {
      const N = scaleN(40);
      for (let i = 0; i < N; i++) {
        const a = (TAU * i) / N + Math.random() * 0.1;
        const v = rand(3.6, 4.8);
        spark({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ttl: rand(40, 55), color: i % 2 ? colors[1] || WHITE : WHITE });
      }
    },
  };

  function burst(type, x, y, opts = {}) {
    if (stopped) return;
    const colors = opts.colors || [skyColors().A, WHITE];
    (BURSTS[type] || BURSTS.peony)(x, y, { ...opts, colors });
    flash(x, y, colors[0]);
    if (opts.sound !== false) {
      sound.boom(panFor(x));
      if (type === 'crossette') setTimeout(() => sound.crackle(panFor(x)), 560);
    }
    cull();
    start();
  }

  /**
   * Launch a shell from the bottom of the screen to (x, apexY), bursting there.
   * x and apexY are fractions of the width and height.
   */
  function launch({ x, apexY, type = 'peony', colors, scale, glitter, sound: withSound = true, fromX = null }) {
    if (stopped) return;
    const ax = x * W, ay = apexY * H;
    const x0 = fromX != null ? fromX * W : ax + rand(-20, 20);
    const y0 = H + 10;
    const T = 57 + rand(-6, 6);
    const d = y0 - ay;
    shells.push({ x: x0, y: y0, vx: (ax - x0) / T, vy: (-2 * d) / T, g: (2 * d) / (T * T), T, t: 0,
      burst: { type, colors, scale, glitter, sound: withSound } });
    if (withSound) sound.whistle(T / 60, panFor(ax));
    start();
  }

  /** Little sparks for the badge reveal: inward toward (x, y) from `radius`, or outward. */
  function sparksAt({ x, y, n = 18, inward = false, radius = 160, colors = [WHITE], v = [2, 5], ttl = 40 }) {
    if (stopped) return;
    for (let i = 0; i < n; i++) {
      const a = (TAU * i) / n + Math.random() * 0.2;
      const color = colors[i % colors.length];
      if (inward) {
        const frames = 17;
        spark({ x: x + Math.cos(a) * radius, y: y + Math.sin(a) * radius, vx: (-Math.cos(a) * radius) / frames,
          vy: (-Math.sin(a) * radius) / frames, g: 0, drag: 1, ttl: frames, color, s: 2.2, hot: false });
      } else {
        const sp = rand(v[0], v[1]);
        spark({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 0.04, drag: 0.96, ttl, color, s: 2.4 });
      }
    }
    start();
  }

  function cull() {
    if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS);
  }

  function start() {
    if (!raf && !fading) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function frame(now) {
    const ms = now - last;
    const dt = Math.min(3, ms / 16.67);
    last = now;
    // Adaptive quality: a slow phone gets half the sparks and no trails.
    if (!low) {
      frameMs.push(ms);
      if (frameMs.length > 20) frameMs.shift();
      if (frameMs.length === 20 && frameMs.reduce((a, b) => a + b, 0) / 20 > 22) low = true;
    }

    if (trails && !low) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - Math.pow(0.8, dt)})`;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.clearRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = blend;

    // Shells climbing.
    const ember = sprite('#FFD9A0');
    for (const sh of shells) {
      sh.t += dt;
      sh.vy += sh.g * dt;
      sh.x += sh.vx * dt + Math.sin(sh.t * 0.35) * 0.4;
      sh.y += sh.vy * dt;
      ctx.globalAlpha = 1;
      ctx.drawImage(ember, sh.x - 6, sh.y - 6, 12, 12);
      if (!low && Math.random() < dt) {
        spark({ x: sh.x, y: sh.y, vx: rand(-0.6, 0.6), vy: 0.8 + Math.random() * 0.6, g: 0.05, drag: 0.96, ttl: rand(20, 30), color: '#FFD9A0', s: 1.6, hot: false });
      }
      if (sh.vy >= -0.5 || sh.t >= sh.T) {
        sh.done = true;
        burst(sh.burst.type, sh.x, sh.y, sh.burst);
      }
    }
    shells = shells.filter((s) => !s.done);

    // Sparks.
    const white = sprite(WHITE);
    const born = [];
    for (const p of sparks) {
      p.life += dt;
      const k = Math.pow(p.drag, dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life >= p.ttl) {
        if (p.split) {
          const dir = Math.atan2(p.vy, p.vx);
          for (const off of [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4]) {
            born.push({ x: p.x, y: p.y, vx: Math.cos(dir + off) * 2.4, vy: Math.sin(dir + off) * 2.4, ttl: 40, color: p.split });
          }
        }
        continue;
      }
      if (p.ember && !low && Math.floor(p.life) % p.ember === 0 && Math.random() < 0.5) {
        born.push({ x: p.x, y: p.y, vx: 0, vy: 0.4, g: 0.02, drag: 0.95, ttl: 26, color: p.colorTo || p.color, s: 1.4, hot: false });
      }
      const left = p.ttl - p.life;
      let a = Math.min(1, left / 25);
      if (p.glitter && p.life > p.ttl * 0.55) a *= Math.sin(p.life * 0.8 + p.seed * TAU) > -0.2 ? 1 : 0.15;
      const size = (low ? 4 : 6) * p.s * Math.min(1, left / (0.3 * p.ttl));
      ctx.globalAlpha = a * alpha;
      if (p.colorTo) {
        const m = Math.min(1, p.life / p.ttl);
        ctx.globalAlpha = a * alpha * (1 - m);
        ctx.drawImage(sprite(p.color), p.x - size / 2, p.y - size / 2, size, size);
        ctx.globalAlpha = a * alpha * m;
        ctx.drawImage(sprite(p.colorTo), p.x - size / 2, p.y - size / 2, size, size);
      } else {
        ctx.drawImage(sprite(p.color), p.x - size / 2, p.y - size / 2, size, size);
      }
      if (p.hot) {
        const hot = 1 - p.life / (0.3 * p.ttl);
        if (hot > 0) {
          ctx.globalAlpha = hot * alpha;
          ctx.drawImage(white, p.x - 2.5, p.y - 2.5, 5, 5);
        }
      }
    }
    sparks = sparks.filter((p) => p.life < p.ttl);
    for (const b of born) spark(b);
    cull();

    // Burst flashes.
    for (const f of flashes) {
      f.life += dt;
      const a = 0.5 * (1 - f.life / f.ttl);
      if (a <= 0) continue;
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      grad.addColorStop(0, rgba(WHITE, a));
      grad.addColorStop(0.4, rgba(f.color, a * 0.6));
      grad.addColorStop(1, rgba(f.color, 0));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = grad;
      ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    flashes = flashes.filter((f) => f.life < f.ttl);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (sparks.length || shells.length || flashes.length) raf = requestAnimationFrame(frame);
    else { raf = 0; ctx.clearRect(0, 0, W, H); }
  }

  /** Stop launching, fade what is left over `ms`, then remove the canvas. */
  function stop(ms = 300) {
    stopped = true;
    shells = [];
    if (fading) return fading;
    fading = new Promise((resolve) => {
      canvas.style.transition = `opacity ${ms}ms ease`;
      canvas.style.opacity = '0';
      setTimeout(() => { destroy(); resolve(); }, ms);
    });
    return fading;
  }

  function destroy() {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    sparks = []; shells = []; flashes = [];
    window.removeEventListener('resize', resize);
    canvas.remove();
  }

  return {
    canvas, launch, burst, sparks: sparksAt, stop, destroy,
    get size() { return { W, H }; },
    get busy() { return sparks.length + shells.length > 0; },
  };
}
