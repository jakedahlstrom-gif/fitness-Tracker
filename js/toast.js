// Small pill messages that float above the tab bar, with an optional action (e.g. "Undo").

import { esc } from './util.js';

let current = null;

/**
 * @param {string} message
 * @param {object} [o]
 * @param {{label: string, fn: () => void}} [o.action]
 * @param {number} [o.duration] ms before it disappears
 * @param {() => void} [o.onExpire] runs if it goes away without the action being tapped
 */
export function toast(message, { action = null, duration = 3000, onExpire = null } = {}) {
  current?.dismiss();
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-msg">${esc(message)}</span>${
    action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ''}`;
  root.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

  let acted = false;
  let gone = false;
  const timer = setTimeout(dismiss, duration);

  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
    if (!acted) onExpire?.();
    if (current === handle) current = null;
  }

  el.querySelector('.toast-action')?.addEventListener('click', () => {
    acted = true;
    action.fn();
    dismiss();
  });

  const handle = { dismiss };
  current = handle;
  return handle;
}
