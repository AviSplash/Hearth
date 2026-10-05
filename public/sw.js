// Hearth service worker: the server is on the local network, so always try
// it first, and fall back to the last saved copy when it can't be reached
// (Wi-Fi blip, server rebooting). That keeps the wall screen showing the
// calendar instead of an error page.

const CACHE = 'hearth-v1';
const API_CACHE = 'hearth-api-v1';
const API_ENTRIES = 40;
const CORE = ['/', '/css/app.css', '/app/main.js', '/vendor/preact-htm.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - API_ENTRIES))) await cache.delete(k);
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/api/stream' || url.pathname.endsWith('.crt') || url.pathname.endsWith('.pem')) return;

  event.respondWith(
    (async () => {
      const isApi = url.pathname.startsWith('/api/');
      const cache = await caches.open(isApi ? API_CACHE : CACHE);
      const key = req.mode === 'navigate' ? '/' : req;
      try {
        const res = await Promise.race([fetch(req), timeout(isApi ? 8000 : 5000)]);
        if (res.ok) {
          await cache.put(key, res.clone());
          if (isApi) trim(cache);
        }
        return res;
      } catch (err) {
        const hit = await cache.match(key, { ignoreVary: true });
        if (!hit) throw err;
        if (!isApi) return hit;
        // Let the page know this is saved data so it can say it's offline.
        const headers = new Headers(hit.headers);
        headers.set('X-Hearth-Offline', '1');
        return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
      }
    })(),
  );
});
