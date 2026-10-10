// App entry point: wires up tabs, the hold-to-log button, theme and offline support.

import { store } from './store.js';
import { icon } from './icons.js';
import { $, $$, isEmbedded } from './util.js';
import { applyTheme } from './theme.js';
import { setNavigator } from './router.js';
import { initHoldButton } from './holdButton.js';
import { celebrateLog, unlockAudio } from './effects.js';
import { openLogSheet, defaultWorkout } from './logSheet.js';
import { toast } from './toast.js';
import { renderHome, resetHomeWeek } from './views/home.js';
import { renderHistory } from './views/history.js';
import { renderGoals } from './views/goals.js';
import { renderProfile } from './views/profile.js';

const VIEWS = {
  home: renderHome,
  history: renderHistory,
  goals: renderGoals,
  profile: renderProfile,
};

let current = null;

// ---- Tabs ----

function show(name, params = {}) {
  if (!VIEWS[name]) name = 'home';
  const changed = name !== current;
  current = name;
  if (changed && name === 'home') resetHomeWeek();

  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });

  const el = $(`#view-${name}`);
  VIEWS[name](el, params);
  if (changed && !params.day) window.scrollTo({ top: 0 });
  try {
    if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  } catch { /* some embedded frames don't allow URL changes */ }
}

setNavigator(show);

$$('.tab').forEach((tab) => {
  tab.querySelector('.tab-icon').innerHTML = icon(tab.dataset.icon);
  tab.addEventListener('click', (e) => {
    e.preventDefault();
    if (tab.dataset.tab === current) window.scrollTo({ top: 0, behavior: 'smooth' });
    else show(tab.dataset.tab);
  });
});

window.addEventListener('hashchange', () => show(location.hash.slice(1)));

// Re-render the visible view whenever data changes.
store.subscribe((reason) => {
  if (current) VIEWS[current]($(`#view-${current}`));
  if (reason === 'workout:add' && store.state.workouts.length === 1) {
    // First workout: ask the browser not to evict our storage.
    navigator.storage?.persist?.().catch(() => {});
  }
});

store.onError((err) => {
  console.error(err);
  const full = err?.name === 'QuotaExceededError' || /quota/i.test(err?.message || '');
  toast(full ? 'Storage is full. Export a backup from Profile.' : "Couldn't save. Try again.", { duration: 6000 });
});

// ---- Hold to log ----

const holdBtn = $('#hold-btn');
holdBtn.querySelector('.hold-plus').innerHTML = icon('plus');

initHoldButton(holdBtn, {
  duration: 1500,
  hint: $('#hold-hint'),
  onComplete(origin) {
    const workout = store.addWorkout(defaultWorkout());
    celebrateLog(origin);
    if (current !== 'home') show('home');
    // Let the confetti pop before the sheet slides up.
    setTimeout(() => openLogSheet({ mode: 'fresh', workout }), 550);
  },
});

// Audio can only start after a user gesture (especially on iOS), so unlock on the first touch.
['pointerdown', 'touchend', 'keydown'].forEach((type) =>
  window.addEventListener(type, unlockAudio, { once: true, capture: true, passive: true }));

// ---- Theme ----

applyTheme(store.settings.theme);

// ---- Midnight rollover: refresh "today" if the app stays open past midnight ----

let lastDay = new Date().toDateString();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const day = new Date().toDateString();
  if (day !== lastDay) { lastDay = day; show(current); }
});

// ---- Offline support (service worker) ----

// Skipped inside another page's frame (e.g. a claude.ai preview link), where service workers aren't allowed.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !isEmbedded()) {
  try { registerServiceWorker(); } catch (err) { console.warn('Offline support unavailable', err); }
}

function registerServiceWorker() {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const promptUpdate = () => toast('A new version of Glow is ready ✨', {
      duration: 20000,
      action: { label: 'Update', fn: () => reg.waiting?.postMessage('skipWaiting') },
    });
    if (reg.waiting && hadController) promptUpdate();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate();
      });
    });
    // Check for a new version whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((err) => console.warn('Service worker registration failed', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

// ---- Go ----

show(location.hash.slice(1) || 'home');
document.body.classList.add('ready');
