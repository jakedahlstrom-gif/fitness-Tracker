// Small pill messages that float above the tab bar, with an optional action (e.g. "Undo").
// The 'win' variant is the small celebration pill (an icon chip, a title and a sub-line).

import { esc } from './util.js';
import { icon as iconSVG } from './icons.js';

let current = null;
let isBusy = () => false;
let deferred = null;

/** The celebration director registers this; while it returns true, ordinary toasts wait. */
export function setToastGate(fn) { isBusy = fn; }

/** Hide whatever toast is showing (a celebration is about to take the stage). Errors stay. */
export function dismissToast() { if (!current?.urgent) current?.dismiss(); }

/** Show the toast that waited for a celebration to finish (only the latest one is kept). */
export function flushToasts() {
  if (!deferred || isBusy()) return;
  const [message, opts] = deferred;
  deferred = null;
  toast(message, opts);
}

/**
 * @param {string} message
 * @param {object} [o]
 * @param {{label: string, fn: () => void}} [o.action]
 * @param {number} [o.duration] ms before it disappears
 * @param {() => void} [o.onExpire] runs if it goes away without the action being tapped
 * @param {boolean} [o.urgent] show even while a celebration is playing (errors)
 * @param {'win'} [o.variant]  celebration pill
 * @param {string} [o.icon]    win: icon name
 * @param {string} [o.color]   win: accent color name (pink, lime…)
 * @param {string} [o.sub]     win: second line
 * @param {() => void} [o.onTap] tapping the pill body (default: dismiss)
 */
export function toast(message, opts = {}) {
  const { action = null, duration = 3000, onExpire = null, urgent = false, variant = null, sub = '', color = 'cyan', icon = 'sparkle', onTap = null } = opts;
  // Ordinary toasts wait while a celebration plays or an error is showing; the latest one is kept.
  if (!urgent && (current?.urgent || (variant !== 'win' && isBusy()))) {
    if (variant !== 'win') deferred = [message, opts];
    return { dismiss() { if (deferred?.[0] === message) deferred = null; }, el: null };
  }
  current?.dismiss();
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  const actionHTML = action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : '';
  if (variant === 'win') {
    el.className = `toast win-pill c-${color}`;
    el.innerHTML = `
      <span class="wp-chip" aria-hidden="true">${iconSVG(icon)}<span class="wp-rays">${'<i></i>'.repeat(8)}</span></span>
      <span class="wp-text"><span class="wp-title">${esc(message)}</span>${sub ? `<span class="wp-sub">${esc(sub)}</span>` : ''}</span>
      ${actionHTML}`;
  } else {
    el.className = urgent ? 'toast urgent' : 'toast';
    el.innerHTML = `<span class="toast-msg">${esc(message)}</span>${actionHTML}`;
  }
  root.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!gone) el.classList.add('show'); }));

  let acted = false;
  let gone = false;
  const timer = setTimeout(dismiss, duration);

  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.remove('show');
    el.classList.add('hide');
    setTimeout(() => el.remove(), 250);
    if (!acted) onExpire?.();
    if (current === handle) current = null;
    if (urgent) setTimeout(flushToasts, 260);
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('.toast-action')) {
      acted = true;
      action.fn();
      dismiss();
    } else if (variant === 'win') {
      onTap?.();
      dismiss();
    }
  });

  const handle = { dismiss, el, urgent };
  current = handle;
  return handle;
}
