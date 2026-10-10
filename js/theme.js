// Dark / light / auto theme handling.

const media = window.matchMedia?.('(prefers-color-scheme: light)');
let pref = 'dark';

function resolved() {
  return pref === 'auto' ? (media?.matches ? 'light' : 'dark') : pref;
}

export function applyTheme(next = pref) {
  pref = next;
  const theme = resolved();
  document.documentElement.dataset.glowTheme = theme;
  // Match the browser/status bar to the background.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#0B0D12');
}

// Follow the system setting live when "Auto" is chosen.
media?.addEventListener?.('change', () => { if (pref === 'auto') applyTheme(); });
