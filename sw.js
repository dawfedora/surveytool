// DO NOT REFORMAT deploy.bash depends on this line
const CACHE_NAME = 'FoE:survey-V260620.1459';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './sw.js',
  './version.json',
  './plants.json',
  './trails.json',
  './participants.json',
  './manifest.json',
  './icons/foe-icon-512.png',
  './icons/foe-icon-192.png',
  './foe-logo.png'
];

if (CACHE_NAME === '__CACHE_NAME__') {
  throw new Error('CACHE_NAME not injected');
}

self.addEventListener('install', handleInstall);

self.addEventListener('activate', handleActivate);

self.addEventListener('fetch', handleFetch);

// INSTALL
async function handleInstall(event) {
  event.waitUntil( cacheAppShell());
  self.skipWaiting();
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.all(
    APP_SHELL.map(async file => {
      console.log( 'caching:', file);

      const response = await fetch(file, { cache: "reload" });
      if (!response.ok) {
        throw new Error(`Failed ${file}`);
      }

      await cache.put(file, response);
    })
  );
}

// ACTIVATE
function handleActivate(event) {
  event.waitUntil(deleteOldCaches());
}

async function deleteOldCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys.map(key => {
      if (key !== CACHE_NAME) {
        return caches.delete(key);
      }
    })
  );
  await clients.claim();
}

// FETCH
function handleFetch(event) {
  const rq = event.request;

  // only same-origin GET
  if (rq.method !== 'GET' || new URL(rq.url).origin !== location.origin) {
    return;
  }
  event.respondWith(fetchFromCache(rq));
}

async function fetchFromCache(request) {

  if (request.cache === 'reload') {
    return fetch(request);
  }

  const url = new URL(request.url);

  let cacheKey = `.${url.pathname}`;
  if (cacheKey === './') {
    cacheKey = './index.html';
  }

  const cached = await caches.match(cacheKey);

  if (cached) {
    return cached;
  }

  // unexpected miss
  return fetch(request, { cache: 'reload' });
}
