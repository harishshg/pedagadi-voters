const CACHE = 'pv-v42';
const PHOTO_CACHE = 'pv-photos'; // kept across app updates
const SHELL = ['./', 'index.html', 'style.css?v=42', 'app.js?v=42', 'data.js?v=42', 'manifest.json', 'icon.svg', 'icon-192.png', 'qr.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== PHOTO_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/photos/')) {
    // photos never change: serve from the photo cache, otherwise fetch and save
    e.respondWith(caches.open(PHOTO_CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }))));
  } else {
    // app files: always ask the server (skip the browser's HTTP cache), fall back to cache offline
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request).then(h => h || caches.match(e.request, { ignoreSearch: true }))));
  }
});
