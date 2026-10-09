// TES Inspection Register – service worker (makes the app installable and quick to open)
const VERSION = "tes-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
const CDN = "https://cdnjs.cloudflare.com/";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Live data is never cached
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  // PDF / Excel libraries: cache first (versioned URLs never change)
  if (req.url.startsWith(CDN)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App page and icons: network first so updates show immediately, cache as fallback
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req.mode === "navigate" ? "/" : req, copy)); }
    return res;
  }).catch(() => caches.match(req.mode === "navigate" ? "/" : req)));
});
