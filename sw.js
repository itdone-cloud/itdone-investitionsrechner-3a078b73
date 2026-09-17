// Network-first service worker: the page is always fetched fresh when online,
// the cache only answers when the network fails. Cache-first showed stale pages
// after every deploy (2026-09-05), so this order is deliberate.
const CACHE = 'site-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((s) => s.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
