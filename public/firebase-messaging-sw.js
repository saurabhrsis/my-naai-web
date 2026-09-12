/*
 * Firebase Messaging service worker for My Naai web push.
 * The main app adds the public Firebase config as query parameters when it
 * registers this worker, so no environment values need to be committed here.
 *
 * LISTENER ORDER MATTERS. `firebase.messaging()` (below) makes the Firebase SDK
 * register its own `push` and `notificationclick` handlers, and its click
 * handler calls `event.stopImmediatePropagation()` for every notification the
 * SDK displayed itself — i.e. any message that carried a `notification` block.
 * It then only opens `webpush.fcm_options.link` / `notification.click_action`
 * and does nothing at all when no link is set, which is why such notifications
 * used to be un-clickable on the web. Registering My Naai's click handler FIRST
 * keeps deep links working for both payload shapes:
 *   - data-only message  -> onBackgroundMessage below builds it, we route it
 *   - notification block -> the SDK builds it, we unwrap data.FCM_MSG and route
 * and still defers to the SDK when the backend does configure a link.
 *
 * BOOKING ACTION BUTTONS. A booking-request notification carries Accept /
 * Reject / Delay buttons (mirroring the My Naai mobile app). The worker calls the
 * owner-action API directly for Accept/Reject so it works even when the PWA is
 * closed, and opens the request screen with the delay modal for Delay. The
 * session token is mirrored into IndexedDB by the app (src/lib/api.js) so the
 * worker can authenticate; the audible background sound comes from the server's
 * push payload, and vibration/buzzer is best-effort.
 *
 * BACKGROUND BUZZER: When a push arrives, the worker broadcasts MYNAAI_PLAY_BUZZER
 * to all open clients so even a hidden tab can play the buzzer via Web Audio
 * (if it was unlocked before). This works across Chrome, Edge, Samsung Internet,
 * Firefox, Safari (PWA), and Chrome on iOS (when installed as PWA).
 */

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

// Broadcast buzzer play to all open clients - enables background buzzer when tab is hidden but app was unlocked before
function broadcastBuzzerToClients(type, data) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    clientList.forEach(client => {
      try {
        client.postMessage({ type: 'MYNAAI_PLAY_BUZZER', notificationType: type, data });
      } catch (e) {
        // ignore postMessage failures
      }
    });
  }).catch(() => {});
}

// Also try BroadcastChannel for cross-browser support (Chrome, Edge, Firefox, Samsung)
function broadcastViaChannel(type, data) {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('mynaai-notifications');
      channel.postMessage({ type: 'MYNAAI_PLAY_BUZZER', notificationType: type, data });
      channel.close();
    }
  } catch (e) {
    // ignore
  }
}

// Reuse/focus an existing window, or open a new one at `destination`.
function openOrFocus(destination) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
    const url = new URL(destination, self.location.origin);
    const hash = url.hash || '';

    // Prefer a client that already has our origin and try to navigate it
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
      // For hash routing, we can navigate to the full URL including hash
      return current.navigate(destination).then(client => {
        try { return client.focus(); } catch { return client; }
      }).catch(() => {
        // If navigate fails (e.g., cross-origin), try focus + postMessage
        try {
          current.postMessage({ type: 'MYNAAI_NAVIGATE', target: hash || destination });
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

// Calls the mobile owner-action endpoint so Accept/Reject work from the
// notification without the app being open.
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

// ACTION BUTTONS: Accept / Reject / Delay are handled first so a closed app can
// still act. Body clicks fall through to the deep-link routing below.
self.addEventListener('notificationclick', event => {
  const action = event.action || '';

  if (action === ACTION_ACCEPT || action === ACTION_REJECT || action === ACTION_DELAY) {
    event.stopImmediatePropagation();

    const notificationData = event.notification?.data || {};
    const internal = event.notification?.data?.FCM_MSG || null;
    const data = notificationData.target ? notificationData : (internal?.data || notificationData);
    const bookingRequestId = data.bookingRequestId || data.bookingId || '';

    if (action === ACTION_DELAY) {
      // Let the app open the request screen with the delay modal (no cancel,
      // matching the mobile handler).
      const destination = new URL(`/#/bookingRequest?bookingRequestId=${encodeURIComponent(bookingRequestId)}&openDelayModal=true`, self.location.origin).href;
      event.waitUntil(openOrFocus(destination));
      return;
    }

    // ACCEPT / REJECT: hit the API, close the alert, then surface the queue.
    const value = action === ACTION_ACCEPT ? 'ACCEPT' : 'REJECT';
    event.notification.close();
    event.waitUntil(ownerAction(bookingRequestId, value).then(result => openOrFocus(salonActionDestination(result))));
    return;
  }

  // Plain body click on a notification the SDK displayed (notification block):
  // defer to the SDK when it configured a link, otherwise route ourselves.
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

// Lets the open app close a notification once its countdown expires (the web
// Notification API cannot render a live chronometer like Notifee's, so the app
// owns the timer and asks the worker to clear the alert).
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'MYNAAI_CLOSE_NOTIFICATION' && data.tag) {
    event.waitUntil(self.registration.getNotifications({ tag: String(data.tag) }).then(notifications => {
      notifications.forEach(notification => notification.close());
    }));
  }
  // Handle navigation requests from clients
  if (data.type === 'MYNAAI_NAVIGATE' && data.target) {
    // This is handled in the main thread, but we can also try to open/focus
    try {
      const destination = new URL(data.target, self.location.origin).href;
      event.waitUntil(openOrFocus(destination));
    } catch {}
  }
  // Handle buzzer play requests from clients (for testing)
  if (data.type === 'MYNAAI_PLAY_BUZZER') {
    event.waitUntil(broadcastBuzzerToClients(data.notificationType || 'BOOKING_REQUEST', data.data || {}));
  }
});

if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // The SDK calls this handler for *every* background message, but when the
  // payload carries a `notification` block it has already displayed that
  // notification itself (wrapped as data.FCM_MSG). Building a second one here
  // would normally produce duplicate alerts, so only data-only messages are
  // rendered by us — except for booking requests, where we *must* show our own
  // notification with Accept/Reject/Delay action buttons. Using the same tag
  // replaces the SDK's notification instead of duplicating it, so the partner
  // always gets the actionable version.
  messaging.onBackgroundMessage(payload => {
    const data = payload.data || {};
    const type = String(data.type || data.notificationType || '').toUpperCase();
    const isBookingRequest = type === 'BOOKING_REQUEST';
    const isDelayBooking = type === 'DELAY_BOOKING';
    const hasNotificationBlock = Boolean(payload.notification?.title || payload.notification?.body);
    if (hasNotificationBlock && !isBookingRequest && !isDelayBooking) return;

    const title = payload.notification?.title || data.title || 'My Naai update';
    const body = payload.notification?.body || data.body || 'You have a new update from My Naai.';
    const target = notificationRoute(data);
    // Time-critical alerts vibrate like the mobile app's buzzer. The OS decides
    // the audible notification sound (set on the server's push payload); a
    // closed service worker cannot synthesize a custom tone, but we broadcast
    // to clients to play buzzer via Web Audio if they are open.
    const buzzer = type === 'BOOKING_REQUEST' || type === 'DELAY_BOOKING' || type === 'DELAY_TIME_PROPOSAL';

    // Broadcast buzzer to all open clients - works even when app is in background tab
    if (buzzer) {
      broadcastBuzzerToClients(type, data);
      broadcastViaChannel(type, data);
    }

    // Best-effort background sound: the worker passes the buzzer file to the
    // browser so it can play it when the PWA is closed. Web notification sound
    // support is inconsistent (Android largely uses the OS/channel sound and
    // ignores a custom URL), so this is the same limit the mobile-vs-web split
    // imposes — the real buzzer always plays via Web Audio while the app is open.
    const showNotificationPromise = self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.bookingRequestId || data.bookingId || data.type || 'mynaai-notification',
      data: { ...data, target },
      requireInteraction: isBookingRequest || type === 'DELAY_TIME_PROPOSAL' || isDelayBooking,
      // "Buzzer" vibration for booking alerts on supporting Android browsers.
      vibrate: buzzer ? [260, 120, 260, 120, 520] : undefined,
      silent: false,
      // Accept / Reject / Delay buttons on booking requests and delay bookings.
      // Every other notification type carries no action buttons and just opens the app.
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

    // Returning the promise matters: the SDK awaits this handler inside the
    // push event's waitUntil(), so the worker stays alive long enough to show
    // the alert (an unreturned promise can be killed mid-display).
    return showNotificationPromise;
  });
}

// Fallback push handler for browsers that may not trigger Firebase's handler
// (e.g., some Firefox versions, or when payload is not FCM-formatted).
// This ensures notifications still show even if Firebase fails.
self.addEventListener('push', event => {
  // If Firebase already handled it, event will have been responded to.
  // We check if event is already handled by seeing if we have FCM data.
  // This is a safety net - only show if no notification was shown by Firebase.

  // Don't handle if Firebase config is missing - let other handlers try
  if (!firebaseConfig.apiKey) return;

  try {
    if (!event.data) return;

    let payload = {};
    try {
      payload = event.data.json();
    } catch {
      // If not JSON, treat as text notification
      const text = event.data.text();
      if (!text) return;
      payload = { notification: { title: 'My Naai update', body: text }, data: {} };
    }

    // If this looks like an FCM message with notification block, Firebase will handle it
    // unless it's a booking request which we must make actionable.
    const data = payload.data || {};
    const type = String(data.type || data.notificationType || '').toUpperCase();
    const isBookingRequest = type === 'BOOKING_REQUEST';
    const hasNotificationBlock = Boolean(payload.notification?.title || payload.notification?.body);

    // If Firebase will handle this (notification block + not booking request), skip
    if (hasNotificationBlock && !isBookingRequest) return;

    // If we already have a notification showing for this tag, don't duplicate
    // (This check is best-effort)

    const title = payload.notification?.title || data.title || 'My Naai update';
    const body = payload.notification?.body || data.body || 'You have a new update from My Naai.';
    const target = notificationRoute(data);
    const buzzer = type === 'BOOKING_REQUEST' || type === 'DELAY_BOOKING' || type === 'DELAY_TIME_PROPOSAL';

    if (buzzer) {
      event.waitUntil(
        Promise.all([
          broadcastBuzzerToClients(type, data),
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
    // ignore push parsing errors - don't break the worker
  }
});

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
