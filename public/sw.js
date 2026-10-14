// KCG Code service worker (Requirement 8.1).
// - Cache-first untuk asset statis (JS/CSS bundle hasil build.ts).
// - Network-only (pass-through) untuk `/api/*` dan koneksi WebSocket `/ws`,
//   agar kontrol CLI_Agent tidak pernah disajikan dari cache basi.
// - Web Push: notifikasi agent (izin/pertanyaan/selesai) saat app tidak
//   sedang terbuka di perangkat ini. Payload = `AgentNotification` (JSON).
//
// Mode dev (`/sw.js?dev=1`, didaftarkan saat notifikasi dinyalakan di
// `bun dev`): tanpa cache sama sekali agar HMR tidak terganggu — hanya push.
const DEV = new URL(self.location.href).searchParams.has("dev");

// Naikkan versi bila strategi cache berubah — cache lama dihapus saat activate.
const CACHE_NAME = "kcg-code-v4";
const PRECACHE = [
  "/",
  "/manifest.json",
  "/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/sounds/notification.ogg",
];

self.addEventListener("install", (event) => {
  if (DEV) {
    self.skipWaiting();
    return;
  }
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
  if (DEV) return;
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

// ---- Web Push ----

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Payload rusak: tetap tampilkan sesuatu — iOS mencabut langganan push
    // yang tidak pernah menampilkan notifikasi.
  }
  const title = typeof data.title === "string" ? data.title : "KCG Code";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Satu notifikasi per Session: kabar baru menggantikan yang lama.
      tag: typeof data.sessionId === "string" ? `session-${data.sessionId}` : "kcg-code",
      renotify: true,
      requireInteraction: data.kind === "permission" || data.kind === "question",
      data: { url: typeof data.url === "string" ? data.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data?.url;
  // Hanya path di origin ini (tak pernah membuka situs lain dari payload).
  const target = new URL(typeof raw === "string" ? raw : "/", self.location.origin);
  const url = target.origin === self.location.origin ? target.pathname + target.search : "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (client) {
        // Navigasi SPA di tab yang sudah terbuka (tanpa reload).
        client.postMessage({ type: "navigate", url });
        return client.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});

// Browser memutar kunci langganan (jarang): daftarkan ulang ke server.
// Bila perangkat terkunci (401), app mengirim ulang saat dibuka berikutnya.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const options = event.oldSubscription?.options;
      const sub =
        event.newSubscription ||
        (options ? await self.registration.pushManager.subscribe(options) : null);
      if (!sub) return;
      const json = sub.toJSON();
      await fetch("/api/push/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      }).catch(() => {});
    })(),
  );
});
