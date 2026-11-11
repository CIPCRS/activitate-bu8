// Service worker: aplicația se deschide și fără semnal (fișierele rămân pe telefon).
// La fiecare versiune nouă urcată pe GitHub, numărul de mai jos trebuie să fie altul.
const VERSION = '1.3.0';
// Numele cache-ului conține adresa aplicației: mai multe aplicații stau pe același domeniu github.io
// și fiecare trebuie să-și curețe doar propriile fișiere vechi.
const PREFIX = 'activitate|' + self.registration.scope + '|';
const CACHE = PREFIX + VERSION;
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'vendor/firebase-app-compat.js', 'vendor/firebase-auth-compat.js', 'vendor/firebase-firestore-compat.js', 'vendor/xlsx.mini.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => (k.startsWith(PREFIX) && k !== CACHE) || k.startsWith('pontaj-tc-v')).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.href.startsWith(self.registration.scope)) return;   // Firebase și alte aplicații: direct pe rețea
  if (u.pathname.includes('/vendor/') || u.pathname.endsWith('.png')) {       // biblioteci: din cache
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request)).then(r => r || fetch(e.request)));
    return;
  }
  // pagina, app.js, config.js: întâi rețeaua (ca să vină versiunea nouă), cache dacă nu e semnal
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.open(CACHE).then(c => c.match(e.request).then(r => r || c.match('index.html')))));
});
