// CLAVIS ASTRAE service worker.
// Caches the whole app for offline use. Never fetches anything from other origins.
// A new version waits until the user presses UPDATE (no automatic skipWaiting).
importScripts('./assets.js');

const CACHE = 'clavis-astrae-' + self.CLAVIS_VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(self.CLAVIS_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('./index.html')) || fetch(req);
    }
    return (await cache.match(req, { ignoreSearch: true })) || fetch(req);
  })());
});
