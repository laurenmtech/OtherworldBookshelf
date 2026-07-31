// Service worker for Otherworld Bookshelf — offline support via cache-first for the app shell.
//
// BUILD must increase on EVERY deploy that changes any file in ASSETS — a
// deploy that doesn't move it serves stale files to everyone who already has
// the app installed. .githooks/pre-push refuses such a push.
//
// APP_VERSION in js/main.js also bumps every release, but it's the human-facing
// stamp (0.<phase><release>) and this is the cache key. The footer shows this
// number, read back from the installed cache — so it answers "what is my phone
// actually running?" rather than what a constant somewhere claims.
const BUILD = 41;
const CACHE = 'otherworld-reads-build-' + BUILD;
// Cover art lives in its own cache, deliberately NOT keyed by BUILD: a cover is
// immutable (the id IS the image) and re-downloading every one of them on each
// deploy would be the most expensive thing this app does, for no gain.
const COVERS = 'otherworld-reads-covers';
const COVER_HOSTS = ['covers.openlibrary.org', 'books.google.com'];
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './firebase-config.js',
  './search-config.js',

  './styles/tokens.css',
  './styles/base.css',
  './styles/components.css',
  './styles/vibes/cottage.css',
  './styles/vibes/celestial.css',
  './styles/vibes/dark-academia.css',
  './styles/vibes/seaglass.css',

  './js/main.js',
  './js/state/store.js',
  './js/state/migrate.js',
  './js/state/moods.js',
  './js/state/persist-local.js',
  './js/state/persist-cloud.js',
  './js/state/auth.js',
  './js/services/books.js',
  './js/services/libby.js',
  './js/services/recommend.js',
  './js/services/series.js',
  './js/services/book-shape.js',
  './js/services/open-library.js',
  './js/services/google-books.js',
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
  './js/components/typeahead.js',
  './js/components/vibe-picker.js',
  './js/vibes/registry.js',
  './js/vibes/apply.js',
  './js/components/modals/finish-modal.js',
  './js/components/modals/book-modal.js',
  './js/components/modals/set-down-modal.js',
  './js/components/modals/recommend-modal.js',
  './js/components/modals/place-modal.js',
  './js/ui/dom.js',
  './js/ui/modal.js',
  './js/ui/sheet.js',
  './js/ui/chips.js',
  './js/ui/book-meta.js',
  './js/ui/cover.js',
  './js/ui/mood-picker.js',
  './js/ui/reveal.js',

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
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== COVERS).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Covers: cache-first into their own bucket, so a shelf you've seen once is a
// shelf you can see on a plane. The response is opaque (an <img> is a no-cors
// request, so res.ok is false and res.status is 0) — that's expected here and
// is the one place this worker stores a response it can't read.
function handleCover(e) {
  e.respondWith(
    caches.open(COVERS).then((c) => c.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) c.put(e.request, res.clone());
        return res;
      }).catch(() => cached || Response.error());
    }))
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (COVER_HOSTS.includes(url.hostname)) return handleCover(e);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = CDN_HOSTS.includes(url.hostname);
  // Let the browser handle data/API calls (Firestore, auth, and the Open
  // Library search — which must FAIL offline rather than answer from a cache,
  // so the typeahead can say so and fall back to manual entry).
  if (!sameOrigin && !cdn) return;
  // Cache-first for the app shell + SDK/font CDN, scoped to THIS build's cache
  // rather than using a bare caches.match(), which
  // searches every cache including COVERS — a cover is stored opaque and keyed
  // by its own URL, so it could never answer a shell request, but a lookup that
  // can reach into a bucket with different rules is a lookup waiting to.
  e.respondWith(
    caches.open(CACHE).then((c) => c.match(req)).then((cached) => {
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
