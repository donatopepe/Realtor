/*
 * Realtor — service worker (uso offline della PWA).
 *
 * Strategia:
 *   - app shell in cache-first: l'app si apre anche senza rete;
 *   - richieste non GET (invio schede) mai intercettate né messe in cache;
 *   - richieste verso altre origini (l'API configurata dall'utente) non toccate;
 *   - ogni attivazione elimina le cache di versioni precedenti.
 *
 * Per pubblicare una nuova versione dell'app basta incrementare CACHE_VERSION.
 *
 * MIT License — Copyright (c) 2014-2026 Donato Pepe (vedi LICENSE).
 */

const CACHE_VERSION = 'realtor-v1';

/** File necessari ad aprire l'app senza rete. */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/index.css',
  './js/mobileinit.js',
  './js/app.js',
  './js/platform.js',
  './js/core/api.js',
  './js/core/crypto.js',
  './js/core/backup.js',
  './js/core/migration.js',
  './js/core/schema.js',
  './js/core/settings.js',
  './js/core/storage.js',
  './js/jquery/jquery-2.1.0.min.js',
  './js/jquery/jquery.mobile-1.4.2.min.js',
  './js/jquery/jquery.mobile-1.4.2.min.css',
  './js/jquery/jquery.mobile.structure-1.4.2.min.css',
  './img/icon-192.png',
  './img/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Solo la stessa origine dell'app: l'API dell'utente resta fuori dalla cache.
  if (url.origin !== self.location.origin) return;
  // Lo shim di cordova.js viene servito dal server di sviluppo: non serve in cache.
  if (url.pathname.endsWith('/cordova.js')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const fromNetwork = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match('./index.html'));

      return cached || fromNetwork;
    }),
  );
});
