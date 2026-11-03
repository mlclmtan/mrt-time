/*
 * MRT Time service worker.
 * - Navigations are network-first; the last good copy of each page is kept
 *   so the app opens offline (boards then render their localStorage snapshot).
 * - Web Push: "leave now" reminders and disruption alerts.
 */
const PAGES = "mrt-pages-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== PAGES) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(PAGES);
          await cache.put(url.pathname, response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(PAGES);
        return (
          (await cache.match(url.pathname)) ||
          (await cache.match("/")) ||
          new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } })
        );
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* A visible fallback is still required. */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "MRT Time", {
      body: payload.body || "Open MRT Time for the latest trains.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || "mrt",
      renotify: true,
      data: { url: payload.url || "/" },
    }),
  );
});

function safeUrl(value) {
  try {
    const candidate = new URL(value || "/", self.location.origin);
    if (candidate.origin === self.location.origin) return candidate;
  } catch {
    /* Open the app home. */
  }
  return new URL("/", self.location.origin);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = safeUrl(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          const navigated = await client.navigate(destination.href);
          await (navigated || client).focus();
          return;
        } catch {
          break;
        }
      }
      await self.clients.openWindow(destination.href);
    })(),
  );
});
