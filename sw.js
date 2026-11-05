const CACHE = 'pv-v6';
const SHELL = ['./', 'index.html', 'style.css?v=6', 'app.js?v=6', 'data.js?v=6', 'manifest.json', 'icon.svg', 'icon-192.png', 'qr.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
const put = (req, res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; };
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/photos/')) {
    // photos never change: cache first
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => put(e.request, r))));
  } else {
    // app files: always ask the server (skip the browser's HTTP cache), fall back to cache offline
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => put(e.request, r))
      .catch(() => caches.match(e.request).then(h => h || caches.match(e.request, { ignoreSearch: true }))));
  }
});
