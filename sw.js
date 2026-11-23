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


self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (_) {}
    const title = typeof data.title === 'string' ? data.title.slice(0, 120) : "SANTA Live";
    const options = {
      body: typeof data.body === 'string' ? data.body.slice(0, 500) : "Aggiornamento della partita",
      icon: data.icon || './santa-live-icon.svg',
      badge: data.badge || './santa-live-icon.svg',
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 180) : 'santalive-update',
      data: { url: typeof data.url === 'string' ? data.url : './home.html' },
      renotify: false,
    };
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const raw = event.notification?.data?.url || './home.html';
  event.waitUntil((async () => {
    let target = new URL('./home.html', self.location.origin);
    try {
      const parsed = new URL(raw, self.location.origin);
      if (parsed.origin === self.location.origin) target = parsed;
    } catch (_) {}
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
