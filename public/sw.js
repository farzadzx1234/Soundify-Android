const CACHE_VERSION = "soundify-v1.0.31-b32";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const MEDIA_CACHE = `${CACHE_VERSION}-media`;
const PRESERVED_COVER_CACHE = "soundify-covers-v1";

// On Capacitor Android Native (https://localhost or capacitor://localhost), web assets are bundled
// inside the APK. A caching Service Worker traps upgraded users on stale UI/JS builds.
// If an older APK registered /sw.js, this self-destructing path unregisters it and purges stale caches.
const IS_CAPACITOR_LOCAL =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1" ||
  self.location.protocol === "capacitor:";

const PRECACHE_URLS = [
  "/",
  "/search",
  "/library",
  "/studio",
  "/settings",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/fonts/iranyekanx/IRANYekanXVF.woff2",
  "/fonts/iranyekanx/IRANYekanXVFaNumVF.woff2",
  "/fonts/sf-arabic/SFArabic-Bold.woff",
];

self.addEventListener("install", (event) => {
  if (IS_CAPACITOR_LOCAL) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(() => {
              // Non-blocking precache item failure
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  if (IS_CAPACITOR_LOCAL) {
    event.waitUntil(
      (async () => {
        try {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((k) => k !== PRESERVED_COVER_CACHE)
              .map((k) => caches.delete(k).catch(() => false))
          );
        } catch {
          // Non-blocking cache cleanup
        }
        try {
          await self.clients.claim();
        } catch {
          // Non-blocking claim
        }
        let matchedClients = [];
        try {
          matchedClients = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
        } catch {
          matchedClients = [];
        }
        try {
          await self.registration.unregister();
        } catch {
          // Non-blocking unregister
        }
        await Promise.all(
          matchedClients.map((client) => {
            try {
              if ("navigate" in client && client.url) {
                return client.navigate(client.url).catch(() => undefined);
              }
            } catch {
              // Non-blocking navigate
            }
            return undefined;
          })
        );
      })()
    );
    return;
  }
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (IS_CAPACITOR_LOCAL) return;
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept HTTP 206 audio range streaming, auth, history, or user-personalized API queries
  if (
    url.pathname.includes("/stream") ||
    request.headers.has("range") ||
    url.pathname.startsWith("/api/auth") ||
    url.pathname.startsWith("/api/history") ||
    url.searchParams.has("liked") ||
    url.searchParams.has("reposted") ||
    url.searchParams.has("mine")
  ) {
    return;
  }

  // Navigation requests: NetworkFirst with cached shell fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request).then((m) => m || caches.match("/")))
    );
    return;
  }

  // Fonts, Next static bundles, icons: CacheFirst
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
            }
            return res;
          })
      )
    );
    return;
  }

  // Cover art images: StaleWhileRevalidate
  if (/^\/api\/tracks\/[^/]+\/cover$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkPromise = fetch(request)
          .then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(MEDIA_CACHE).then((c) => c.put(request, clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })
    );
    return;
  }

  // Public catalog & lyrics GET API: NetworkFirst with cache fallback so likes/uploads/edits stay fresh
  if (
    url.pathname.startsWith("/api/tracks") ||
    url.pathname.startsWith("/api/playlists") ||
    url.pathname.startsWith("/api/artists")
  ) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(MEDIA_CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});
