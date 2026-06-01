// DO NOT REFORMAT deploy.bash depends on this line
const CACHE_NAME = 'edgewood-dev-2026.05.31.1725';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './sw.js',
  './version.json',
  './plants.json',
  './trails.json',
  './foe-logo.png',
  './manifest.json'
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

  for (const file of APP_SHELL) {
    console.log( 'caching:', file);

    const response = await fetch(file);
    if (!response.ok) {
      throw new Error( `Failed ${file}`);
    }

    await cache.put( file, response.clone());
  }
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
  const url = new URL(request.url);

  // normalize shell URLs
  let cacheKey = url.pathname;
  if ( cacheKey === '/' || cacheKey.endsWith('/index.html')) {
    cacheKey = './index.html';
  }

  const cached = await caches.match(cacheKey);

  if (cached) {
    return cached;
  }

  // fallback
  const response = await fetch(request, { cache:'reload' });
  if ( response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey, response.clone());
  }

  return response;
}
