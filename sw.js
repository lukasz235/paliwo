// Service worker: zapisuje w pamięci podręcznej pliki aplikacji, żeby otwierała się szybko i bez sieci.
// Dane z arkusza zawsze idą przez internet. Zmień VERSION po każdej zmianie plików aplikacji.
const VERSION = 'paliwo-v4';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'lib.js',
  'config.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Najpierw sieć (żeby po aktualizacji pliki były świeże), a bez sieci pamięć podręczna.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
  );
});
