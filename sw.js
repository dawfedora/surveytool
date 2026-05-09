const CACHE_NAME = 'edgewood-shell-v1';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json'
];

// INSTALL
self.addEventListener('install', event => {
  console.log('[SW] install');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );

  self.skipWaiting();
});

// ACTIVATE
self.addEventListener('activate', event => {
  console.log('[SW] activate');

  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );

  self.clients.claim();
});

// FETCH
self.addEventListener('fetch', event => {

  const url = new URL(event.request.url);

  // NEVER intercept plant/trail data
  if (
    url.pathname.endsWith('/plants.json') ||
    url.pathname.endsWith('/trails.json')
  ) {
    return;
  }

  // ONLY handle same-origin GET requests
  if (
    event.request.method !== 'GET' ||
    url.origin !== location.origin
  ) {
    return;
  }

  // Network first for app shell
  event.respondWith(

    fetch(event.request)
      .then(response => {

        // Update cache with fresh copy
        const copy = response.clone();

        caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, copy));

        return response;
      })

      .catch(() => {
        // Offline fallback
        return caches.match(event.request);
      })
  );
});
