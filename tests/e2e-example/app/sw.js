self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
    if (new URL(event.request.url).pathname !== '/api/items') return;
    const body = JSON.stringify({ items: [{ id: 'sw', display_name: 'Answered by the service worker' }] });
    event.respondWith(new Response(body, { headers: { 'content-type': 'application/json' } }));
});
