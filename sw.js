// sw.js — Piano Listener offline cache
//
// A service worker MUST be served as a same-origin HTTP(S) resource; browsers
// silently refuse to register one built from a `blob:` URL
// (SecurityError: Failed to register a ServiceWorker — the script has an
// unsupported MIME type ('') / an insecure scheme). This file exists so the
// page can actually work offline after a first visit, rather than carrying
// registration code that can never succeed. See README.md § Known limitations.

var CACHE_NAME = 'piano-listener-v3';
var URLS_TO_CACHE = ['./', './index.html', './dsp.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function (c) { return c.addAll(URLS_TO_CACHE); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Stale-while-revalidate: serve the cached copy immediately if there is one
// (so the app shell loads instantly offline), and refresh the cache in the
// background from the network when it's reachable.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      var fetchPromise = fetch(e.request).then(function (response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(e.request, clone); });
        }
        return response;
      }).catch(function () { return cached; });
      return cached || fetchPromise;
    })
  );
});
