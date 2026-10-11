// Service worker: caches the app so it opens instantly and works offline.
//
// When you deploy changes, bump CACHE_VERSION. Phones will download the new files
// in the background and show an "Update" prompt the next time the app is opened.

const CACHE_VERSION = 'glow-v1.2.1';

// Third-party files (Chart.js for Insights) live in their own cache that survives app
// releases: the URLs are version-pinned, so an entry never goes stale. Only exact
// allowlisted URLs are cached. Keep CHART_URL identical to js/charts.js.
const CDN_CACHE = 'glow-cdn-v1';
const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.js';
const CDN_ALLOW = [CHART_URL];
const CDN_WARM_MS = 8000;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/celebrate.css',
  './css/charts.css',
  './css/insights.css',
  './css/looks.css',
  './css/recap.css',
  './css/share.css',
  './css/styles.css',
  './css/trophies.css',
  './js/app.js',
  './js/backup.js',
  './js/backupFlow.js',
  './js/badgeArt.js',
  './js/badges.js',
  './js/celebrate.js',
  './js/charts.js',
  './js/components.js',
  './js/dates.js',
  './js/effects.js',
  './js/fireworks.js',
  './js/heatmap.js',
  './js/holdButton.js',
  './js/icons.js',
  './js/insights.js',
  './js/lab.js',
  './js/logSheet.js',
  './js/lookParts.js',
  './js/looks.js',
  './js/photos.js',
  './js/progress.js',
  './js/recap.js',
  './js/rewards.js',
  './js/rewardsFlow.js',
  './js/router.js',
  './js/schema.js',
  './js/shareCard.js',
  './js/sheet.js',
  './js/stats.js',
  './js/store.js',
  './js/studio.js',
  './js/theme.js',
  './js/toast.js',
  './js/util.js',
  './js/views/goals.js',
  './js/views/history.js',
  './js/views/home.js',
  './js/views/insights.js',
  './js/views/profile.js',
  './js/views/trophies.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

/** True for a response we may keep: a real CORS 200 (opaque no-cors responses can't be checked by SRI). */
const keepable = (res) => res && res.ok && res.type === 'cors';

/** Pre-cache Chart.js so Insights works offline even before she first opens it. Never fails the install. */
function warmCdn() {
  const work = caches.open(CDN_CACHE).then(async (cache) => {
    for (const url of CDN_ALLOW) {
      if (await cache.match(url, { ignoreVary: true })) continue;
      const res = await fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));
      if (keepable(res)) await cache.put(url, res);
    }
  }).catch(() => {});
  const timeout = new Promise((resolve) => setTimeout(resolve, CDN_WARM_MS));
  return Promise.race([work, timeout]).catch(() => {});
}

/** Drop CDN entries that are no longer allowlisted (e.g. the old Chart.js after a pin bump). */
function pruneCdn() {
  return caches.open(CDN_CACHE)
    .then((cache) => cache.keys().then((reqs) => Promise.all(
      reqs.filter((r) => !CDN_ALLOW.includes(r.url)).map((r) => cache.delete(r)),
    )))
    .catch(() => {});
}

/** Allowlisted CDN file: cache first; store only real CORS 200s; offline → a network error (fires the script's onerror). */
async function cdnFirst(event) {
  const { request } = event;
  try {
    const cache = await caches.open(CDN_CACHE);
    const hit = await cache.match(request.url, { ignoreVary: true });
    if (hit) return hit;
    const res = await fetch(request);
    if (keepable(res)) event.waitUntil(cache.put(request.url, res.clone()).catch(() => {}));
    return res;
  } catch {
    return Response.error();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([
    caches.open(CACHE_VERSION)
      // cache: 'reload' skips the browser's HTTP cache so we always get fresh files.
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })))),
    warmCdn(),
  ]));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(pruneCdn)
      .then(() => self.clients.claim()),
  );
});

// The page asks us to take over right away when she taps "Update".
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Page loads: serve the cached app shell (works offline), fall back to network.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request)),
    );
    return;
  }

  // Our own files: cache first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request)),
    );
    return;
  }

  // Allowlisted CDN files (Chart.js): cache first. Every other cross-origin request
  // is left to the browser.
  if (CDN_ALLOW.includes(request.url)) event.respondWith(cdnFirst(event));
});
