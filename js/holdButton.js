// The big pink "HOLD TO LOG" button. Press and hold; a cyan ring fills around it.
// Let go early and it cancels. Hold for the full duration and it completes.

import { haptic, sound, unlockAudio } from './effects.js';

const RING_R = 46; // must match the <circle r> in index.html
const CIRC = 2 * Math.PI * RING_R;

/**
 * @param {HTMLButtonElement} btn
 * @param {object} opts
 * @param {number} opts.duration   hold time in ms
 * @param {(btn: HTMLElement) => void} opts.onComplete
 * @param {HTMLElement} [opts.hint] element shown when she lets go too early
 */
export function initHoldButton(btn, { duration = 1500, onComplete, hint }) {
  const ring = btn.querySelector('.hold-progress');
  ring.style.strokeDasharray = `${CIRC}`;
  setProgress(0);

  let holding = false;
  let completed = false;
  let startT = 0;
  let raf = 0;
  let hintTimer = 0;

  function setProgress(p) {
    ring.style.strokeDashoffset = `${CIRC * (1 - p)}`;
  }

  function begin() {
    if (holding || btn.classList.contains('cooldown')) return;
    unlockAudio();
    holding = true;
    completed = false;
    startT = performance.now();
    ring.style.transition = 'none';
    btn.classList.add('holding');
    btn.classList.remove('done');
    hideHint();
    haptic('press');
    sound.chargeStart(duration / 1000);
    raf = requestAnimationFrame(step);
  }

  function step(now) {
    if (!holding) return;
    const p = Math.min(1, (now - startT) / duration);
    // Ease-in-out so the ring starts gently and snaps closed at the end.
    setProgress(p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
    if (p >= 1) complete();
    else raf = requestAnimationFrame(step);
  }

  function complete() {
    holding = false;
    completed = true;
    sound.chargeStop();
    btn.classList.remove('holding');
    btn.classList.add('done', 'cooldown');
    const r = btn.getBoundingClientRect();
    onComplete?.({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    // Let the pulse play, then quietly reset the ring for next time.
    setTimeout(() => {
      ring.style.transition = 'stroke-dashoffset .5s ease, opacity .3s';
      setProgress(0);
      btn.classList.remove('done', 'cooldown');
    }, 900);
  }

  function cancel() {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(raf);
    sound.chargeStop();
    btn.classList.remove('holding');
    ring.style.transition = 'stroke-dashoffset .35s ease';
    setProgress(0);
    if (!completed) {
      sound.cancel();
      showHint();
    }
  }

  function showHint() {
    if (!hint) return;
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 1800);
  }
  function hideHint() {
    hint?.classList.remove('show');
  }

  // Pointer events cover touch, mouse and pen. Capturing the pointer means a
  // little finger wiggle off the button doesn't cancel the hold.
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    begin();
  });
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('lostpointercapture', cancel);

  // No long-press context menu / text selection on iOS & Android.
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  // Keyboard: hold Space or Enter.
  btn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); }
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cancel(); }
  });
  btn.addEventListener('blur', cancel);
  // A plain click (e.g. from a screen reader) shouldn't do anything surprising.
  btn.addEventListener('click', (e) => e.preventDefault());
}
