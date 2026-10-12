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
import { renderInsights, leaveInsights, setInsightsBack } from './views/insights.js';
import { syncLook, initRewardsFlow } from './rewardsFlow.js';
import { dismissBanner } from './celebrate.js';

const VIEWS = {
  home: renderHome,
  history: renderHistory,
  goals: renderGoals,
  profile: renderProfile,
  insights: renderInsights, // a pushed sub-view (from Home or Goals), not a tab
};
const TABS = ['home', 'history', 'goals', 'profile'];
const INSIGHT_SECTIONS = ['calendar', 'trends', 'year'];

let current = null;
let insightsFrom = 'home'; // the tab Insights was opened from (stays highlighted, names the back chip)
let pushed = false;        // entering Insights pushed a history entry, so Back can pop it
const scrollMemo = {};     // tab → scrollY when Insights opened over it

/** '#insights/trends' → ['insights', { section: 'trends' }], '#recap/2026' → ['insights', { recap: '2026' }]. */
function parseHash(h = '') {
  const [name = '', arg = ''] = String(h).replace(/^#/, '').split('/');
  if (name === 'insights') return ['insights', INSIGHT_SECTIONS.includes(arg) ? { section: arg } : {}];
  if (name === 'recap' && /^\d{4}$/.test(arg)) return ['insights', { recap: arg }];
  return [name, {}];
}

// ---- Tabs ----

function show(name, params = {}) {
  if (!VIEWS[name]) name = 'home';
  const prev = current;
  const changed = name !== prev;
  if (changed && prev === 'insights') {
    leaveInsights();
    pushed = false;
  }
  if (name === 'insights') {
    if (TABS.includes(params.from)) insightsFrom = params.from;
    else if (TABS.includes(prev)) insightsFrom = prev;
  }
  if (changed && TABS.includes(prev)) scrollMemo[prev] = window.scrollY;
  const restore = changed && prev === 'insights' && name === insightsFrom ? scrollMemo[name] : null;
  current = name;
  if (changed && name === 'home') resetHomeWeek();

  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  const lit = name === 'insights' ? insightsFrom : name;
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === lit;
    t.classList.toggle('active', on);
    if (on && lit === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });

  const el = $(`#view-${name}`);
  VIEWS[name](el, name === 'insights' ? { ...params, from: insightsFrom } : params);
  if (restore != null) requestAnimationFrame(() => window.scrollTo({ top: restore }));
  else if (changed && !params.day && !params.goal && !params.section) window.scrollTo({ top: 0 });
  try {
    const hash = location.hash;
    if (name === 'insights' && changed && prev && !/^#(insights|recap)\b/.test(hash)) {
      history.pushState({ glow: 'sub' }, '', '#insights');
      pushed = true;
    } else if (hash !== `#${name}`) {
      history.replaceState(name === 'insights' ? history.state : null, '', `#${name}`);
    }
  } catch { /* some embedded frames don't allow URL changes */ }
}

setNavigator(show);

// The Insights back chip: pop the entry we pushed (so the browser's Back stays in step), else go to the tab.
setInsightsBack(() => {
  if (pushed && history.state?.glow === 'sub') history.back();
  else show(insightsFrom);
});

$$('.tab').forEach((tab) => {
  tab.querySelector('.tab-icon').innerHTML = icon(tab.dataset.icon);
  tab.addEventListener('click', (e) => {
    e.preventDefault();
    if (tab.dataset.tab === current) window.scrollTo({ top: 0, behavior: 'smooth' });
    else show(tab.dataset.tab);
  });
});

window.addEventListener('hashchange', () => show(...parseHash(location.hash)));

// Re-render the visible view whenever data changes.
store.subscribe((reason) => {
  if (current) VIEWS[current]($(`#view-${current}`), current === 'insights' ? { from: insightsFrom } : {});
  if (reason === 'workout:add' && store.state.workouts.length === 1) {
    // First workout: ask the browser not to evict our storage.
    navigator.storage?.persist?.().catch(() => {});
  }
});

store.onError((err) => {
  console.error(err);
  const full = err?.name === 'QuotaExceededError' || /quota/i.test(err?.message || '');
  toast(full ? 'Storage is full. Export a backup from Profile.' : "Couldn't save. Try again.", { duration: 6000, urgent: true });
});

// ---- Hold to log ----

const holdBtn = $('#hold-btn');
holdBtn.querySelector('.hold-plus').innerHTML = icon('plus');

// Starting a new hold clears a celebration banner out of the way.
holdBtn.addEventListener('pointerdown', dismissBanner);

initHoldButton(holdBtn, {
  duration: 1500,
  hint: $('#hold-hint'),
  onComplete(origin) {
    const before = store.derived(); // so the details sheet can tell what this log earned
    const workout = store.addWorkout(defaultWorkout());
    celebrateLog(origin);
    // Logging from Insights stays there, so she sees today's square light up.
    if (current !== 'home' && current !== 'insights') show('home');
    // Let the confetti pop before the sheet slides up.
    setTimeout(() => openLogSheet({ mode: 'fresh', workout, before }), 550);
  },
});

// Audio can only start after a user gesture (especially on iOS), so unlock on the first touch.
['pointerdown', 'touchend', 'keydown'].forEach((type) =>
  window.addEventListener(type, unlockAudio, { once: true, capture: true, passive: true }));

// ---- Theme ----

applyTheme(store.settings.theme);
syncLook({ force: true });

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

show(...parseHash(location.hash || '#home'));
document.body.classList.add('ready');
initRewardsFlow();

// The Home gift pill waits for celebrations to finish, so refresh when one ends.
document.addEventListener('glow:celebration-end', () => { if (current === 'home') show('home'); });
