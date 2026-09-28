// Service worker for browser push alerts only (no offline caching). Runs
// in the background even with every TradeMind tab closed, as long as the
// browser itself is running. Registered from src/utils/pushNotifications.js;
// payloads come from the backend's services/notifyDispatcher.js.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "TradeMind AI", body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "TradeMind AI", {
      body: data.body || "New trading signal",
      icon: "/favicon.png",
      badge: "/favicon.png",
      tag: data.tag,
      renotify: !!data.tag,
      requireInteraction: false,
      data: { url: data.url || "/notifications" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Reuse an open TradeMind tab if there is one.
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
