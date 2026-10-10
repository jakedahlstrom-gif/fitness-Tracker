// Feel-good feedback: haptics, synthesized sounds, and canvas confetti.
// Sounds are generated with the Web Audio API, so there are no audio files to load.

import { store } from './store.js';
import { prefersReducedMotion } from './util.js';

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

const PATTERNS = {
  tick: 8,
  press: 12,
  success: [30, 50, 70],
  burst: [40, 40, 40, 40, 90],
  warn: [20, 60, 20],
};

/**
 * Buzz the phone. Android uses navigator.vibrate. iPhone Safari has no vibrate API,
 * but toggling a hidden <input switch> gives a light system tap on iOS 18+ (best effort).
 */
export function haptic(kind = 'tick') {
  if (!store.settings.haptics) return;
  const pattern = PATTERNS[kind] ?? kind;
  if (typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
    return;
  }
  const taps = Array.isArray(pattern) ? Math.ceil(pattern.length / 2) : 1;
  for (let i = 0; i < taps; i++) setTimeout(iosTap, i * 110);
}

function iosTap() {
  try {
    const label = document.createElement('label');
    label.ariaHidden = 'true';
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    label.remove();
  } catch { /* not supported */ }
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

let ctx = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio() {
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/** One enveloped oscillator note. */
function note(freq, { at = 0, dur = 0.25, type = 'sine', gain = 0.18, glideTo = null } = {}) {
  const c = audio();
  if (!c) return null;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  return { osc, g };
}

let charge = null;

export const sound = {
  /** Soft rising tone while the log button is held. */
  chargeStart(duration = 1.5) {
    if (!store.settings.sounds) return;
    const c = audio();
    if (!c) return;
    sound.chargeStop();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(660, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.15);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    charge = { osc, g };
  },

  chargeStop() {
    if (!charge || !ctx) return;
    const { osc, g } = charge;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.stop(t + 0.1);
    charge = null;
  },

  /** Bright sparkly arpeggio + soft thump: "workout logged!" */
  success() {
    if (!store.settings.sounds) return;
    note(90, { dur: 0.25, glideTo: 45, gain: 0.35 });
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
      note(f, { at: 0.04 + i * 0.07, dur: 0.45, type: 'triangle', gain: 0.12 });
      note(f * 2, { at: 0.04 + i * 0.07, dur: 0.2, gain: 0.03 });
    });
  },

  /** Short UI tick. */
  tap() {
    if (!store.settings.sounds) return;
    note(1400, { dur: 0.05, type: 'square', gain: 0.025 });
  },

  /** Gentle descending blip (early release / delete). */
  cancel() {
    if (!store.settings.sounds) return;
    note(520, { dur: 0.16, glideTo: 300, gain: 0.06, type: 'triangle' });
  },
};

// ---------------------------------------------------------------------------
// Confetti
// ---------------------------------------------------------------------------

const canvas = document.getElementById('fx-canvas');
const g2d = canvas?.getContext('2d');
let particles = [];
let rafId = 0;
let lastT = 0;

function resizeCanvas() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function accentColors() {
  const cs = getComputedStyle(document.documentElement);
  return ['--pink', '--cyan', '--purple', '--lime', '--pink', '--cyan']
    .map((v) => cs.getPropertyValue(v).trim() || '#FF2D78');
}

/**
 * Fire a burst of confetti.
 * @param {object} o
 * @param {number} o.x,o.y   origin in CSS pixels (defaults to screen center)
 * @param {number} o.count   number of pieces
 * @param {number} o.angle   launch direction in degrees (90 = straight up)
 * @param {number} o.spread  cone width in degrees
 * @param {number} o.power   launch speed
 */
export function confetti({ x = innerWidth / 2, y = innerHeight / 2, count = 120, angle = 90, spread = 70, power = 14 } = {}) {
  if (!g2d) return;
  if (prefersReducedMotion()) count = Math.min(count, 24);
  const colors = accentColors();
  for (let i = 0; i < count; i++) {
    const a = ((angle + (Math.random() - 0.5) * spread) * Math.PI) / 180;
    const v = power * (0.55 + Math.random() * 0.6);
    const shape = Math.random();
    particles.push({
      x, y,
      vx: Math.cos(a) * v,
      vy: -Math.sin(a) * v,
      w: 5 + Math.random() * 5,
      h: shape < 0.3 ? 3 + Math.random() * 2 : 8 + Math.random() * 6,
      round: shape > 0.85,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      wobble: Math.random() * Math.PI * 2,
      vw: 0.08 + Math.random() * 0.12,
      color: colors[i % colors.length],
      life: 0,
      ttl: 110 + Math.random() * 70,
    });
  }
  if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(tick); }
}

function tick(now) {
  const dt = Math.min(3, (now - lastT) / 16.67); // frame-rate independent (60fps = 1)
  lastT = now;
  g2d.clearRect(0, 0, innerWidth, innerHeight);
  particles = particles.filter((p) => p.life < p.ttl && p.y < innerHeight + 40);
  for (const p of particles) {
    p.life += dt;
    p.vx *= Math.pow(0.985, dt);
    p.vy = p.vy * Math.pow(0.985, dt) + 0.32 * dt;
    p.x += p.vx * dt + Math.sin(p.wobble) * 0.6;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.wobble += p.vw * dt;
    const fade = Math.min(1, (p.ttl - p.life) / 30);
    g2d.save();
    g2d.globalAlpha = Math.max(0, fade);
    g2d.translate(p.x, p.y);
    g2d.rotate(p.rot);
    g2d.scale(1, Math.cos(p.wobble)); // flutter
    g2d.fillStyle = p.color;
    if (p.round) {
      g2d.beginPath();
      g2d.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      g2d.fill();
    } else {
      g2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    g2d.restore();
  }
  if (particles.length) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = 0;
    g2d.clearRect(0, 0, innerWidth, innerHeight);
  }
}

/** Full "workout logged" celebration from a screen point. */
export function celebrateLog(origin = {}) {
  haptic('success');
  sound.success();
  const x = origin.x ?? innerWidth / 2;
  const y = origin.y ?? innerHeight * 0.75;
  confetti({ x, y, count: 110, angle: 90, spread: 60, power: 17 });
  setTimeout(() => {
    confetti({ x, y, count: 50, angle: 120, spread: 40, power: 13 });
    confetti({ x, y, count: 50, angle: 60, spread: 40, power: 13 });
  }, 120);
}
