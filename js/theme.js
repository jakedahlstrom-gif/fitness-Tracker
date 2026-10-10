// Dark / light / auto theme handling. The equipped look (palette + button skin)
// has a dark and a light set, so it's re-applied whenever the mode changes.

import { applyLook, currentLook } from './looks.js';

const media = window.matchMedia?.('(prefers-color-scheme: light)');
let pref = 'dark';

function resolved() {
  return pref === 'auto' ? (media?.matches ? 'light' : 'dark') : pref;
}

export function applyTheme(next = pref) {
  pref = next;
  const theme = resolved();
  document.documentElement.dataset.glowTheme = theme;
  paintLook(theme);
}

/** Re-apply the current look for the current mode (also sets the browser bar color). */
export function paintLook(theme = resolved()) {
  applyLook(currentLook(), theme);
}

// Follow the system setting live when "Auto" is chosen.
media?.addEventListener?.('change', () => { if (pref === 'auto') applyTheme(); });
