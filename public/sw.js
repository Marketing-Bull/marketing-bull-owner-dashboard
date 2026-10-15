// Bumped to v3 so the activate handler purges old caches, including private
// API responses written by the old logic. API data is never stored in Cache Storage.
const CACHE_NAME = "owner-dashboard-v3";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

function isCacheable(response) {
  // Caching a 401/500 would let the service worker replay an error (or a login
  // redirect) back to the app long after the server recovered.
  return response && response.ok && response.type !== "opaque" &&
    !/no-store/i.test(response.headers.get("Cache-Control") || "");
}

function putIfCacheable(request, response) {
  if (!isCacheable(response)) return;
  const clone = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        putIfCacheable(request, response);
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return caches.match("/");
      })
  );
});
