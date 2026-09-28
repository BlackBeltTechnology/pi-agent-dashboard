// Minimal service worker for PWA installability.
// Passes all requests through to the network — no caching.
//
// /api/* requests are forwarded untouched: a network failure propagates as a
// real fetch rejection so callers can distinguish it from a server response.
// Only navigation/asset requests get the synthetic "Offline" fallback.
// See change: fix-openspec-profile-load-race.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    // Pass through; do NOT mask failures as a fabricated 503.
    return; // let the browser perform the default network fetch
  }
  event.respondWith(
    fetch(event.request).catch(() => new Response("Offline", { status: 503 }))
  );
});

// Push notifications: show the server's small session payload, and on click
// focus + navigate an open dashboard window (or open one) at `data.url`.
// Payload: {type, trigger, sessionId, title, body, url}.
// See change: add-server-push-notifications.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "pi-dashboard", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "pi-dashboard";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      data: { url: payload.url || "/", sessionId: payload.sessionId },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.sessionId ? `session-${payload.sessionId}` : undefined,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const win = windows[0];
      if (win) {
        return win.focus().then(() => (win.navigate ? win.navigate(url) : undefined));
      }
      return self.clients.openWindow(url);
    }),
  );
});
