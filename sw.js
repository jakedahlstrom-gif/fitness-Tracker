// Service worker: caches the app so it opens instantly and works offline.
//
// When you deploy changes, bump CACHE_VERSION. Phones will download the new files
// in the background and show an "Update" prompt the next time the app is opened.

const CACHE_VERSION = 'glow-v1.0.1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/backup.js',
  './js/backupFlow.js',
  './js/components.js',
  './js/dates.js',
  './js/effects.js',
  './js/holdButton.js',
  './js/icons.js',
  './js/logSheet.js',
  './js/photos.js',
  './js/router.js',
  './js/sheet.js',
  './js/stats.js',
  './js/store.js',
  './js/theme.js',
  './js/toast.js',
  './js/util.js',
  './js/views/goals.js',
  './js/views/history.js',
  './js/views/home.js',
  './js/views/profile.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // cache: 'reload' skips the browser's HTTP cache so we always get fresh files.
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
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

  // CDN files (e.g. Chart.js in a later stage): cache after first use.
  event.respondWith(
    caches.open(`${CACHE_VERSION}-cdn`).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
