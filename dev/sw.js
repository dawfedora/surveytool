const CACHE_NAME = 'edgewood-shell';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './sw.js'
];

// INSTALL
self.addEventListener('install', event => {

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );
});

// ACTIVATE
self.addEventListener('activate', event => {

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
});

// FETCH
self.addEventListener('fetch', event => {

  const request = event.request;

  // only same-origin GET
  if (
    request.method !== 'GET' ||
    new URL(request.url).origin !== location.origin
  ) {
    return;
  }

  const url = new URL(request.url);

  // never cache mutable datasets
  if (
    url.pathname.endsWith('/plants.json') ||
    url.pathname.endsWith('/trails.json') ||
    url.pathname.endsWith('/version.json')
  ) {
    return;
  }

  // normalize shell URLs
  let cacheKey = request;

  if (
    url.pathname === '/' ||
    url.pathname.endsWith('/index.html')
  ) {
    cacheKey = './index.html';
  }

  event.respondWith(

    caches.match(cacheKey).then(cached => {

      // CACHE FIRST
      if (cached) {
        return cached;
      }

      // fallback for unexpected assets
      return fetch(request).then(response => {

        // cache successful same-origin responses
        if (
          response.ok &&
          response.type === 'basic'
        ) {

          const copy = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(cacheKey, copy);
            });
        }

        return response;
      });
    })
  );
});
