// Minimal PWA service worker to satisfy standalone installability criteria.
// Per explicit requirement: DO NOT cache assets or make this a local-first offline app.
// All requests pass straight to the network.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
})

// Direct network pass-through, no Cache API usage
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
