// Pi Dashboard Service Worker — v2 (push notifications + PWA installability)
// See change: add-server-push-notifications

// Pass all fetch requests through to the network — no caching.
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => new Response("Offline", { status: 503 }))
  );
});

// ── Web Push handler ────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let title = "Pi Dashboard";
  let body = "New activity";
  let data = {};

  try {
    if (event.data) {
      const payload = event.data.json();
      title = payload.title || title;
      body = payload.body || body;
      data = {
        url: payload.data?.url || "/",
        sessionId: payload.data?.sessionId,
      };
    }
  } catch {
    // Malformed JSON — fall back to text if available
    try {
      if (event.data) {
        const text = event.data.text();
        if (text) body = text.slice(0, 500);
      }
    } catch {
      // Ignore — keep defaults
    }
  }

  const promise = self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    data,
    requireInteraction: true,
  });

  event.waitUntil(promise);
});

// ── Notification click handler ──────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Exact pathname matching — not substring. Prevents /session/abc
      // from matching /session/abcd.
      const urlPath = new URL(url, self.location.origin).pathname;
      for (const client of clientList) {
        try {
          if (new URL(client.url).pathname === urlPath && "focus" in client) {
            return client.focus();
          }
        } catch {
          // Ignore URL parse errors for rogue client URLs
        }
      }
      // No matching window — open a new one
      return clients.openWindow(url);
    })
  );
});
