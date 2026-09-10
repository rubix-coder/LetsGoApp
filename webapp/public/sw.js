/* LetsGo service worker: keeps timer notifications working while the app
   is installed / backgrounded, and focuses the app when one is clicked.
   No fetch caching — the vault is local and the app is small. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "notify") {
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "icon.svg",
        badge: "icon.svg",
        tag: data.tag || "letsgo-timer",
        renotify: true,
      }),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients[0];
      if (client) return client.focus();
      return self.clients.openWindow(".");
    }),
  );
});
