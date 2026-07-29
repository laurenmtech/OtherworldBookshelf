// Service worker for Otherworld Reads — offline support via cache-first for the app shell.
//
// BUILD must increase on EVERY deploy that changes any file in ASSETS — a
// deploy that doesn't move it serves stale files to everyone who already has
// the app installed. .githooks/pre-push refuses such a push.
//
// APP_VERSION in js/main.js also bumps every release, but it's the human-facing
// stamp (0.<phase><release>) and this is the cache key. The footer shows this
// number, read back from the installed cache — so it answers "what is my phone
// actually running?" rather than what a constant somewhere claims.
const BUILD = 20;
const CACHE = 'otherworld-reads-build-' + BUILD;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './firebase-config.js',

  './styles/tokens.css',
  './styles/base.css',
  './styles/components.css',

  './js/main.js',
  './js/state/store.js',
  './js/state/migrate.js',
  './js/state/persist-local.js',
  './js/state/persist-cloud.js',
  './js/state/auth.js',
  './js/routes/router.js',
  './js/routes/reading.js',
  './js/routes/finished.js',
  './js/components/header.js',
  './js/components/tab-bar.js',
  './js/components/hidden-shelf.js',
  './js/components/current-reads.js',
  './js/components/tbr-pile.js',
  './js/components/finished-list.js',
  './js/components/places.js',
  './js/components/modals/finish-modal.js',
  './js/components/modals/book-modal.js',
  './js/components/modals/place-modal.js',
  './js/ui/dom.js',
  './js/ui/modal.js',
  './js/ui/sheet.js',
  './js/ui/chips.js',

  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];
// Cross-origin hosts we cache for offline (SDKs + fonts). NOT API/data hosts.
const CDN_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = CDN_HOSTS.includes(url.hostname);
  // Let the browser handle data/API calls (Firestore, auth) — Firestore does its own offline cache.
  if (!sameOrigin && !cdn) return;
  // Cache-first for the app shell + SDK/font CDN, falling back to network and caching the result.
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
