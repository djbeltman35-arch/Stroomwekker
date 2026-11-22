// Stroomwekker service worker: snelle start, offline laatste prijzen, pushmeldingen.
const V = 'sw-v10';
const SHELL = ['/', '/js/engine.js', '/js/app.js', '/icons/icon.svg', '/manifest.webmanifest',
  '/fonts/ibm-plex-sans-latin-400-normal.woff2', '/fonts/ibm-plex-sans-latin-600-normal.woff2',
  '/fonts/ibm-plex-sans-latin-500-normal.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname === '/api/prices' || e.request.mode === 'navigate') {
    // Netwerk eerst, anders de laatst bekende versie
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
    return;
  }
  if (u.pathname.startsWith('/api/')) return;
  // Snel uit de cache, en op de achtergrond verversen zodat updates vanzelf binnenkomen
  e.respondWith(caches.open(V).then(c => c.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })));
});
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data.json(); } catch { m = { title: 'Stroomwekker', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Stroomwekker', {
    body: m.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: m.id || 'sw', renotify: true, data: { url: '/' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return clients.openWindow('/');
  }));
});
