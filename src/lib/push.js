import { getApps, initializeApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { getErrorMessage } from '../components/Shared';
import { softNavigate } from './routes';
import {
  detectBrowser,
  isEmbeddedFrame,
  isIosDevice,
  isIosPwaInstalled,
  readPermission,
  requestNotifications,
  watchPermission,
} from './permissions';

// The permission plumbing (live reads, change watching, gesture-safe asks and
// the browser/device detection) lives in ./permissions so the login card, the
// Alerts & permissions centre and this module can never drift apart. The names
// below are re-exported because they were public API here first.
export { detectBrowser, isEmbeddedFrame, isIosDevice, isIosPwaInstalled };

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

let messagingPromise;
let registrationPromise;

export function isPushConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId && vapidKey);
}

function queryConfig() {
  return new URLSearchParams(Object.entries(firebaseConfig).filter(([, value]) => value)).toString();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getMessagingClient() {
  if (!isPushConfigured() || typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (!messagingPromise) {
    messagingPromise = (async () => {
      if (!(await isSupported())) return null;
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      return getMessaging(app);
    })().catch(error => {
      console.debug(getErrorMessage(error, 'Firebase Messaging is unavailable.'));
      messagingPromise = undefined;
      return null;
    });
  }
  return messagingPromise;
}

function waitForActiveWorker(registration, timeout = 8000) {
  return new Promise(resolve => {
    if (!registration) return resolve(null);
    if (registration.active) return resolve(registration);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(registration);
    };
    const timer = setTimeout(finish, timeout);
    const workers = [registration.installing, registration.waiting, registration.active].filter(Boolean);
    if (!workers.length) {
      setTimeout(finish, 800);
      return;
    }
    workers.forEach(worker => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' || registration.active) finish();
      });
    });
  });
}

// ONE service worker, ONE scope.
//
// /firebase-messaging-sw.js is the unified worker: it caches the app shell (so
// the PWA stays installable) AND handles Firebase Cloud Messaging, including
// the Accept / Reject / Delay action buttons when the app is closed. Registering
// a second script (the old /sw.js) at the same "/" scope replaced this
// registration on every load, which is a genuine cause of both "notifications
// stopped after a while" and "no active service worker" token errors.
export const PUSH_SW_URL = '/firebase-messaging-sw.js';
export const PUSH_SW_SCOPE = '/';

// Only the unified FCM worker is reusable. A root registration left by an older
// release (plain /sw.js, registered without the Firebase config in its query
// string) cannot receive background pushes, so it is replaced by the unified
// worker instead of being trusted.
function isPushWorkerScript(url) {
  return String(url || '').includes('firebase-messaging-sw');
}

function isOurWorkerScript(url) {
  const value = String(url || '');
  return value.includes('firebase-messaging-sw') || value.includes('sw.js');
}

// Called once from main.jsx and reused by every token request. The Firebase web
// config travels in the query string (the worker cannot read Vite env).
export function registerPushServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  if (registrationPromise) return registrationPromise;
  registrationPromise = (async () => {
    try {
      try {
        await Promise.race([navigator.serviceWorker.ready, delay(1500)]);
      } catch { /* no worker yet — register below */ }

      const existing = navigator.serviceWorker.getRegistration
        ? await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE)
        : null;
      if (existing && isPushWorkerScript(existing.active?.scriptURL || existing.waiting?.scriptURL || existing.installing?.scriptURL)) {
        const active = await waitForActiveWorker(existing, 3000);
        if (active) return active;
      }

      const registration = await navigator.serviceWorker.register(
        `${PUSH_SW_URL}?${queryConfig()}`,
        { scope: PUSH_SW_SCOPE },
      );
      const active = await waitForActiveWorker(registration, 8000);
      try {
        await Promise.race([navigator.serviceWorker.ready, delay(1000)]);
      } catch {}
      return active || registration;
    } catch (error) {
      console.debug(getErrorMessage(error, 'Firebase push service worker registration failed.'));
      registrationPromise = undefined;
      return null;
    }
  })();
  return registrationPromise;
}

// The registration every push call uses. It never registers a competing script:
// either the existing root worker is ours and active, or the unified worker is
// registered — once.
async function getPushServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

  try {
    if (navigator.serviceWorker.getRegistration) {
      const rootReg = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
      const script = rootReg?.active?.scriptURL || rootReg?.waiting?.scriptURL || rootReg?.installing?.scriptURL || '';
      if (rootReg && isPushWorkerScript(script)) {
        const active = await waitForActiveWorker(rootReg, 3000);
        if (active) return active;
      }
      // An old sub-scope registration from a previous release: use it if it is
      // still the only worker, so those users keep their push subscription.
      const oldScope = await navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope');
      if (oldScope && !rootReg) {
        const active = await waitForActiveWorker(oldScope, 2000);
        if (active) return active;
      }
    }
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not read existing service worker registration.'));
  }

  return registerPushServiceWorker();
}

async function peekPushServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const registrations = navigator.serviceWorker.getRegistrations ? await navigator.serviceWorker.getRegistrations() : [];
    const isOurs = registration => {
      const url = registration?.active?.scriptURL || registration?.waiting?.scriptURL || registration?.installing?.scriptURL || '';
      return String(url).includes('firebase-messaging-sw') || String(url).includes('sw.js');
    };
    const match = registrations.find(isOurs);
    if (match) return match;
    return navigator.serviceWorker.getRegistration
      ? await navigator.serviceWorker.getRegistration('/')
      : null;
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not read the service-worker registrations.'));
    return null;
  }
}

// Live notification permission ('granted' | 'denied' | 'default' |
// 'unsupported'), read from ./permissions — see that module for why the static
// `Notification.permission` snapshot is never trusted first.
export function readNotificationPermission() {
  return readPermission('notifications');
}

// Calls back the moment the browser reports a permission change. Returns an
// unsubscribe function.
export function watchNotificationPermission(callback) {
  return watchPermission('notifications', callback);
}

// Gesture-safe: safe (and correct) to call straight from a tap handler.
export function requestNotificationPermission() {
  return requestNotifications();
}

export async function getPushStatus() {
  if (typeof window === 'undefined' || !('Notification' in window)) return { state: 'unsupported', reason: 'This browser cannot show notifications.' };
  if (!('serviceWorker' in navigator)) return { state: 'unsupported', reason: 'This browser cannot run web notifications. Try Chrome, Edge or Samsung Internet.' };
  if (!isPushConfigured()) return { state: 'unconfigured', reason: 'Notifications have not been enabled for this build yet — please contact My Naai support.' };
  const messaging = await getMessagingClient();
  if (!messaging) {
    const installed = isIosPwaInstalled();
    const installedHint = installed ? '' : ' On iPhone/iPad, install the My Naai app to your home screen first.';
    return { state: 'unsupported', reason: `This browser context cannot receive web notifications.${installedHint}` };
  }
  // Live read (Permissions API first): a user who has just unblocked the site in
  // the browser's settings expects "Check" to see it immediately, not after a
  // page reload. See readNotificationPermission for why the static value lies.
  const permission = await readNotificationPermission();
  if (permission === 'denied') {
    // Embedded pages (an iframe inside another site or a preview tool) get their
    // notification permission force-denied by the browser, so the normal unblock
    // steps can never work there. Keep the state "denied" — every user sees the
    // same familiar card — and carry the embedded explanation in the reason.
    const reason = isEmbeddedFrame()
      ? 'Notifications are blocked for this site. This page appears to be open inside another page, and browsers switch notifications off for those — open My Naai in its own browser tab, then allow notifications.'
      : 'Notifications are blocked in the browser permissions for this site.';
    return { state: 'denied', reason };
  }
  if (permission === 'default') return { state: 'needs-permission', reason: 'Notification permission has not been granted yet.' };
  try {
    const token = await getPushToken({ requestPermission: false });
    if (token) return { state: 'enabled', token };
  } catch (statusError) {
    console.debug(getErrorMessage(statusError, 'Could not check notification status.'));
  }
  // Reaching here means the permission IS granted — the browser just could not
  // finish minting/collecting the token yet. Say so, name the real cause when we
  // know it, and make clear that it is not something the user did wrong: they
  // allowed notifications and the app registered exactly that.
  return {
    state: 'unavailable',
    reason: describePushTokenFailure() || 'Notifications are allowed on this device — the last step is still finishing. It retries by itself; you can also tap Try again.',
  };
}

// The one function that turns "the browser is allowed to notify" into the FCM
// registration token the API stores as `deviceToken`.
//
// Two failure modes used to cost real users here:
//   · the permission was read from the static `Notification.permission`
//     snapshot, so a visitor who had just switched alerts back on in their
//     browser settings was still treated as blocked;
//   · a token was demanded immediately after `requestPermission()` resolved,
//     before the fresh grant had propagated through the browser.
// The token is now minted from the LIVE permission with retries that survive a
// slow service-worker start-up (the usual "first tap did nothing" report), and
// callers are never blocked on it — signing in works without alerts.
//
// Two MORE failure modes are handled below, and they are the ones behind the
// "I allowed the pop-up and it still shows the error" reports:
//   · a push subscription left behind by an older worker (or an older VAPID
//     key) can never be redeemed — Firebase reuses the existing subscription and
//     fails forever. It is dropped and rebuilt, which is the standard remedy;
//   · the browser simply could not finish at that moment (worker still
//     starting, flaky network). The token is then retried quietly in the
//     background, and every surface hears about it through the
//     `mynaai:push-token` window event instead of showing an error the user
//     cannot act on.

// Fired on `window` whenever a token is finally minted (including the quiet
// background retries). Permission UI listens for it so a card can finish itself
// without the user pressing anything.
export const PUSH_TOKEN_EVENT = 'mynaai:push-token';

let lastTokenFailure = null;
let recoveryScheduled = false;

// The last reason a token could not be minted, classified for humans. Used by
// getPushStatus() and the Support report — a vague "the last step did not
// finish" tells the salon owner nothing.
export function readPushTokenFailure() {
  return lastTokenFailure;
}

function classifyTokenFailure(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  if (!message && !code) return 'unknown';
  if (code === 'no-worker' || code === 'empty-token') return code === 'no-worker' ? 'worker' : 'unknown';
  if (/offline|network|failed to fetch|net::|timeout|abort/.test(`${code} ${message}`)) return 'offline';
  if (/vapid|application server key|unauthor|401|403|invalid.*key/.test(`${code} ${message}`)) return 'key';
  if (/subscription|no active service worker|service worker|registration/.test(`${code} ${message}`)) return 'worker';
  if (/permission|blocked|denied|not allowed/.test(`${code} ${message}`)) return 'blocked';
  return 'unknown';
}

// One plain sentence per cause — what happened, and whether the user can do
// anything about it. Nothing here is an error the visitor caused.
export function describePushTokenFailure(failure = lastTokenFailure) {
  if (!failure) return '';
  switch (failure.kind) {
    case 'offline':
      return 'Notifications are allowed on this device — the browser could not reach My Naai alerts (no internet?). It retries by itself; you can also tap Try again.';
    case 'key':
      return 'Notifications are allowed on this device, but Firebase rejected this app\u2019s alert key. Send us the Support report and we will fix it on our side.';
    case 'worker':
      return 'Notifications are allowed on this device. The browser could not finish starting the alert worker — tap Try again (a reload helps on some browsers).';
    case 'blocked':
      return 'Notifications are allowed for this site, but this browser context will not deliver them. Open My Naai in its own browser tab and try once more.';
    default:
      return 'Notifications are allowed on this device — the last step is still finishing. It retries by itself; you can also tap Try again.';
  }
}

function rememberTokenFailure(error) {
  const kind = classifyTokenFailure(error);
  lastTokenFailure = {
    at: new Date().toISOString(),
    kind,
    code: String(error?.code || ''),
    message: String(error?.message || error || '').slice(0, 200),
  };
  return kind;
}

function clearTokenFailure() {
  lastTokenFailure = null;
}

function announceToken(token) {
  if (!token) return;
  try {
    window.dispatchEvent(new CustomEvent(PUSH_TOKEN_EVENT, { detail: { token } }));
  } catch {
    // A window that refuses CustomEvent still has the localStorage copy.
  }
}

// A push subscription from an older worker/scope/key is unusable and is exactly
// what makes a granted permission mint nothing. Drop it and re-register once.
async function resetPushSubscription() {
  try {
    const registration = await getPushServiceWorker();
    const subscription = registration?.pushManager?.getSubscription
      ? await registration.pushManager.getSubscription()
      : null;
    if (subscription) await subscription.unsubscribe();
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not clear the old push subscription.'));
  }
  try {
    const registrations = navigator.serviceWorker.getRegistrations
      ? await navigator.serviceWorker.getRegistrations()
      : [];
    for (const registration of registrations) {
      try { await registration.unregister(); } catch { /* keep going */ }
    }
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not reset the notification worker.'));
  }
  resetPushRegistration();
  try {
    return await registerPushServiceWorker();
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not register the notification worker again.'));
    return null;
  }
}

// Quietly finish the job later. No UI is blocked, no error is raised — the
// surfaces that care listen for PUSH_TOKEN_EVENT.
function scheduleTokenRecovery() {
  if (recoveryScheduled) return;
  recoveryScheduled = true;
  const delays = [4000, 15000, 45000];
  const attempt = index => {
    if (index >= delays.length) {
      recoveryScheduled = false;
      return;
    }
    setTimeout(async () => {
      try {
        const token = await getPushToken({ requestPermission: false });
        if (token) {
          recoveryScheduled = false;
          announceToken(token);
          return;
        }
      } catch (error) {
        console.debug(getErrorMessage(error, 'Background alert setup did not finish yet.'));
      }
      attempt(index + 1);
    }, delays[index]);
  };
  attempt(0);
}

export async function getPushToken({ requestPermission = false } = {}) {
  if (!isPushConfigured() || typeof window === 'undefined' || !('Notification' in window)) return '';
  const messaging = await getMessagingClient();
  if (!messaging) return '';

  let permission = await readNotificationPermission();
  if (permission === 'default' && requestPermission) {
    // Gesture-safe ask (see ./permissions): resolves with what the user chose.
    permission = await requestNotificationPermission();
  }
  if (permission !== 'granted') {
    try { localStorage.removeItem('FCM_TOKEN'); } catch {}
    if (requestPermission && permission === 'default') {
      // The popup was answered inside this same tap but the browser has not
      // propagated the new value yet — an iPhone Home Screen app can keep
      // reporting the old one for a moment. Keep trying quietly so the token
      // finishes on its own instead of asking the user to tap again.
      rememberTokenFailure({ code: 'pending', message: 'Waiting for the browser to report the new permission' });
      scheduleTokenRecovery();
    }
    return '';
  }

  const ATTEMPTS = 4;
  let lastError = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(500 * attempt);
    try {
      let registration = await getPushServiceWorker();
      if (!registration) {
        registrationPromise = undefined;
        if (attempt < ATTEMPTS - 1) continue;
        rememberTokenFailure({ code: 'no-worker', message: 'No active notification worker' });
        scheduleTokenRecovery();
        return '';
      }
      if (attempt > 0) {
        // A just-updated grant often needs the registration to be fully
        // active before Firebase will mint a token.
        try {
          await Promise.race([navigator.serviceWorker.ready, delay(1200)]);
        } catch {}
      }
      // Third try: if the worker or its push subscription is what failed, rebuild
      // it. A subscription made with an older VAPID key can never be redeemed.
      if (attempt === 2 && lastError && ['worker', 'offline'].includes(classifyTokenFailure(lastError))) {
        const rebuilt = await resetPushSubscription();
        if (rebuilt) registration = rebuilt;
      }
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      if (token) {
        try { localStorage.setItem('FCM_TOKEN', token); } catch {}
        clearTokenFailure();
        return token;
      }
      lastError = { code: 'empty-token', message: 'Firebase returned no token' };
      if (attempt === ATTEMPTS - 1) {
        try { localStorage.removeItem('FCM_TOKEN'); } catch {}
      }
    } catch (error) {
      lastError = error;
      console.debug(getErrorMessage(error, 'Firebase could not generate a browser notification token.'));
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('no active service worker') || msg.includes('push subscription') || msg.includes('abort') || msg.includes('network')) {
        registrationPromise = undefined;
      }
    }
  }
  console.debug('getPushToken failed after retries', lastError);
  rememberTokenFailure(lastError);
  try { localStorage.removeItem('FCM_TOKEN'); } catch {}
  scheduleTokenRecovery();
  return '';
}

export function bookingRequestActions() {
  return [
    { action: 'ACCEPT_BOOKING', title: 'Accept' },
    { action: 'REJECT_BOOKING', title: 'Reject' },
    { action: 'DELAY_BOOKING', title: 'Delay' },
  ];
}

function broadcastToClients(message) {
  try {
    if (typeof window !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage(message);
    }
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('mynaai-notifications');
      channel.postMessage(message);
      channel.close();
    }
  } catch {}
}

export async function displayNotification({ title, body, data = {}, onClick } = {}) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return false;
  const type = String(data.type || data.notificationType || '').toUpperCase();
  const isBuzzerType = type === 'BOOKING_REQUEST' || type === 'DELAY_BOOKING' || type === 'DELAY_TIME_PROPOSAL';
  const finalTitle = title || 'My Naai update';
  const finalBody = body || 'You have a new update from My Naai.';
  const target = notificationTarget(data);

  const options = {
    body: finalBody,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.bookingRequestId || data.bookingId || data.type || 'mynaai-notification',
    data: { ...data, target },
    requireInteraction: type === 'BOOKING_REQUEST' || type === 'DELAY_TIME_PROPOSAL' || type === 'DELAY_BOOKING',
    vibrate: isBuzzerType ? [260, 120, 260, 120, 520] : undefined,
    silent: false,
    actions: type === 'BOOKING_REQUEST' ? bookingRequestActions() : type === 'DELAY_BOOKING' ? [{ action: 'DELAY_BOOKING', title: 'View Delay' }] : undefined,
  };

  // NOTE: the buzzer is deliberately NOT broadcast to clients from here. The
  // caller that received the push already rings it (App.jsx for a foreground
  // message, the service worker for a background one), and broadcasting again
  // made a single booking request buzz two or three times over.
  try {
    const registration = await getPushServiceWorker();
    if (registration?.showNotification) {
      await registration.showNotification(finalTitle, options);
      return true;
    }
  } catch (error) {
    console.debug(getErrorMessage(error, 'The notification service worker could not display the alert.'));
  }
  try {
    const notification = new Notification(finalTitle, { body: finalBody, icon: options.icon, tag: options.tag });
    if (onClick) {
      notification.onclick = event => {
        try { event?.preventDefault?.(); } catch {}
        try { onClick(); } catch (handlerError) { console.debug(getErrorMessage(handlerError, 'Notification click handler failed.')); }
        try { notification.close?.(); } catch {}
        try { window.focus(); } catch {}
      };
    } else {
      notification.onclick = () => {
        try { window.focus(); } catch {}
        try {
          if (target && target !== '/') {
            softNavigate(target);
          }
        } catch {}
        try { notification.close?.(); } catch {}
      };
    }
    return true;
  } catch (error) {
    console.debug(getErrorMessage(error, 'This browser blocked the in-page notification.'));
    return false;
  }
}

function notificationTarget(data = {}) {
  const type = String(data.type || data.notificationType || '').toUpperCase();
  const id = encodeURIComponent(data.bookingRequestId || data.bookingId || '');
  if (type === 'DELAY_TIME_PROPOSAL') {
    return `/delay?bookingRequestId=${id}&delayMinutes=${encodeURIComponent(data.delayMinutes || '')}&proposedTime=${encodeURIComponent(data.proposedTime || '')}${data.reason ? `&reason=${encodeURIComponent(data.reason)}` : ''}`;
  }
  if (type === 'BOOKING_CONFIRMED' || type === 'BOOKING_REJECTED' || type === 'DELAY_RESPONSE') return '/bookings';
  if (type === 'BOOKING_REQUEST') return `/bookingRequest?bookingRequestId=${id}`;
  if (type === 'DELAY_BOOKING') return `/bookingRequest?bookingRequestId=${id}&openDelayModal=true`;
  return '/';
}

export function normalizePushPayload(payload = {}) {
  const notification = payload?.notification && typeof payload.notification === 'object' ? payload.notification : {};
  const raw = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const fallback = !raw.type && !notification.title && payload?.type ? payload : {};
  const data = { ...fallback, ...raw };
  if (!data.type && notification.click_action) data.type = String(notification.click_action);
  return {
    title: notification.title || data.title || data.notificationTitle || 'My Naai update',
    body: notification.body || data.body || data.message || data.notificationBody || 'You have a new update from My Naai.',
    data,
    type: String(data.type || data.notificationType || '').toUpperCase(),
    hasData: Boolean(Object.keys(raw).length),
  };
}

export function recordForegroundMessage(message = {}) {
  try {
    const data = message.data || {};
    localStorage.setItem('FCM_LAST_MESSAGE', JSON.stringify({
      at: new Date().toISOString(),
      type: data.type || data.notificationType || message.type || '',
      title: message.notification?.title || data.title || message.title || '',
    }));
  } catch (storageError) {
    console.debug(getErrorMessage(storageError, 'Could not record the last notification.'));
  }
}

export function readForegroundMessageRecord() {
  try {
    const parsed = JSON.parse(localStorage.getItem('FCM_LAST_MESSAGE') || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function maskToken(token) {
  const value = String(token || '');
  if (!value) return '';
  return value.length <= 24 ? `${value.slice(0, 6)}…` : `${value.slice(0, 14)}…${value.slice(-6)} (${value.length} chars)`;
}

export async function getPushDiagnostics() {
  const checks = [];
  const add = (label, state, value, detail = '') => checks.push({ label, state, value, detail });

  add('Secure context (HTTPS)', window.isSecureContext ? 'ok' : 'fail', window.isSecureContext ? 'Yes' : 'No', window.isSecureContext ? '' : 'Web push only works on https:// (or localhost).');
  const hasBrowserApis = 'Notification' in window && 'serviceWorker' in navigator;
  add('Browser APIs', hasBrowserApis ? 'ok' : 'fail', hasBrowserApis ? 'Available' : 'Missing', hasBrowserApis ? '' : 'This browser has no Notification/serviceWorker API — web push cannot work here.');
  const requiredConfig = { apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId, messagingSenderId: firebaseConfig.messagingSenderId, appId: firebaseConfig.appId, vapidKey };
  const missingRequired = Object.entries(requiredConfig).filter(([, value]) => !value).map(([key]) => key);
  const missingOptional = ['authDomain', 'storageBucket'].filter(key => !firebaseConfig[key]);
  add('Firebase web config', missingRequired.length ? 'fail' : 'ok',
    missingRequired.length ? `Missing ${missingRequired.join(', ')}` : missingOptional.length ? `Complete (${missingOptional.join(', ')} not set — not needed for push)` : 'Complete',
    missingRequired.length ? 'Set the VITE_FIREBASE_* build variables and redeploy.' : '');
  const permission = await readNotificationPermission();
  add('Notification permission', permission === 'granted' ? 'ok' : permission === 'denied' ? 'fail' : 'warn', permission,
    permission === 'denied'
      ? (isEmbeddedFrame()
        ? 'Blocked because this page is embedded inside another page. Open My Naai in its own browser tab, then allow notifications.'
        : 'Allow notifications for this site in browser settings, then retry — a reload helps on browsers that cache the old value.')
      : permission === 'default' ? 'Not requested yet.' : '');
  add('Page context', isEmbeddedFrame() ? 'warn' : 'ok', isEmbeddedFrame() ? 'Embedded inside another page' : 'Normal browser tab',
    isEmbeddedFrame() ? 'Browsers force notification permission to blocked inside embedded frames. Open My Naai in its own tab to allow them.' : '');

  let messaging = null;
  try { messaging = await getMessagingClient(); } catch (error) { console.debug(getErrorMessage(error, 'Messaging client unavailable.')); }
  add('Firebase Messaging', messaging ? 'ok' : 'fail', messaging ? 'Initialised' : 'Unavailable', messaging ? '' : 'iOS/iPadOS needs the installed PWA (Add to Home Screen); some browsers block it entirely.');

  let registration = null;
  try {
    registration = await peekPushServiceWorker();
    if (!registration && isPushConfigured()) registration = await getPushServiceWorker();
  } catch (error) { console.debug(getErrorMessage(error, 'Worker registration unavailable.')); }
  const worker = registration?.active || registration?.waiting || registration?.installing || null;
  add('Messaging service worker', registration ? 'ok' : 'fail', registration ? `${worker?.state || 'registered'} · scope ${registration.scope}` : 'Not registered', registration ? ''
    : isPushConfigured()
      ? 'The worker script /firebase-messaging-sw.js could not be registered (blocked, offline, or gstatic unreachable).'
      : 'Registration is skipped until the Firebase web config is complete.');

  let subscription = null;
  try { subscription = registration?.pushManager ? await registration.pushManager.getSubscription() : null; } catch (error) { console.debug(getErrorMessage(error, 'Push subscription unavailable.')); }
  add('Push subscription', subscription ? 'ok' : 'warn', subscription ? `Active · ${(subscription.endpoint || '').replace(/^https?:\/\//, '').split('/')[0]}` : 'None yet', subscription ? '' : 'Created on the next token request.');

  const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('FCM_TOKEN') || '' : '';
  let token = storedToken;
  if (messaging) {
    try {
      const fresh = await getPushToken({ requestPermission: false });
      if (fresh) token = fresh;
    } catch (tokenError) {
      console.debug(getErrorMessage(tokenError, 'Could not refresh FCM token for diagnostics.'));
    }
  }
  if (!token) token = storedToken;
  add('FCM device token', token ? 'ok' : 'fail', token ? maskToken(token) : 'Empty', token
    ? 'This is the value sent to the API as deviceToken.'
    : permission === 'granted'
      ? `Permission is granted but no token exists yet — the worker or Firebase config is the problem, not the browser.${lastTokenFailure ? ` Last attempt (${lastTokenFailure.kind}): ${lastTokenFailure.message}` : ''}`
        .replace(/\s+/g, ' ').trim()
      : 'Sign-in needs a token: tap Enable, allow notifications, then sign in again.');

  const last = readForegroundMessageRecord();
  add('Last foreground message', last ? 'ok' : 'warn', last ? `${last.type || 'notification'} · ${new Date(last.at).toLocaleString('en-IN')}` : 'None received yet', last ? '' : 'Send a test notification while this tab is open to verify delivery.');

  const failed = checks.some(check => check.state === 'fail');
  return { ok: !failed, checks };
}

export function formatPushDiagnostics(diagnostics = {}) {
  return (diagnostics.checks || [])
    .map(check => `${check.state.toUpperCase()} · ${check.label}: ${check.value}${check.detail ? ` — ${check.detail}` : ''}`)
    .join('\n');
}

export async function setupPush({ onMessage: handleMessage } = {}) {
  const messaging = await getMessagingClient();
  if (!messaging) return { token: '', unsubscribe: () => {} };
  const token = await getPushToken({ requestPermission: false });
  const unsubscribe = handleMessage ? onMessage(messaging, handleMessage) : () => {};
  return { token, unsubscribe };
}

export async function closeNotification(tag) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await getPushServiceWorker();
    const worker = registration?.active || registration?.waiting || registration?.installing;
    if (worker) worker.postMessage({ type: 'MYNAAI_CLOSE_NOTIFICATION', tag: String(tag || '') });
    broadcastToClients({ type: 'MYNAAI_CLOSE_NOTIFICATION', tag: String(tag || '') });
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not close the notification.'));
  }
}

export async function deletePushToken() {
  try { localStorage.removeItem('FCM_TOKEN'); } catch {}
  const messaging = await getMessagingClient();
  if (!messaging) return;
  try { await deleteToken(messaging); } catch (error) { console.debug(getErrorMessage(error, 'Could not revoke the browser notification token.')); }
}

const ACTIONABLE_SALON_TYPES = ['BOOKING_REQUEST', 'DELAY_BOOKING'];
const ACTIONABLE_USER_TYPES = ['DELAY_TIME_PROPOSAL'];

export function isActionableNotification(type, role = '') {
  const value = String(type || '').toUpperCase();
  return String(role).toUpperCase() === 'SALON' ? ACTIONABLE_SALON_TYPES.includes(value) : ACTIONABLE_USER_TYPES.includes(value);
}

export function getNotificationRoute(data = {}, role = '') {
  const type = String(data.type || data.notificationType || '').toUpperCase();
  const bookingRequestId = data.bookingRequestId || data.bookingId || '';
  const query = params => Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));

  if (type === 'DELAY_TIME_PROPOSAL' && String(role).toUpperCase() === 'USER') {
    return { name: 'delay', params: query({ bookingRequestId, delayMinutes: data.delayMinutes, proposedTime: data.proposedTime, reason: data.reason }) };
  }
  if ((type === 'BOOKING_CONFIRMED' || type === 'BOOKING_REJECTED' || type === 'DELAY_RESPONSE') && String(role).toUpperCase() === 'USER') {
    return { name: 'bookings', params: {} };
  }
  if (type === 'BOOKING_REQUEST' && String(role).toUpperCase() === 'SALON') {
    return { name: 'bookingRequest', params: query({ bookingRequestId }) };
  }
  if (type === 'DELAY_BOOKING' && String(role).toUpperCase() === 'SALON') {
    return { name: 'bookingRequest', params: query({ bookingRequestId, openDelayModal: 'true' }) };
  }
  return { name: String(role).toUpperCase() === 'SALON' ? 'queue' : 'home', params: {} };
}

export function resetPushRegistration() {
  registrationPromise = undefined;
  messagingPromise = undefined;
}
