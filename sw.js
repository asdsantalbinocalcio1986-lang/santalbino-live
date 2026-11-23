const CACHE_PREFIX = 'santa-live-shell-';
const CACHE = `${CACHE_PREFIX}v31`;
const SHELL = [
  './home.html',
  './index.html',
  './regia.html',
  './preview.html',
  './config.js',
  './manifest.webmanifest',
  './santa-live-icon.svg?v=7',
  './hydra-goal.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || 'SANTALive';
  const options = {
    body: payload.body || 'È disponibile un aggiornamento della partita.',
    icon: './santa-live-icon.svg?v=7',
    badge: './santa-live-icon.svg?v=7',
    tag: payload.tag || 'santalive-match-update',
    renotify: false,
    data: { url: payload.url || './home.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './home.html', self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const cachePromise = caches.open(CACHE);
  const network = fetch(request).then(async response => {
    if (response.ok) {
      const cache = await cachePromise;
      await cache.put(request, response.clone());
    }
    return response;
  });

  if (request.mode === 'navigate') {
    event.waitUntil(network.then(() => undefined).catch(() => undefined));
    event.respondWith(
      network.catch(async () => {
        const cache = await cachePromise;
        return (await cache.match(request)) || (await cache.match('./home.html'));
      })
    );
    return;
  }

  event.waitUntil(network.then(() => undefined).catch(() => undefined));
  event.respondWith(
    cachePromise
      .then(cache => cache.match(request))
      .then(cached => cached || network)
  );
});
