self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Panel Sell Bazaar', body: event.data ? event.data.text() : 'নতুন notification আছে।' };
  }

  const title = data.title || 'Panel Sell Bazaar';
  const options = {
    body: data.body || 'নতুন notification আছে।',
    icon: data.icon || './psb-logo-192.png',
    badge: data.badge || './psb-logo-192.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'psb-admin-notification-' + Date.now(),
    renotify: true,
    data: { url: data?.data?.url || './' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification?.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
