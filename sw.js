// Service worker: aplicația se deschide și fără semnal (fișierele rămân pe telefon).
// La fiecare versiune nouă urcată pe GitHub, schimbă numărul de mai jos.
const CACHE = 'pontaj-tc-v1.0.0';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'vendor/firebase-app-compat.js', 'vendor/firebase-auth-compat.js', 'vendor/firebase-firestore-compat.js', 'vendor/xlsx.mini.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Firebase merge direct pe rețea
  if (u.pathname.includes('/vendor/') || u.pathname.endsWith('.png')) {       // biblioteci: din cache
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }
  // pagina, app.js, config.js: întâi rețeaua (ca să vină versiunea nouă), cache dacă nu e semnal
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
