/* My Naai Firebase Messaging Service Worker - Unified with App Shell
 * This is the FCM SW that handles background pushes when app is closed / not in recent
 * It also handles app shell caching to ensure PWA works properly
 * 
 * For PWA to receive notifications when not in recent:
 * - Must be registered at scope "/" (root)
 * - Must have push subscription
 * - Must handle notificationclick with actions
 * - Works on Android Chrome, Edge, Samsung Internet, Firefox, iOS Safari (PWA), Chrome on iOS (PWA)
 */

const CACHE_NAME = 'mynaai-shell-v6';
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

// ── One alert, one notification ─────────────────────────────────────────────
// Firebase's SDK shows its own notification for any message carrying a
// `notification` block whenever no app window is visible — and My Naai shows
// the very same alert itself, with the Accept / Reject / Delay buttons and the
// in-app route. Both being on meant two banners and two system sounds for one
// booking request.
//
// The guard therefore has to be installed HERE, before `firebase.messaging()`
// registers its push listener further down: the SDK's listener runs first (it
// was registered first) and calls `self.registration.showNotification(...)` for
// the raw payload, so wrapping that single method is what lets the SDK keep
// everything else it does (the push subscription, its logging) while the
// notification itself becomes ours. It fails open: anything that is not one of
// My Naai's buzzer alerts — and every path where our own handler does not run —
// is passed straight through to the browser.
const BUZZER_NOTIFICATION_TYPES = ['BOOKING_REQUEST', 'DELAY_BOOKING', 'DELAY_TIME_PROPOSAL'];

function isBuzzerNotificationType(type) {
  return BUZZER_NOTIFICATION_TYPES.includes(String(type || '').toUpperCase());
}

let suppressedSdkNotification = null;

function installSdkNotificationGuard() {
  try {
    const registration = self.registration;
    if (!registration || typeof registration.showNotification !== 'function' || registration.__mynaaiNotificationGuard) return;
    const original = registration.showNotification.bind(registration);
    registration.showNotification = (title, options = {}) => {
      const internal = options?.data?.FCM_MSG || null;
      const type = internal ? String(internal.data?.type || internal.data?.notificationType || '').toUpperCase() : '';
      if (internal && isBuzzerNotificationType(type)) {
        // Our own push listener shows this alert (with its actions) for the same
        // event; keep the SDK's version only as the fallback for the case where
        // that listener cannot finish.
        suppressedSdkNotification = { title, options };
        return Promise.resolve();
      }
      return original(title, options);
    };
    registration.__mynaaiNotificationGuard = true;
  } catch (e) {
    // A browser that refuses the assignment keeps the previous behaviour.
  }
}

installSdkNotificationGuard();

function restoreSuppressedSdkNotification() {
  const pending = suppressedSdkNotification;
  suppressedSdkNotification = null;
  if (!pending) return Promise.resolve();
  return self.registration.showNotification(pending.title, pending.options).catch(() => {});
}

importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;
const firebaseConfig = {
  apiKey: params.get('apiKey') || '',
  authDomain: params.get('authDomain') || '',
  projectId: params.get('projectId') || '',
  storageBucket: params.get('storageBucket') || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId: params.get('appId') || '',
};

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

// ── Ringing the app, exactly once ───────────────────────────────────────────
// The buzzer in a live page is driven by one message, MYNAAI_PLAY_BUZZER, which
// carries an ARRIVAL ENVELOPE: the alert's id and the moment the push event
// fired (`sentAt`). The page drops anything older than a few seconds, so a
// message that reaches a page late — a tab restored from the back/forward
// cache, a window that was still loading — can never ring the alarm on the way
// in. Without the stamp, "the buzzer rings when I open the app or refresh the
// page" is exactly what happens.
function clientList() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).catch(() => []);
}

function hasVisibleClient(list) {
  return (list || []).some(client => {
    try {
      // Background pages of extensions are always "visible"; they are not users.
      return client.visibilityState === 'visible' && !String(client.url).startsWith('chrome-extension://');
    } catch {
      return false;
    }
  });
}

// Argument order matches the page's copy in src/lib/buzzer.js exactly: the two
// must keep producing the same id for the same alert, or "one alert, one sound"
// breaks between a tab and the worker.
function alertIdentity(data = {}, type = '') {
  const value = String(type || data.type || data.notificationType || '').toUpperCase();
  const id = data.bookingRequestId || data.bookingId || data.tag || data.notificationId || data.id || '';
  return `${value || 'NOTIFICATION'}:${id}`;
}

// The one alert message every page understands (see src/lib/buzzer.js).
function buzzerMessage(type, data = {}) {
  return {
    type: 'MYNAAI_PLAY_BUZZER',
    notificationType: type,
    alertId: alertIdentity(data, type),
    sentAt: Date.now(),
    data,
  };
}

function broadcastViaChannel(message) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('mynaai-notifications');
      channel.postMessage(message);
      channel.close();
    }
  } catch (e) {}
}

// Ring the app windows we can reach — but only when NONE of them is in front of
// the user. A visible window is handed the message by Firebase and rings (and
// shows) the alert itself, and it is also the window the person is looking at:
// buzzing from here as well would sound the alarm twice for one booking.
// With no visible window, a hidden tab has no other way to hear about it, which
// is the "app open in another tab" case the buzzer is for.
function ringOpenClients(list, type, data = {}) {
  const windows = list || [];
  if (!windows.length || hasVisibleClient(windows)) return false;
  const message = buzzerMessage(type, data);
  windows.forEach(client => {
    try {
      client.postMessage(message);
    } catch (e) {}
  });
  broadcastViaChannel(message);
  return true;
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

// Clean paths, the same ones the app's router writes and every in-app link
// uses (src/lib/routes.js). The old `/#/...` hashes still resolve — the router
// upgrades them in place — but nothing should be *generating* them any more,
// and a tapped notification is the one navigation nobody can retype.
function salonActionDestination(result) {
  return isPlanExpiredResponse(result?.data)
    ? new URL('/subscription?mode=RENEW&forceRenewal=true', self.location.origin).href
    : new URL('/queue', self.location.origin).href;
}

function notificationRoute(data) {
  const type = String(data.type || data.notificationType || '').toUpperCase();
  const id = encodeURIComponent(data.bookingRequestId || data.bookingId || '');
  if (type === 'DELAY_TIME_PROPOSAL') {
    return `/delay?bookingRequestId=${id}&delayMinutes=${encodeURIComponent(data.delayMinutes || '')}&proposedTime=${encodeURIComponent(data.proposedTime || '')}${data.reason ? `&reason=${encodeURIComponent(data.reason)}` : ''}`;
  }
  if (type === 'BOOKING_CONFIRMED' || type === 'BOOKING_REJECTED' || type === 'DELAY_RESPONSE') return '/bookings';
  if (type === 'BOOKING_REQUEST' || type === 'DELAY_BOOKING') return `/bookingRequest?bookingRequestId=${id}${type === 'DELAY_BOOKING' ? '&openDelayModal=true' : ''}`;
  return '/';
}

// App Shell - Install (also for FCM SW to make PWA work)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// The session mirror (src/lib/session.js) lives in CacheStorage too — it is the
// only store an app installed *after* signing in can still reach on iOS, so a
// worker update must never evict it. Anything else from an older release goes.
// Keep this release's app shell and the session mirror; drop everything else.
const SESSION_CACHE_PREFIX = 'mynaai-session';

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME && !key.startsWith(SESSION_CACHE_PREFIX)).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

function shouldBypass(request) {
  const url = request.url;
  return (
    request.method !== 'GET' ||
    url.includes('/api/') ||
    url.includes('/socket.io') ||
    url.includes('fcm') ||
    url.includes('googleapis') ||
    url.includes('gstatic') ||
    url.includes('__vite') ||
    url.includes('/@') ||
    url.includes('chrome-extension') ||
    // The worker scripts themselves must always come from the network, or a
    // cache-first hit can pin an old worker that can never update.
    url.endsWith('/sw.js') ||
    url.includes('/firebase-messaging-sw.js')
  );
}

// Only the genuine static buckets are cache-first: icons, images, fonts, audio
// and (in production) the hash-named JS/CSS bundles under /assets/. Everything
// else — dev-server modules (/src/*), HTML, anything without a content hash —
// goes straight to the network. This is load-bearing: the old catch-all
// cache-first could serve a stale module set, or (when the server was briefly
// down) an /index.html body in place of a script, which left users on a dead
// black page after a deploy.
const CACHE_FIRST_PATH = /^\/(assets|icons)\//;

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

  const { origin, pathname } = new URL(event.request.url);
  if (origin !== self.location.origin || !CACHE_FIRST_PATH.test(pathname)) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => {
          if (event.request.destination === 'image') {
            return caches.match('/assets/brand/naai-logo-dark.svg');
          }
          // Never hand an HTML fallback to a script/style import — that exact
          // mismatch is the black-screen failure this handler exists to avoid.
          return new Response('My Naai is offline for this file.', { status: 504 });
        });
    })
  );
});

// Notification click with actions - works even when app not in recent / closed
self.addEventListener('notificationclick', event => {
  const action = event.action || '';

  if (action === ACTION_ACCEPT || action === ACTION_REJECT || action === ACTION_DELAY) {
    event.stopImmediatePropagation();

    const notificationData = event.notification?.data || {};
    const internal = event.notification?.data?.FCM_MSG || null;
    const data = notificationData.target ? notificationData : (internal?.data || notificationData);
    const bookingRequestId = data.bookingRequestId || data.bookingId || '';

    if (action === ACTION_DELAY) {
      const destination = new URL(`/bookingRequest?bookingRequestId=${encodeURIComponent(bookingRequestId)}&openDelayModal=true`, self.location.origin).href;
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

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'MYNAAI_CLOSE_NOTIFICATION' && data.tag) {
    event.waitUntil(self.registration.getNotifications({ tag: String(data.tag) }).then(notifications => {
      notifications.forEach(notification => notification.close());
    }));
  }
  if (data.type === 'MYNAAI_PLAY_BUZZER') {
    // A page asked the worker to ring the other windows (the sender already rang
    // itself). Same envelope rules as a delivered push, so a stale relay can
    // never sound the alarm on the way into the app.
    event.waitUntil(clientList().then(list => {
      ringOpenClients(list, data.notificationType || 'BOOKING_REQUEST', data.data || {});
    }));
  }
  if (data.type === 'MYNAAI_NAVIGATE' && data.target) {
    try {
      const destination = new URL(data.target, self.location.origin).href;
      event.waitUntil(openOrFocus(destination));
    } catch {}
  }
});

self.addEventListener('notificationclose', event => {});

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(payload => {
    const data = payload.data || {};
    const type = String(data.type || data.notificationType || '').toUpperCase();
    // Buzzer alerts are owned by the `push` listener below — the SDK's callback
    // only runs when no window is visible, whereas the push event fires in
    // every case, so that is the one place that can both ring the open (hidden)
    // tabs and show the single alert without ever doing either twice.
    if (isBuzzerNotificationType(type)) return undefined;
    const isBookingRequest = type === 'BOOKING_REQUEST';
    const isDelayBooking = type === 'DELAY_BOOKING';
    const hasNotificationBlock = Boolean(payload.notification?.title || payload.notification?.body);
    if (hasNotificationBlock && !isBookingRequest && !isDelayBooking) return;

    const title = payload.notification?.title || data.title || 'My Naai update';
    const body = payload.notification?.body || data.body || 'You have a new update from My Naai.';
    const target = notificationRoute(data);

    // This notification will show even when app is not in recent / closed
    // because SW is woken by push event
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

self.addEventListener('push', event => {
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
    // Everything that is not a buzzer alert stays with the Firebase SDK: it
    // shows the notification the payload asks for (once), and its
    // onBackgroundMessage callback is still there for messages without one.
    if (!isBuzzerNotificationType(type)) return;

    const isBookingRequest = type === 'BOOKING_REQUEST';
    const isDelayBooking = type === 'DELAY_BOOKING';
    const title = payload.notification?.title || data.title || 'My Naai update';
    const body = payload.notification?.body || data.body || 'You have a new update from My Naai.';
    const target = notificationRoute(data);

    // `sentAt` is stamped here — the instant the push event fired — and nowhere
    // else: it is the only honest answer to "when did this notification arrive".
    event.waitUntil((async () => {
      const windows = await clientList();
      if (hasVisibleClient(windows)) {
        // A My Naai window is open in front of the user: Firebase hands it this
        // message (it posts to every window, hidden ones included) and that page
        // rings and shows the alert itself. Showing a second banner from here,
        // or ringing a second time, is the duplicate this file exists to stop.
        suppressedSdkNotification = null;
        return;
      }
      let shown = false;
      try {
        await self.registration.showNotification(title, {
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
          ] : isDelayBooking ? [
            { action: ACTION_DELAY, title: 'View & Delay' },
          ] : undefined,
        });
        shown = true;
      } finally {
        // Our alert (or nothing, if it failed) replaces the SDK's suppressed
        // copy — never both, and never neither.
        suppressedSdkNotification = null;
        if (!shown) await restoreSuppressedSdkNotification();
      }
      // Ring the tabs that are open but not in front. The envelope carries the
      // arrival stamp, so a tab that receives this late (restored, still
      // loading, woken by the app switch) stays silent.
      ringOpenClients(windows, type, data);
    })());
  } catch (e) {
    restoreSuppressedSdkNotification();
  }
});
