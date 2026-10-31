// Waqt service worker — offline support for the Waqt prayer-times site.
// PERMANENT RULE: network-first for everything — every same-origin GET is
// fetched fresh (with HTTP-cache revalidation forced), and the cache is an
// offline fallback only. Nothing is ever served cache-first, so site
// updates always reach users on their next visit. Bump CACHE_VERSION on
// each service-worker change to force the old caches to be purged.
var CACHE_VERSION = 'waqt-v4';
var PRECACHE = ['./', './index.html', './logo.png', './icon-192.png', './manifest.json'];

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

  // Network-first for EVERY same-origin GET — pages, scripts, data and
  // images alike. {cache: 'no-cache'} forces revalidation so the HTTP
  // cache on GitHub Pages cannot serve a stale copy either. The service
  // worker cache is written on success and read only when the network
  // fails (offline fallback).
  event.respondWith(
    fetch(request, { cache: 'no-cache' }).then(function (response) {
      var copy = response.clone();
      caches.open(CACHE_VERSION).then(function (cache) { cache.put(request, copy); });
      return response;
    }).catch(function () {
      return caches.match(request, { ignoreSearch: true });
    })
  );
});
