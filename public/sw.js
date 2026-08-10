// Bumped to v2 so the activate handler purges v1 caches, which could hold
// private /api/state payloads and error responses written by the old logic.
const CACHE_NAME = "owner-dashboard-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"];

// Never persist these to Cache Storage: /api/state carries revenue figures and
// phone numbers, and /api/login handles credentials. Both belong in memory only.
const NEVER_CACHE = ["/api/state", "/api/login"];

function isCacheable(response) {
  // Caching a 401/500 would let the service worker replay an error (or a login
  // redirect) back to the app long after the server recovered.
  return response && response.ok && response.type !== "opaque";
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

  if (NEVER_CACHE.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          putIfCacheable(request, response);
          return response;
        })
        .catch(() => caches.match(request))
    );
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
