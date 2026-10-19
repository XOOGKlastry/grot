/* Network first: updates never leave the application pinned to an old release.
   Only cache our shell. Third-party map tiles and routing requests are excluded. */
var CACHE = 'grot-shell-20261019';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key.indexOf('grot-shell-') === 0 && key !== CACHE; }).map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.indexOf(new URL(self.registration.scope).pathname) !== 0) return;
  event.respondWith(fetch(event.request).then(function (response) {
    if (response.ok) { var copy = response.clone(); event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.put(event.request, copy); })); }
    return response;
  }).catch(function () { return caches.match(event.request).then(function (cached) { return cached || new Response('Brak połączenia. Połącz się z internetem i spróbuj ponownie.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }); }));
});
