// GQ Technical Analysis service worker: installable app + push notifications.
// It never caches market data (a stale price shown as current is worse than an
// error): only same-origin static assets are cached. Bump VERSION to drop caches.
const VERSION = "gqta-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(VERSION)); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  if (u.pathname.startsWith("/assets/")) {
    e.respondWith(caches.open(VERSION).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
  } else if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
  }
});
self.addEventListener("push", (e) => {
  let p = {};
  try { p = e.data.json(); } catch { p = { title: "GQ Technical Analysis", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(p.title || "GQ Technical Analysis", { body: p.body || "", icon: "/icon-192.png", badge: "/icon-192.png", data: { url: p.url || "/#/alerts" }, tag: p.tag }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ("focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
