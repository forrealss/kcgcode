// KCG Code service worker (Requirement 8.1).
// - Cache-first untuk asset statis (JS/CSS bundle hasil build.ts).
// - Network-only (pass-through) untuk `/api/*` dan koneksi WebSocket `/ws`,
//   agar kontrol CLI_Agent tidak pernah disajikan dari cache basi.

// Naikkan versi bila strategi cache berubah — cache lama dihapus saat activate.
const CACHE_NAME = "kcg-code-v3";
const PRECACHE = [
  "/",
  "/manifest.json",
  "/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Network-only untuk API dan WebSocket.
  if (url.pathname.startsWith("/api/") || url.pathname === "/ws") return;

  // Network-first untuk halaman: shell HTML lama (chunk usang) tidak boleh
  // terjebak di cache setelah update. Cache hanya dipakai saat offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match("/"))),
    );
    return;
  }

  // Cache-first untuk asset statis (chunk ber-hash).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }),
  );
});
