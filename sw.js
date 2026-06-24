/* Service worker for StockFlow PWA.
   - Caches the static app shell for fast/offline loading.
   - NEVER caches API calls (/api/*) so stock data is always live.
   - Bump CACHE_VERSION whenever app files change to force an update. */
const CACHE_VERSION = 'stockflow-v1';
const SHELL = [
    '/', '/index.html', '/style.css', '/app.js', '/data.js', '/icon.svg', '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Only handle same-origin GET requests
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;

    // API calls: always go to the network (never serve stale data)
    if (url.pathname.startsWith('/api/')) return;

    // Static assets: cache-first, fall back to network and update cache
    event.respondWith(
        caches.match(req).then(cached => {
            const network = fetch(req).then(res => {
                if (res && res.status === 200) {
                    const copy = res.clone();
                    caches.open(CACHE_VERSION).then(c => c.put(req, copy));
                }
                return res;
            }).catch(() => cached);
            return cached || network;
        })
    );
});
