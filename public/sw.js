/* My Naai Unified Service Worker
 * Handles both PWA app shell caching AND Firebase Cloud Messaging
 * This ensures:
 * - PWA is installable immediately (fetch handler)
 * - Notifications with actions work even when app is not in recent / closed
 * - Buzzer vibration works in background
 * - Works on Android, iOS (PWA), Chrome, Edge, Firefox, Samsung Internet, Safari
 */

const CACHE_NAME = 'mynaai-shell-v5';
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

// Parse Firebase config from query params (when registered by push.js)
const params = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: params.get('apiKey') || '',
  authDomain: params.get('authDomain') || '',
  projectId: params.get('projectId') || '',
  storageBucket: params.get('storageBucket') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || '',
};
const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId);

// Firebase Messaging setup (only if config present, but import scripts anyway for FCM SW)
let firebaseMessaging = null;
try {
  if (hasFirebaseConfig) {
    importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');
    if (!self.firebase.apps.length) {
      self.firebase.initializeApp(firebaseConfig);
    }
    firebaseMessaging = self.firebase.messaging();
  } else {
    // Try to load Firebase anyway for cases where SW was registered without query but still needs to handle push
    // This allows the SW to handle pushes even if config was not in URL (e.g., after update)
    try {
      importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
      importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');
      // If firebase already initialized in this SW context, reuse it
      if (self.firebase && self.firebase.apps && self.firebase.apps.length) {
        firebaseMessaging = self.firebase.messaging();
      }
    } catch (e) {
      // Firebase not available, continue as app shell only
    }
  }
} catch (e) {
  // Firebase import failed (offline, blocked), continue as app shell only
}

// Constants for notification actions
const ACTION_ACCEPT = 'ACCEPT_BOOKING';
const ACTION_REJECT = 'REJECT_BOOKING';
const ACTION_DELAY = 'DELAY_BOOKING';
const AUTH_DB_NAME = 'mynaai-notification-actions';
const AUTH_DB_STORE = 'auth';
const AUTH_DB_ID = 'auth';
const DEFAULT_API_BASE = 'https://backend.mynaai.in';

function openAuthDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable.'));
      return;
    }
    const request = indexedDB.open(AUTH_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTH_DB_STORE)) db.createObjectStore(AUTH_DB_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readNotificationAuth() {
  return openAuthDb()
    .then(db => new Promise(resolve => {
      const tx = db.transaction(AUTH_DB_STORE, 'readonly');
      const req = tx.objectStore(AUTH_DB_STORE).get(AUTH_DB_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    }))
    .catch(() => null);
}

function broadcastBuzzerToClients(type, data) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    clientList.forEach(client => {
      try {
        client.postMessage({ type: 'MYNAAI_PLAY_BUZZER', notificationType: type, data });
      } catch (e) {}
    });
  }).catch(() => {});
}

function broadcastViaChannel(type, data) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('mynaai-notifications');
      channel.postMessage({ type: 'MYNAAI_PLAY_BUZZER', notificationType: type, data });
      channel.close();
    }
  } catch (e) {}
}

function openOrFocus(destination) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    const windows = clientList.filter(client => {
      try {
        return 'navigate' in client && client.url.startsWith(self.location.origin);
      } catch {
        return false;
      }
    });
    const current = windows.find(client => client.visibilityState === 'visible')
      || windows.find(client => client.focused)
      || windows[0];
    if (current) {
      return current.navigate(destination).then(client => {
        try { return client.focus(); } catch { return client; }
      }).catch(() => {
        try {
          current.postMessage({ type: 'MYNAAI_NAVIGATE', target: destination });
          return current.focus();
        } catch {
          return current.focus();
        }
      });
    }
    if (self.clients.openWindow) return self.clients.openWindow(destination);
    return undefined;
  });
}

async function ownerAction(bookingRequestId, action, delayMinutes) {
  const auth = await readNotificationAuth();
  const apiBase = (auth?.apiBaseUrl || DEFAULT_API_BASE).replace(/\/$/, '');
  const url = `${apiBase}/api/bookingRequest/owner-action/${encodeURIComponent(bookingRequestId)}/`;
  const payload = action === 'DELAY' ? { action, delayMinutes: String(delayMinutes) } : { action };
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => null);
    const ok = response.ok && (!data || data.status === 'SUCCESS');
    return { ok, data };
  } catch (error) {
    return { ok: false, error };
  }
}

function isPlanExpiredResponse(data) {
  const values = [data?.status, data?.error, data?.code, data?.errorCode, data?.data?.status, data?.data?.error];
  return values.some(value => String(value || '').toUpperCase() === 'PLAN_EXPIRED');
}

function salonActionDestination(result) {
  return isPlanExpiredResponse(result?.data)
    ? new URL('/#/subscription?mode=RENEW&forceRenewal=true', self.location.origin).href
    : new URL('/#/queue', self.location.origin).href;
}

function notificationRoute(data) {
  const type = String(data.type || data.notificationType || '').toUpperCase();
  const id = encodeURIComponent(data.bookingRequestId || data.bookingId || '');
  if (type === 'DELAY_TIME_PROPOSAL') {
    return `/#/delay?bookingRequestId=${id}&delayMinutes=${encodeURIComponent(data.delayMinutes || '')}&proposedTime=${encodeURIComponent(data.proposedTime || '')}${data.reason ? `&reason=${encodeURIComponent(data.reason)}` : ''}`;
  }
  if (type === 'BOOKING_CONFIRMED' || type === 'BOOKING_REJECTED' || type === 'DELAY_RESPONSE') return '/#/bookings';
  if (type === 'BOOKING_REQUEST' || type === 'DELAY_BOOKING') return `/#/bookingRequest?bookingRequestId=${id}${type === 'DELAY_BOOKING' ? '&openDelayModal=true' : ''}`;
  return '/#/';
}

// App Shell - Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// App Shell - Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// App Shell - Fetch
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
    url.includes('__vite') ||
    url.includes('/@') ||
    url.includes('chrome-extension')
  );
}

self.addEventListener('fetch', event => {
  if (shouldBypass(event.request)) return;

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
          if (event.request.destination === 'image') {
            return caches.match('/assets/brand/naai-logo-dark.svg');
          }
          return caches.match('/index.html');
        });
    })
  );
});

// Notification click with actions - works even when app not in recent
self.addEventListener('notificationclick', event => {
  const action = event.action || '';

  if (action === ACTION_ACCEPT || action === ACTION_REJECT || action === ACTION_DELAY) {
    event.stopImmediatePropagation();

    const notificationData = event.notification?.data || {};
    const internal = event.notification?.data?.FCM_MSG || null;
    const data = notificationData.target ? notificationData : (internal?.data || notificationData);
    const bookingRequestId = data.bookingRequestId || data.bookingId || '';

    if (action === ACTION_DELAY) {
      const destination = new URL(`/#/bookingRequest?bookingRequestId=${encodeURIComponent(bookingRequestId)}&openDelayModal=true`, self.location.origin).href;
      event.waitUntil(openOrFocus(destination));
      return;
    }

    const value = action === ACTION_ACCEPT ? 'ACCEPT' : 'REJECT';
    event.notification.close();
    event.waitUntil(ownerAction(bookingRequestId, value).then(result => openOrFocus(salonActionDestination(result))));
    return;
  }

  const internal = event.notification?.data?.FCM_MSG || null;
  const configuredLink = internal?.fcmOptions?.link || internal?.notification?.click_action || '';
  if (internal && configuredLink) return;

  event.stopImmediatePropagation();
  event.notification.close();

  const notificationData = event.notification?.data || {};
  const data = notificationData.target ? notificationData : (internal?.data || notificationData);
  const target = data.target || notificationRoute(data);
  const destination = new URL(target, self.location.origin).href;
  event.waitUntil(openOrFocus(destination));
});

// Message handling - buzzer, close notification, navigation
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'MYNAAI_CLOSE_NOTIFICATION' && data.tag) {
    event.waitUntil(self.registration.getNotifications({ tag: String(data.tag) }).then(notifications => {
      notifications.forEach(notification => notification.close());
    }));
  }
  if (data.type === 'MYNAAI_PLAY_BUZZER') {
    event.waitUntil(broadcastBuzzerToClients(data.notificationType || 'BOOKING_REQUEST', data.data || {}));
  }
  if (data.type === 'MYNAAI_NAVIGATE' && data.target) {
    try {
      const destination = new URL(data.target, self.location.origin).href;
      event.waitUntil(openOrFocus(destination));
    } catch {}
  }
});

// Firebase Background Message - handles push when app is in background or closed
if (firebaseMessaging) {
  firebaseMessaging.onBackgroundMessage(payload => {
    const data = payload.data || {};
    const type = String(data.type || data.notificationType || '').toUpperCase();
    const isBookingRequest = type === 'BOOKING_REQUEST';
    const isDelayBooking = type === 'DELAY_BOOKING';
    const hasNotificationBlock = Boolean(payload.notification?.title || payload.notification?.body);
    
    // Only skip if has notification block and not booking request (to avoid duplicates)
    // For booking requests, we MUST show our own with actions, replacing SDK's
    if (hasNotificationBlock && !isBookingRequest && !isDelayBooking) return;

    const title = payload.notification?.title || data.title || 'My Naai update';
    const body = payload.notification?.body || data.body || 'You have a new update from My Naai.';
    const target = notificationRoute(data);
    const buzzer = type === 'BOOKING_REQUEST' || type === 'DELAY_BOOKING' || type === 'DELAY_TIME_PROPOSAL';

    // Broadcast buzzer to any open clients (if app is in background but still has tabs)
    if (buzzer) {
      broadcastBuzzerToClients(type, data);
      broadcastViaChannel(type, data);
    }

    // Show notification with actions - this works even when app is not in recent
    // The SW is woken by push event, shows notification, and stays alive until showNotification completes
    return self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.bookingRequestId || data.bookingId || data.type || 'mynaai-notification',
      data: { ...data, target },
      requireInteraction: isBookingRequest || type === 'DELAY_TIME_PROPOSAL' || isDelayBooking,
      vibrate: buzzer ? [260, 120, 260, 120, 520] : undefined,
      silent: false,
      actions: isBookingRequest
        ? [
            { action: ACTION_ACCEPT, title: 'Accept' },
            { action: ACTION_REJECT, title: 'Reject' },
            { action: ACTION_DELAY, title: 'Delay' },
          ]
        : isDelayBooking
          ? [
            { action: ACTION_DELAY, title: 'View & Delay' },
          ]
          : undefined,
    });
  });
}

// Fallback push handler for non-FCM pushes or when Firebase fails
// Ensures notifications still show when app is closed, even if Firebase SDK didn't handle it
self.addEventListener('push', event => {
  // If Firebase messaging is handling this, let it do its job
  // But we still want to ensure booking requests get actions even when closed
  
  try {
    if (!event.data) return;

    let payload = {};
    try {
      payload = event.data.json();
    } catch {
      const text = event.data.text();
      if (!text) return;
      payload = { notification: { title: 'My Naai update', body: text }, data: {} };
    }

    const data = payload.data || {};
    const type = String(data.type || data.notificationType || '').toUpperCase();
    const isBookingRequest = type === 'BOOKING_REQUEST' || type === 'DELAY_BOOKING';
    const hasNotificationBlock = Boolean(payload.notification?.title || payload.notification?.body);

    // If Firebase will handle non-booking notifications, skip to avoid duplicates
    // But for booking requests, we want to ensure actions are shown even when app closed
    if (hasNotificationBlock && !isBookingRequest && firebaseMessaging) {
      // Check if this is FCM message - if yes, let Firebase handle it
      if (payload.from && String(payload.from).includes('fcm')) return;
    }

    // If no data and no notification, skip
    if (!payload.notification && !Object.keys(data).length) return;

    const title = payload.notification?.title || data.title || 'My Naai update';
    const body = payload.notification?.body || data.body || 'You have a new update from My Naai.';
    const target = notificationRoute(data);
    const buzzer = type === 'BOOKING_REQUEST' || type === 'DELAY_BOOKING' || type === 'DELAY_TIME_PROPOSAL';

    if (buzzer) {
      event.waitUntil(
        Promise.all([
          broadcastBuzzerToClients(type, data),
          broadcastViaChannel(type, data),
          self.registration.showNotification(title, {
            body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: data.bookingRequestId || data.bookingId || data.type || 'mynaai-notification',
            data: { ...data, target },
            requireInteraction: true,
            vibrate: [260, 120, 260, 120, 520],
            silent: false,
            actions: isBookingRequest ? [
              { action: ACTION_ACCEPT, title: 'Accept' },
              { action: ACTION_REJECT, title: 'Reject' },
              { action: ACTION_DELAY, title: 'Delay' },
            ] : undefined,
          })
        ])
      );
    }
  } catch (e) {
    // Don't break SW on push parsing errors
  }
});

// Notification close event - track dismissal
self.addEventListener('notificationclose', event => {
  // Could track notification dismissal analytics here if needed
});
