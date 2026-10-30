const CACHE_NAME = 'panel-sell-bazaar-shell-v2';
const APP_SHELL = ['./', './index.html', './psb-manifest.webmanifest', './psb-logo-192.png', './psb-logo-512.png'];
self.addEventListener('install', event => {
event.waitUntil((async () => {
const cache = await caches.open(CACHE_NAME);
await Promise.all(APP_SHELL.map(async path => {
try { const response = await fetch(path, { cache: 'reload' }); if (response.ok) await cache.put(path, response); } catch (error) {
}));
await self.skipWaiting();
})());
});
self.addEventListener('activate', event => {
event.waitUntil((async () => {
const keys = await caches.keys();
await Promise.all(keys.filter(key => key.startsWith('panel-sell-bazaar-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
await self.clients.claim();
})());
});
self.addEventListener('fetch', event => {
const request = event.request;
if (request.method !== 'GET') return;
const url = new URL(request.url);
if (url.origin !== self.location.origin) return;
event.respondWith((async () => {
try {
const response = await fetch(request);
if (response && response.ok && (request.destination === 'document' || /.(css|js|png|jpg|jpeg|webp|svg|webmanifest)$/i.test(url.pathname))) {
const cache = await caches.open(CACHE_NAME);
cache.put(request, response.clone()).catch(() => {});
}
return response;
} catch () {
const cached = await caches.match(request);
if (cached) return cached;
if (request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
return Response.error();
}
})());
});
self.addEventListener('notificationclick', event => {
event.notification.close();
event.waitUntil((async () => {
const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
for (const client of list) {
if ('focus' in client) return client.focus();
}
if (self.clients.openWindow) return self.clients.openWindow('./');
})());
});
