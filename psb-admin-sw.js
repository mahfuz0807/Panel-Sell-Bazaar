// Panel Sell Bazaar - Admin Background Push Service Worker
self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {
      title: "Panel Sell Bazaar",
      body: event.data ? event.data.text() : "আপনার নতুন notification আছে।"
    };
  }

  const title = data.title || "Panel Sell Bazaar";
  const options = {
    body: data.body || "আপনার নতুন notification আছে।",
    icon: "/Panel-Sell-Bazaar/psb-logo-192.png",
    badge: "/Panel-Sell-Bazaar/psb-logo-192.png",
    vibrate: [200, 100, 200],
    tag: "psb-admin-notification",
    renotify: true,
    data: {
      url: data?.data?.url || "/Panel-Sell-Bazaar/admin.html"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  const targetUrl =
    event.notification?.data?.url ||
    "/Panel-Sell-Bazaar/admin.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
