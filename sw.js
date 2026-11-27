const CACHE_PREFIX = 'santa-live-shell-';
const CACHE = `${CACHE_PREFIX}v34`;
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
