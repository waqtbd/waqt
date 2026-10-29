// Waqt service worker — offline support for the Waqt prayer-times site.
// Strategy: pages (HTML) are network-first so updates arrive promptly;
// static assets are cache-first. Bump CACHE_VERSION to force a refresh.
var CACHE_VERSION = 'waqt-v1';
var PRECACHE = ['./', './index.html', './logo.png', './manifest.json'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // addAll fails atomically; add items one by one so one miss can't break install.
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(url).catch(function () { /* ignore individual failures */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_VERSION) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let fonts/APIs go to network

  var isPage = request.mode === 'navigate' || (request.headers.get('accept') || '').indexOf('text/html') !== -1;
  if (isPage) {
    // Network-first for pages: fresh content wins, cache is the offline fallback.
    event.respondWith(
      fetch(request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(request, copy); });
        return response;
      }).catch(function () {
        return caches.match(request, { ignoreSearch: true });
      })
    );
  } else {
    // Cache-first for static assets (logo, manifest, etc.).
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (response) {
          var copy = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(request, copy); });
          return response;
        });
      })
    );
  }
});
