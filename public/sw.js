const CACHE_NAME = 'mynaai-shell-v4';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/assets/brand/naai-mark.svg',
  '/assets/brand/naai-logo-dark.svg',
  '/assets/my_naai_circle.png',
  '/assets/my_naai.png',
  '/assets/new_background.jpeg',
  '/assets/salon_page_bg.png',
  '/assets/audio/buzzer.wav',
  '/assets/audio/buzzer_old.wav'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// Don't intercept FCM, API, or socket.io requests - let them go to network
function shouldBypass(request) {
  const url = request.url;
  return (
    request.method !== 'GET' ||
    url.includes('/api/') ||
    url.includes('/socket.io') ||
    url.includes('fcm') ||
    url.includes('googleapis') ||
    url.includes('gstatic') ||
    url.includes('firebase') ||
    url.includes('firebase-messaging-sw') ||
    url.includes('__vite') ||
    url.includes('/@')
  );
}

self.addEventListener('fetch', event => {
  if (shouldBypass(event.request)) return;

  // For navigation requests, try network first, fallback to cache, then index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok && new URL(event.request.url).origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // For assets, try cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (response.ok && new URL(event.request.url).origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => {
          // For images, return placeholder if available
          if (event.request.destination === 'image') {
            return caches.match('/assets/brand/naai-logo-dark.svg');
          }
          return caches.match('/index.html');
        });
    })
  );
});

// Handle messages from main thread - especially for buzzer and notification close
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'MYNAAI_PLAY_BUZZER') {
    // Broadcast to all clients to play buzzer - main SW can't play audio itself
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      clients.forEach(client => {
        try {
          client.postMessage({ type: 'MYNAAI_PLAY_BUZZER', notificationType: data.notificationType || 'BOOKING_REQUEST', data: data.data || {} });
        } catch {}
      });
    });
  }
  if (data.type === 'MYNAAI_CLOSE_NOTIFICATION' && data.tag) {
    self.registration.getNotifications({ tag: String(data.tag) }).then(notifications => {
      notifications.forEach(n => n.close());
    }).catch(() => {});
  }
});
