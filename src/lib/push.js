import { getApps, initializeApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { getErrorMessage } from '../components/Shared';

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

// `register()` can resolve while the worker is still installing, and FCM's
// getToken needs an active worker to attach the push subscription to. Waiting
// here removes the "no active service worker" first-visit failure that shows up
// as a silent empty token.
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
      // No worker at all yet, wait a bit for activation
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

async function getPushServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  // If we already tried and have a promise, reuse it
  if (registrationPromise) {
    try {
      const existing = await registrationPromise;
      if (existing) return existing;
    } catch {
      // fall through to re-register
    }
    registrationPromise = undefined;
  }

  // Try to find an existing registration first - fast path, no network
  try {
    if (navigator.serviceWorker.getRegistration) {
      const existingScope = await navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope');
      if (existingScope) {
        const active = await waitForActiveWorker(existingScope, 3000);
        if (active) return active;
      }
      // Also check root scope - some browsers may have it there
      const rootReg = await navigator.serviceWorker.getRegistration('/');
      if (rootReg) {
        const script = rootReg.active?.scriptURL || rootReg.waiting?.scriptURL || rootReg.installing?.scriptURL || '';
        if (String(script).includes('firebase-messaging-sw')) {
          const active = await waitForActiveWorker(rootReg, 3000);
          if (active) return active;
        }
      }
    }
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not read existing service worker registration.'));
  }

  // Register fresh
  if (!registrationPromise) {
    registrationPromise = (async () => {
      try {
        // Ensure serviceWorker is ready before registering FCM worker - reduces race
        try {
          await Promise.race([
            navigator.serviceWorker.ready,
            delay(1500),
          ]);
        } catch {
          // ignore, proceed to register
        }

        const registration = await navigator.serviceWorker.register(
          `/firebase-messaging-sw.js?${queryConfig()}`,
          { scope: '/firebase-cloud-messaging-push-scope' }
        );
        const active = await waitForActiveWorker(registration, 8000);
        // Also wait for ready to ensure pushManager is available
        try {
          await Promise.race([
            navigator.serviceWorker.ready,
            delay(1000),
          ]);
        } catch {
          // ignore
        }
        return active || registration;
      } catch (error) {
        console.debug(getErrorMessage(error, 'Firebase push service worker registration failed.'));
        registrationPromise = undefined;
        return null;
      }
    })();
  }
  return registrationPromise;
}

// Read-only worker lookup for the diagnostics card: registering on demand can
// block for seconds while the script activates, and the health check should
// describe the current state rather than change it.
async function peekPushServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const registrations = navigator.serviceWorker.getRegistrations ? await navigator.serviceWorker.getRegistrations() : [];
    const isOurs = registration => [registration?.active, registration?.waiting, registration?.installing]
      .some(worker => String(worker?.scriptURL || '').includes('firebase-messaging-sw'));
    const match = registrations.find(isOurs);
    if (match) return match;
    return navigator.serviceWorker.getRegistration
      ? await navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope')
      : null;
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not read the service-worker registrations.'));
    return null;
  }
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isIosPwaInstalled() {
  return isIosDevice() && (window.matchMedia?.('(display-mode: standalone)').matches === true || navigator.standalone === true);
}

export function detectBrowser() {
  if (typeof navigator === 'undefined') return 'other';
  const agent = navigator.userAgent || '';
  const android = /android/i.test(agent);
  if (isIosDevice()) return /crios/i.test(agent) ? 'ios-chrome' : 'ios-safari';
  if (/samsungbrowser/i.test(agent)) return 'samsung';
  if (/firefox|fxios/i.test(agent)) return 'firefox';
  if (/edg\//i.test(agent)) return 'edge';
  if (/opr\/|opera/i.test(agent)) return 'opera';
  if (/chrome|crios/i.test(agent)) return android ? 'chrome-android' : 'chrome-desktop';
  if (/safari/i.test(agent)) return 'safari-desktop';
  return android ? 'chrome-android' : 'other';
}

export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch (error) {
    console.debug(getErrorMessage(error, 'Notification permission request failed.'));
    return Notification.permission || 'default';
  }
}

// Explains *why* push is unavailable so the UI (and support) can say something
// useful instead of failing silently.
export async function getPushStatus() {
  if (typeof window === 'undefined' || !('Notification' in window)) return { state: 'unsupported', reason: 'This browser cannot show notifications.' };
  if (!('serviceWorker' in navigator)) return { state: 'unsupported', reason: 'This browser cannot run web notifications. Try Chrome, Edge or Samsung Internet.' };
  if (!isPushConfigured()) return { state: 'unconfigured', reason: 'Notifications have not been enabled for this build yet — please contact My Naai support.' };
  // Check messaging capability BEFORE the permission state: on iOS Safari the
  // permission value is meaningless until the app is installed as a PWA, and
  // reporting "denied" there would send iPhone users to a browser setting that
  // does not exist. No PushManager => the install hint is the correct guidance.
  const messaging = await getMessagingClient();
  if (!messaging) {
    // iOS only exposes web push to installed PWAs (iOS 16.4+).
    const installed = isIosPwaInstalled();
    const installedHint = installed ? '' : ' On iPhone/iPad, install the My Naai app to your home screen first.';
    return { state: 'unsupported', reason: `This browser context cannot receive web notifications.${installedHint}` };
  }
  if (Notification.permission === 'denied') return { state: 'denied', reason: 'Notifications are blocked in the browser permissions for this site.' };
  if (Notification.permission === 'default') return { state: 'needs-permission', reason: 'Notification permission has not been granted yet.' };
  try {
    const token = await getPushToken({ requestPermission: false });
    if (token) return { state: 'enabled', token };
  } catch (statusError) {
    console.debug(getErrorMessage(statusError, 'Could not check notification status.'));
  }
  // Permission granted but token still empty — most often a transient service
  // worker or Firebase initialization race. Surface as unavailable so the UI
  // can offer a retry instead of staying silent.
  return { state: 'unavailable', reason: 'We could not prepare notifications in this browser. Please try again. This can happen on first visit - a retry usually works.' };
}

export async function getPushToken({ requestPermission = false } = {}) {
  if (!isPushConfigured() || typeof window === 'undefined' || !('Notification' in window)) return '';
  const messaging = await getMessagingClient();
  if (!messaging) return '';
  let permission = Notification.permission;
  if (permission === 'default' && requestPermission) {
    permission = await requestNotificationPermission();
  }
  if (permission !== 'granted') {
    // Permission not granted — clear any stale token so diagnostics and login
    // do not keep using an old value that the browser can no longer deliver to.
    try { localStorage.removeItem('FCM_TOKEN'); } catch { /* ignore */ }
    return '';
  }

  // Retry loop for token - handles transient "no active service worker" and other races
  // that caused the "Allow -> Retry, Retry" loop reported by users.
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await delay(600 * attempt);

    try {
      const registration = await getPushServiceWorker();
      if (!registration) {
        // If registration failed, try to reset and re-attempt
        registrationPromise = undefined;
        if (attempt < 2) continue;
        return '';
      }

      // Extra safety: wait for serviceWorker.ready if available
      if (attempt === 1) {
        try {
          await Promise.race([navigator.serviceWorker.ready, delay(1000)]);
        } catch {
          // ignore
        }
      }

      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      if (token) {
        try { localStorage.setItem('FCM_TOKEN', token); } catch { /* ignore */ }
        return token;
      }
      // Empty token but no throw - likely transient, retry unless last attempt
      if (attempt === 2) {
        try { localStorage.removeItem('FCM_TOKEN'); } catch { /* ignore */ }
        return '';
      }
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || '').toLowerCase();
      console.debug(getErrorMessage(error, 'Firebase could not generate a browser notification token.'));
      // Specific retryable errors
      if (msg.includes('no active service worker') || msg.includes('push subscription') || msg.includes('abort') || msg.includes('network')) {
        registrationPromise = undefined; // force re-register next attempt
        if (attempt < 2) continue;
      }
      // Non-retryable or last attempt
      if (attempt === 2) {
        return '';
      }
    }
  }

  console.debug('getPushToken failed after retries', lastError);
  return '';
}

// Booking-request notifications expose Accept / Reject / Delay action buttons,
// mirroring the My Naai mobile app. Browsers that do not render notification
// actions fall back to the notification body, which opens the request screen.
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
    // Also try BroadcastChannel for same-origin tabs
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('mynaai-notifications');
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // ignore - broadcast is best effort
  }
}

// FCM delivers foreground web messages to the page instead of the OS, so the
// app has to render them. Showing them through the messaging service worker
// keeps the notificationclick deep-link routing in one place.
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
    requireInteraction: type === 'BOOKING_REQUEST' || type === 'DELAY_TIME_PROPOSAL',
    // Buzzer-style vibration for time-critical alerts (Android browsers, also supported on some desktop)
    vibrate: isBuzzerType ? [260, 120, 260, 120, 520] : undefined,
    // Best-effort: some browsers support sound, most ignore it. Real buzzer plays via Web Audio in foreground.
    silent: false,
    // Ask the browser for action buttons on booking requests and delay bookings.
    // Browsers that do not support notification actions ignore this.
    actions: type === 'BOOKING_REQUEST' ? bookingRequestActions() : type === 'DELAY_BOOKING' ? [{ action: 'DELAY_BOOKING', title: 'View Delay' }] : undefined,
  };

  // Try to trigger buzzer in all open tabs via broadcast - works even when notification is shown via SW
  if (isBuzzerType) {
    broadcastToClients({ type: 'MYNAAI_PLAY_BUZZER', notificationType: type, data });
  }

  // Prefer the messaging service worker — its click handler is the single
  // source of truth for deep-link routing, even for foreground messages.
  try {
    const registration = await getPushServiceWorker();
    if (registration?.showNotification) {
      await registration.showNotification(finalTitle, options);
      return true;
    }
  } catch (error) {
    console.debug(getErrorMessage(error, 'The notification service worker could not display the alert.'));
  }
  // Fallback to the Window Notification API when the worker is unavailable
  // (e.g. first visit race, blocked registration). The onClick handler still
  // deep-links to the correct screen.
  try {
    const notification = new Notification(finalTitle, { body: finalBody, icon: options.icon, tag: options.tag });
    if (onClick) {
      notification.onclick = event => {
        try { event?.preventDefault?.(); } catch { /* ignore */ }
        try { onClick(); } catch (handlerError) { console.debug(getErrorMessage(handlerError, 'Notification click handler failed.')); }
        try { notification.close?.(); } catch { /* ignore */ }
        try { window.focus(); } catch { /* ignore */ }
      };
    } else {
      notification.onclick = () => {
        try { window.focus(); } catch { /* ignore */ }
        try {
          if (target && target !== '/#/') {
            window.location.hash = target.replace(/^\/#/, '#');
          }
        } catch { /* ignore */ }
        try { notification.close?.(); } catch { /* ignore */ }
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
    return `/#/delay?bookingRequestId=${id}&delayMinutes=${encodeURIComponent(data.delayMinutes || '')}&proposedTime=${encodeURIComponent(data.proposedTime || '')}${data.reason ? `&reason=${encodeURIComponent(data.reason)}` : ''}`;
  }
  if (type === 'BOOKING_CONFIRMED' || type === 'BOOKING_REJECTED' || type === 'DELAY_RESPONSE') return '/#/bookings';
  if (type === 'BOOKING_REQUEST') return `/#/bookingRequest?bookingRequestId=${id}`;
  if (type === 'DELAY_BOOKING') return `/#/bookingRequest?bookingRequestId=${id}&openDelayModal=true`;
  return '/#/';
}

// A web FCM message can arrive as `{ notification, data }`, data-only, or with an
// empty `data` object next to a populated `notification`. Merge both so routing
// and copy never depend on which shape the backend used.
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

// Records the last foreground delivery so the in-app diagnostics can prove the
// FCM pipeline is alive end to end (backend -> Firebase -> browser -> portal).
export function recordForegroundMessage(message = {}) {
  try {
    // A foreground FCM message arrives as { notification, data, from } — the
    // booking type lives in data, not at the top level.
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

// Step-by-step web push health, shown on both Account screens so "notifications
// are not working" can be pinned to a specific layer on the actual device.
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
  add('Notification permission', Notification.permission === 'granted' ? 'ok' : Notification.permission === 'denied' ? 'fail' : 'warn', Notification.permission, Notification.permission === 'denied' ? 'Allow notifications for this site in browser settings, then retry.' : Notification.permission === 'default' ? 'Not requested yet.' : '');

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
  // Always attempt a fresh token when messaging is available — a stale stored
  // token can hide a current worker/Firebase failure.
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
    : Notification.permission === 'granted'
      ? 'Permission is granted but no token exists yet — the worker or Firebase config is the problem, not the browser.'
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

// Ask the messaging service worker to close a notification by tag. Used by the
// booking request screen once its countdown expires (mirrors the mobile app's
// 70-second auto-cancel).
export async function closeNotification(tag) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await getPushServiceWorker();
    const worker = registration?.active || registration?.waiting || registration?.installing;
    if (worker) worker.postMessage({ type: 'MYNAAI_CLOSE_NOTIFICATION', tag: String(tag || '') });
    // Also broadcast to all clients to close in-page notifications
    broadcastToClients({ type: 'MYNAAI_CLOSE_NOTIFICATION', tag: String(tag || '') });
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not close the notification.'));
  }
}

export async function deletePushToken() {
  try { localStorage.removeItem('FCM_TOKEN'); } catch { /* ignore */ }
  const messaging = await getMessagingClient();
  if (!messaging) return;
  try { await deleteToken(messaging); } catch (error) { console.debug(getErrorMessage(error, 'Could not revoke the browser notification token.')); }
}

// Deep links a notification payload onto the matching hash route.
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

// Helper to reset registration promise - useful when token generation fails
export function resetPushRegistration() {
  registrationPromise = undefined;
  messagingPromise = undefined;
}
