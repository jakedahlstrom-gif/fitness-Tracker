// Feel-good feedback: haptics, synthesized sounds, and canvas confetti.
// Sounds are generated with the Web Audio API, so there are no audio files to load.

import { store } from './store.js';
import { prefersReducedMotion } from './util.js';
import { SKINS, currentLook } from './looks.js';

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

/**
 * Taps at millisecond offsets, e.g. [0, 120, 240]. On iOS only the first tap is
 * reliable, and only when it runs inside the user's gesture (`inGesture`).
 */
export function hapticSeq(offsets = [0], { inGesture = false } = {}) {
  if (!store.settings.haptics || !offsets.length) return;
  const sorted = [...offsets].sort((a, b) => a - b);
  if (typeof navigator.vibrate === 'function') {
    const pattern = sorted[0] > 0 ? [0, sorted[0], 25] : [25];
    for (let i = 1; i < sorted.length; i++) pattern.push(Math.max(15, sorted[i] - sorted[i - 1] - 25), 25);
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
    return;
  }
  let last = -Infinity;
  for (const o of sorted) {
    if (o - last < 120) continue;
    last = o;
    if (o === 0 && inGesture) iosTap();
    else setTimeout(iosTap, o);
  }
}

let lastIosTap = 0;
function iosTap() {
  const now = performance.now();
  if (now - lastIosTap < 120) return;
  lastIosTap = now;
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
// Sound: every voice goes through one compressed master bus, so stacked
// celebration sounds never clip.
// ---------------------------------------------------------------------------

let ctx = null;
let bus = null;
let noiseBuf = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // Mix with her music instead of pausing it, and respect the silent switch (iOS 17+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* ignore */ }
    ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    master.connect(comp).connect(ctx.destination);
    bus = master;
  }
  return ctx;
}

/** Browsers only allow audio after a user gesture; call this from one. */
export function unlockAudio() {
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

/** Stereo position for a screen x (CSS px), gently panned. */
export const panFor = (x) => ((x / Math.max(1, innerWidth)) * 2 - 1) * 0.6;

function output(pan) {
  if (pan == null || !ctx.createStereoPanner) return bus;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(bus);
  return p;
}

/** One enveloped oscillator note. */
function note(freq, { at = 0, dur = 0.25, type = 'sine', gain = 0.18, glideTo = null, glideDur = dur,
  attack = 0.012, sustain = 0, vibrato = null, tremolo = null, pan = null, filter = null } = {}) {
  const c = audio();
  if (!c) return null;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + glideDur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  if (sustain) g.gain.setValueAtTime(gain, t + Math.max(attack, dur * sustain));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const extra = [];
  if (vibrato) {
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = vibrato.rate;
    depth.gain.value = vibrato.depth;
    lfo.connect(depth).connect(osc.frequency);
    extra.push(lfo);
  }
  let node = osc;
  if (filter) {
    const f = c.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    node = node.connect(f);
  }
  if (tremolo) {
    const trem = c.createGain();
    const lfo = c.createOscillator();
    const depth = c.createGain();
    trem.gain.value = 1 - tremolo.depth;
    lfo.frequency.value = tremolo.rate;
    depth.gain.value = tremolo.depth;
    lfo.connect(depth).connect(trem.gain);
    node = node.connect(trem);
    extra.push(lfo);
  }
  node.connect(g).connect(output(pan));
  for (const o of [osc, ...extra]) { o.start(t); o.stop(t + dur + 0.05); }
  return { osc, g };
}

/** A filtered burst of white noise. */
function noise({ at = 0, dur = 0.3, gain = 0.1, type = 'lowpass', freq = 1000, freqTo = null, q = 1, attack = 0.005, pan = null } = {}) {
  const c = audio();
  if (!c) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(output(pan));
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

let charge = null;
let lastBoom = 0;

const SKIN_SOUNDS = {
  success: () => sound.success(),
  heartbeat: () => { sound.thump(); sound.success(0.16); },
  ice: () => sound.ice(),
  shimmer: () => sound.shimmer(),
  lava: () => { sound.bloop(); sound.success(0.1); },
  holo: () => { sound.shimmer(); sound.bell(0.3); },
  galaxy: () => { sound.whoosh(); sound.bell(0.25); },
};

const on = () => store.settings.sounds && audio();

export const sound = {
  /** Soft rising tone while the log button is held. */
  chargeStart(duration = 1.5) {
    if (!on()) return;
    sound.chargeStop();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(660, t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.15);
    osc.connect(g).connect(bus);
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
  success(at = 0) {
    if (!on()) return;
    note(90, { at, dur: 0.25, glideTo: 45, gain: 0.35 });
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
      note(f, { at: at + 0.04 + i * 0.07, dur: 0.45, type: 'triangle', gain: 0.12 });
      note(f * 2, { at: at + 0.04 + i * 0.07, dur: 0.2, gain: 0.03 });
    });
  },

  /** The equipped hold-button skin's "logged" sound. */
  skin(id = currentLook().skin) {
    (SKIN_SOUNDS[SKINS[id]?.sound] || SKIN_SOUNDS.success)();
  },

  /** Short UI tick. */
  tap() {
    if (!on()) return;
    note(1400, { dur: 0.05, type: 'square', gain: 0.025 });
  },

  /** Gentle descending blip (early release / delete). */
  cancel() {
    if (!on()) return;
    note(520, { dur: 0.16, glideTo: 300, gain: 0.06, type: 'triangle' });
  },

  /** Rising sparkle, n notes (1–4). */
  chime(n = 2, pan = null) {
    if (!on()) return;
    [1318.5, 1661.2, 1975.5, 2637].slice(0, n).forEach((f, i) => {
      note(f, { at: i * 0.07, dur: 0.35, type: 'triangle', gain: 0.1, pan });
      note(f * 2, { at: i * 0.07, dur: 0.2, gain: 0.03, pan });
    });
  },

  /** One note per closed ring. */
  ringChord(rings = 3) {
    if (!on()) return;
    [1046.5, 1318.5, 1568].slice(0, rings).forEach((f, i) => {
      note(f, { at: i * 0.12, dur: 0.6, type: 'triangle', gain: 0.09 });
    });
  },

  fanfare() {
    if (!on()) return;
    note(90, { dur: 0.25, glideTo: 45, gain: 0.3 });
    [1046.5, 1318.5, 1568].forEach((f, i) => note(f, { at: i * 0.06, dur: 0.3, type: 'triangle', gain: 0.1 }));
    note(2093, { at: 0.18, dur: 0.75, type: 'triangle', gain: 0.09, sustain: 0.6, vibrato: { rate: 6, depth: 8 } });
  },

  coin(at = 0) {
    if (!on()) return;
    note(1975.5, { at, dur: 0.06, type: 'square', gain: 0.05 });
    note(2637, { at: at + 0.06, dur: 0.25, type: 'square', gain: 0.05 });
  },

  /** n quiet ticks spread over `dur` seconds (a number counting up). */
  tickRoll(n = 10, dur = 0.7) {
    if (!on()) return;
    for (let i = 0; i < n; i++) note(1400, { at: (i * dur) / n, dur: 0.02, type: 'square', gain: 0.02 });
  },

  /** Low rising wash under the finale's opening. */
  swell() {
    if (!on()) return;
    noise({ dur: 0.7, gain: 0.06, type: 'lowpass', freq: 200, freqTo: 1200, attack: 0.3 });
    note(220, { dur: 0.6, glideTo: 440, glideDur: 0.4, gain: 0.05, attack: 0.2 });
  },

  /** A shell going up for `T` seconds. */
  whistle(T = 0.95, pan = null) {
    if (!on()) return;
    note(700, { dur: T, glideTo: 1500, gain: 0.02, attack: 0.05, sustain: 0.7, pan });
  },

  boom(pan = null) {
    if (!on()) return;
    const now = performance.now();
    if (now - lastBoom < 90) return;
    lastBoom = now;
    noise({ dur: 0.6, gain: 0.25, type: 'lowpass', freq: 600, pan });
    note(60, { dur: 0.4, glideTo: 35, gain: 0.3, pan });
  },

  crackle(pan = null) {
    if (!on()) return;
    for (let i = 0; i < 12; i++) noise({ at: Math.random() * 0.4, dur: 0.008, attack: 0.001, gain: 0.04, type: 'highpass', freq: 3000, pan });
  },

  /** Big warm major chord with a bell on top. */
  chord() {
    if (!on()) return;
    [523.25, 659.25, 783.99, 1174.66].forEach((f) => {
      note(f, { dur: 1.6, type: 'sawtooth', gain: 0.05, attack: 0.05, filter: { type: 'lowpass', freq: 2400 } });
    });
    sound.bell();
  },

  sweep() {
    if (!on()) return;
    note(300, { dur: 0.3, glideTo: 900, gain: 0.04, attack: 0.05, sustain: 0.6 });
  },

  bell(at = 0) {
    if (!on()) return;
    [[2093, 0.08], [3136, 0.04], [4186, 0.02]].forEach(([f, g]) => note(f, { at, dur: 1.4, gain: g, attack: 0.005 }));
  },

  shimmer() {
    if (!on()) return;
    [2093, 2349, 2637, 3136, 3520, 4186, 3520, 4186].forEach((f, i) => {
      note(f, { at: i * 0.07, dur: 0.3, type: 'triangle', gain: 0.03 });
    });
  },

  ice() {
    if (!on()) return;
    [2637, 3136, 3520].forEach((f, i) => note(f, { at: i * 0.09, dur: 1, gain: 0.06, tremolo: { rate: 14, depth: 0.5 } }));
  },

  thump() {
    if (!on()) return;
    note(70, { dur: 0.18, glideTo: 45, gain: 0.35 });
    note(70, { at: 0.16, dur: 0.18, glideTo: 45, gain: 0.35 });
  },

  bloop() {
    if (!on()) return;
    note(300, { dur: 0.12, glideTo: 140, gain: 0.12 });
    note(140, { at: 0.11, dur: 0.14, glideTo: 420, gain: 0.12 });
  },

  whoosh() {
    if (!on()) return;
    noise({ dur: 0.4, gain: 0.08, type: 'bandpass', freq: 400, freqTo: 3000, q: 1.2, attack: 0.12 });
  },

  /** Rising ticks for counting badges in (i = 0, 1, 2…). */
  introTick(i = 0) {
    if (!on()) return;
    note(880 * Math.pow(2, Math.min(i, 12) / 12), { dur: 0.07, type: 'triangle', gain: 0.05 });
  },
};

// ---------------------------------------------------------------------------
// Confetti
// ---------------------------------------------------------------------------

const MAX_PIECES = 450;
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

const TOKENS = { A: '--pink', B: '--cyan', C: '--purple', D: '--lime' };

/** The live accent colors (A, B, C, D) for the current palette and theme. */
export function accents() {
  const cs = getComputedStyle(document.documentElement);
  const get = (v) => cs.getPropertyValue(v).trim() || '#FF2D78';
  return { A: get('--pink'), B: get('--cyan'), C: get('--purple'), D: get('--lime') };
}

function accentColors() {
  const a = accents();
  return [a.A, a.B, a.C, a.D, a.A, a.B];
}

/** Resolve a color list where 'A'..'D' mean the palette accents. */
export function resolveColors(list) {
  if (!list || !list.length) return accentColors();
  const a = accents();
  return list.map((c) => (TOKENS[c] ? a[c] : c));
}

export const isCalm = () => store.settings.celebrations === 'calm';

const STAR = typeof Path2D === 'function' ? (() => {
  const p = new Path2D();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.45 : 1;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    p[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  p.closePath();
  return p;
})() : null;

const HEART = typeof Path2D === 'function'
  ? new Path2D('M0,.3 C-.5,-.2 -.25,-.65 0,-.35 C.25,-.65 .5,-.2 0,.3 Z')
  : null;

/**
 * Fire a burst of confetti.
 * @param {object} o
 * @param {number} o.x,o.y   origin in CSS pixels (defaults to screen center)
 * @param {number} o.count   number of pieces
 * @param {number} o.angle   launch direction in degrees (90 = straight up)
 * @param {number} o.spread  cone width in degrees
 * @param {number} o.power   launch speed
 * @param {string[]} o.shapes  rect, circle, star, heart, snow, streamer, blob
 * @param {string[]} o.colors  colors; 'A'..'D' mean the palette accents
 * @param {boolean} o.celebration  a reward effect (skipped entirely under reduced motion)
 * @param {number} o.gravity  downward pull per frame
 * @param {number} o.ttl  lifetime in frames (default 110–180)
 */
export function confetti({ x = innerWidth / 2, y = innerHeight / 2, count = 120, angle = 90, spread = 70, power = 14,
  shapes = ['rect', 'circle'], colors = null, celebration = false, gravity = 0.32, ttl = null } = {}) {
  if (!g2d) return;
  if (prefersReducedMotion()) {
    if (celebration) return;
    count = Math.min(count, 24);
  }
  if (isCalm()) count = Math.round(count * 0.5);
  count = Math.min(count, MAX_PIECES - particles.length);
  if (count <= 0) return;
  const palette = resolveColors(colors);
  for (let i = 0; i < count; i++) {
    const a = ((angle + (Math.random() - 0.5) * spread) * Math.PI) / 180;
    const v = power * (0.55 + Math.random() * 0.6);
    let shape = shapes[Math.floor(Math.random() * shapes.length)] || 'rect';
    // Classic confetti keeps its Stage 1 mix: mostly rectangles, a few dots.
    if (shapes.length === 2 && shapes[0] === 'rect' && shapes[1] === 'circle') shape = Math.random() > 0.85 ? 'circle' : 'rect';
    const w = shape === 'blob' ? 8 + Math.random() * 6 : shape === 'streamer' ? 4 : 5 + Math.random() * 5;
    particles.push({
      x, y, shape,
      vx: Math.cos(a) * v,
      vy: -Math.sin(a) * v,
      w,
      h: shape === 'streamer' ? 14 + Math.random() * 8 : Math.random() < 0.3 ? 3 + Math.random() * 2 : 8 + Math.random() * 6,
      s: shape === 'heart' ? 10 + Math.random() * 5 : shape === 'star' ? 4 + Math.random() * 3 : shape === 'snow' ? 5 + Math.random() * 4 : 0,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      wobble: Math.random() * Math.PI * 2,
      vw: 0.08 + Math.random() * 0.12,
      color: palette[i % palette.length],
      g: gravity,
      life: 0,
      ttl: (ttl ?? 110 + Math.random() * 70) + (shape === 'streamer' ? 40 : 0),
    });
  }
  if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(tick); }
}

/** Stop and clear all confetti (page hidden, data replaced). */
export function clearConfetti() {
  particles = [];
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  g2d?.clearRect(0, 0, innerWidth, innerHeight);
}

function drawPiece(p) {
  switch (p.shape) {
    case 'circle':
      g2d.beginPath();
      g2d.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      g2d.fill();
      break;
    case 'blob':
      g2d.beginPath();
      g2d.ellipse(0, 0, p.w / 2, p.w / 2.4, 0, 0, Math.PI * 2);
      g2d.fill();
      break;
    case 'star':
      if (!STAR) { g2d.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); break; }
      g2d.scale(p.s, p.s);
      g2d.fill(STAR);
      break;
    case 'heart':
      if (!HEART) { g2d.fillRect(-p.s / 3, -p.s / 3, p.s / 1.5, p.s / 1.5); break; }
      g2d.scale(p.s, p.s);
      g2d.fill(HEART);
      break;
    case 'snow':
      g2d.strokeStyle = p.color;
      g2d.lineWidth = 1.5;
      g2d.lineCap = 'round';
      g2d.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        g2d.moveTo(-Math.cos(a) * p.s, -Math.sin(a) * p.s);
        g2d.lineTo(Math.cos(a) * p.s, Math.sin(a) * p.s);
      }
      g2d.stroke();
      break;
    default:
      g2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  }
}

function tick(now) {
  const dt = Math.min(3, (now - lastT) / 16.67); // frame-rate independent (60fps = 1)
  lastT = now;
  g2d.clearRect(0, 0, innerWidth, innerHeight);
  particles = particles.filter((p) => p.life < p.ttl && p.y < innerHeight + 40);
  for (const p of particles) {
    p.life += dt;
    p.vx *= Math.pow(0.985, dt);
    p.vy = p.vy * Math.pow(0.985, dt) + p.g * dt;
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
    drawPiece(p);
    g2d.restore();
  }
  if (particles.length) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = 0;
    g2d.clearRect(0, 0, innerWidth, innerHeight);
  }
}

/** Full "workout logged" celebration from a screen point, in the equipped skin's style. */
export function celebrateLog(origin = {}) {
  haptic('success');
  sound.skin();
  const skin = SKINS[currentLook().skin] || SKINS.classic;
  const look = { shapes: skin.confetti.shapes, colors: skin.confetti.colors };
  const x = origin.x ?? innerWidth / 2;
  const y = origin.y ?? innerHeight * 0.75;
  confetti({ x, y, count: 110, angle: 90, spread: 60, power: 17, ...look });
  setTimeout(() => {
    confetti({ x, y, count: 50, angle: 120, spread: 40, power: 13, ...look });
    confetti({ x, y, count: 50, angle: 60, spread: 40, power: 13, ...look });
  }, 120);
}
