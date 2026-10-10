// Slide-up bottom sheets and small confirm dialogs.

import { esc } from './util.js';
import { icon } from './icons.js';

const stack = []; // open sheets/dialogs, topmost last

function lockScroll() { document.body.classList.toggle('has-overlay', stack.length > 0); }

/**
 * Open a bottom sheet.
 * @param {object} o
 * @param {string} o.title       plain-text title (also used as the aria-label)
 * @param {string} [o.headHTML]  optional extra HTML shown above the title
 * @param {string} o.body        body HTML
 * @param {string} [o.footer]    sticky footer HTML (buttons)
 * @param {string} [o.className]
 * @param {(reason: string) => void} [o.onClose]  called once with 'dismiss' or whatever close() was given
 * @returns {{ el: HTMLElement, body: HTMLElement, close: (reason?: string) => void }}
 */
export function openSheet({ title = '', headHTML = '', body = '', footer = '', className = '', onClose } = {}) {
  const layer = document.createElement('div');
  layer.className = `sheet-layer ${className}`;
  layer.style.zIndex = String(200 + stack.length * 10);
  layer.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <div class="sheet-drag">
        <div class="sheet-grab" aria-hidden="true"><span></span></div>
        ${headHTML}
        <div class="sheet-head">
          <h2 class="sheet-title">${esc(title)}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button>
        </div>
      </div>
      <div class="sheet-body">${body}</div>
      ${footer ? `<div class="sheet-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(layer);

  const el = layer.querySelector('.sheet');
  const prevFocus = document.activeElement;
  const entry = { layer };
  stack.push(entry);
  lockScroll();

  // Two frames so the starting transform is painted before we animate.
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));
  setTimeout(() => el.focus({ preventScroll: true }), 60);

  let closed = false;
  function close(reason = 'dismiss') {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    el.style.transition = '';
    el.style.transform = '';
    layer.classList.remove('open');
    setTimeout(() => {
      layer.remove();
      stack.splice(stack.indexOf(entry), 1);
      lockScroll();
      prevFocus?.focus?.({ preventScroll: true });
    }, 320);
    onClose?.(reason);
  }

  layer.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close('dismiss');
  });

  function onKey(e) {
    if (e.key === 'Escape' && stack[stack.length - 1] === entry) close('dismiss');
  }
  document.addEventListener('keydown', onKey);

  enableDragToDismiss(el, layer.querySelector('.sheet-drag'), () => close('dismiss'));

  return { el, body: layer.querySelector('.sheet-body'), close };
}

/** Swipe the sheet down by its handle/header to dismiss it. */
function enableDragToDismiss(sheet, handle, onDismiss) {
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, a')) return;
    dragging = true;
    startY = lastY = e.clientY;
    lastT = performance.now();
    velocity = 0;
    sheet.style.transition = 'none';
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const now = performance.now();
    velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translate(-50%, ${dy}px)`;
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    const dy = lastY - startY;
    sheet.style.transition = '';
    if (dy > 110 || (dy > 30 && velocity > 0.6)) {
      onDismiss();
    } else {
      sheet.style.transform = '';
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/**
 * A small centered confirm dialog. Resolves true if confirmed.
 */
export function confirmDialog({ title, message = '', confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'dialog-layer';
    layer.style.zIndex = String(400 + stack.length * 10);
    layer.innerHTML = `
      <div class="dialog-backdrop" data-result="0"></div>
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" tabindex="-1">
        <h3 id="dlg-title">${esc(title)}</h3>
        ${message ? `<p>${esc(message)}</p>` : ''}
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-result="0">${esc(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-result="1">${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(layer);
    const entry = { layer };
    stack.push(entry);
    lockScroll();
    const prevFocus = document.activeElement;
    requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));
    setTimeout(() => layer.querySelector('[data-result="1"]').focus(), 60);

    function finish(result) {
      document.removeEventListener('keydown', onKey);
      layer.classList.remove('open');
      setTimeout(() => {
        layer.remove();
        stack.splice(stack.indexOf(entry), 1);
        lockScroll();
        prevFocus?.focus?.({ preventScroll: true });
      }, 220);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape' && stack[stack.length - 1] === entry) finish(false);
    }
    document.addEventListener('keydown', onKey);
    layer.addEventListener('click', (e) => {
      const r = e.target.closest('[data-result]');
      if (r) finish(r.dataset.result === '1');
    });
  });
}
