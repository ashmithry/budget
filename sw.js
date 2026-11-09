// Offline support: network first (so updates show up right away), cached copy when offline.
const CACHE = "budget-v5";
const SHELL = [
  "/", "/index.html", "/manifest.webmanifest", "/css/app.css",
  "/js/app.js", "/js/ai.js", "/js/icons.js", "/js/store.js", "/js/engine.js", "/js/dates.js", "/js/ui.js", "/js/sheets.js", "/js/sync.js", "/js/badge.js",
  "/js/views/home.js", "/js/views/activity.js", "/js/views/plan.js", "/js/views/insights.js", "/js/views/settings.js", "/js/views/onboard.js",
  "/icons/icon.svg", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/icons/rosette.svg", "/fonts/bricolage-latin.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(e.request, { signal: ctrl.signal, cache: "no-cache" });
        clearTimeout(timer);
        if (res.ok) cache.put(url.pathname === "/" ? "/" : e.request, res.clone());
        return res;
      } catch {
        return (await cache.match(url.pathname === "/" || e.request.mode === "navigate" ? "/" : e.request)) || (await cache.match(e.request, { ignoreSearch: true })) || Response.error();
      }
    })()
  );
});
