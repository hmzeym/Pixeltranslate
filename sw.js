/* Pixel Translate: lets the app open and work without a connection.
   - the app's own files are kept and used when the network is away;
   - the reading engine files (loaded from a public file host once) are kept for good, so reading works offline;
   - everything else (Claude, the translation model download) is never touched by this file. */
const SHELL_CACHE = 'pixel-translate-shell-v2';
const ENGINE_CACHE = 'pixel-translate-engine-v1';
const params = new URL(self.location.href).searchParams;
const CDN = (params.get('cdn') || 'https://cdn.jsdelivr.net/npm').replace(/\/$/, '');
const CDN_ORIGIN = new URL(CDN).origin;
const SCOPE = self.registration.scope;
/* pages ask for same-address paths; they are served from the public file host (and kept) */
const MAP = [
  [SCOPE + '_e/tess/', CDN + '/tesseract.js@5.1.1/dist/'],
  [SCOPE + '_e/core/', CDN + '/tesseract.js-core@5.1.1/']
];
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'mt-worker.js', 'eng.traineddata.gz'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('pixel-translate-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function cacheFirst(cacheName, key, fetchReq) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(fetchReq);
  if (res && res.ok) { try { await cache.put(key, res.clone()); } catch (err) { /* storage full: still answer */ } }
  return res;
}
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => null);
    return res;
  } catch (err) {
    const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('./') || await cache.match('index.html') : null);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  for (const [from, to] of MAP) {
    if (req.url.startsWith(from)) {
      const target = to + req.url.slice(from.length).split('?')[0];
      e.respondWith(cacheFirst(ENGINE_CACHE, new Request(from + req.url.slice(from.length).split('?')[0]), new Request(target, { mode: 'cors', credentials: 'omit' })));
      return;
    }
  }
  if (url.origin === CDN_ORIGIN && url.origin !== self.location.origin) {
    e.respondWith(cacheFirst(ENGINE_CACHE, req, req));
    return;
  }
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
});
