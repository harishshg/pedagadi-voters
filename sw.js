const CACHE = 'pv-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'data.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'qr.svg'];
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
    // app files: network first so updates show up, cache when offline
    e.respondWith(fetch(e.request).then(r => put(e.request, r)).catch(() => caches.match(e.request)));
  }
});
