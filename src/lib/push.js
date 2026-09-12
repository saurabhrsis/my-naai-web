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

// Unified push service worker registration at ROOT scope "/"
// This is critical for PWA: when app is installed and not in recent, the root SW is woken by push
// Old registrations at sub-scope are migrated automatically
async function getPushServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (registrationPromise) {
    try {
      const existing = await registrationPromise;
      if (existing) return existing;
    } catch {
      // fall through
    }
    registrationPromise = undefined;
  }

  // Try to find existing registration at root scope first (new unified SW)
  try {
    if (navigator.serviceWorker.getRegistration) {
      // Check root scope - this is where PWA lives and where push should be for background when closed
      const rootReg = await navigator.serviceWorker.getRegistration('/');
      if (rootReg) {
        const script = rootReg.active?.scriptURL || rootReg.waiting?.scriptURL || rootReg.installing?.scriptURL || '';
        // If root SW is ours (contains firebase or is sw.js), use it
        if (String(script).includes('firebase-messaging-sw') || String(script).includes('sw.js')) {
          const active = await waitForActiveWorker(rootReg, 3000);
          if (active) return active;
        }
      }
      // Fallback: check old sub-scope for migration
      const oldScope = await navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope');
      if (oldScope) {
        const active = await waitForActiveWorker(oldScope, 2000);
        if (active) return active;
      }
      // Check all registrations
      if (navigator.serviceWorker.getRegistrations) {
        const all = await navigator.serviceWorker.getRegistrations();
        const ours = all.find(r => {
          const url = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || '';
          return String(url).includes('firebase-messaging-sw') || (String(url).includes('sw.js') && r.scope === location.origin + '/');
        });
        if (ours) {
          const active = await waitForActiveWorker(ours, 3000);
          if (active) return active;
        }
      }
    }
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not read existing service worker registration.'));
  }

  // Register fresh at ROOT scope "/" - critical for PWA background notifications when not in recent
  if (!registrationPromise) {
    registrationPromise = (async () => {
      try {
        try {
          await Promise.race([navigator.serviceWorker.ready, delay(1500)]);
        } catch {}

        // Try root scope with firebase-messaging-sw.js first (unified SW)
        let registration;
        try {
          registration = await navigator.serviceWorker.register(
            `/firebase-messaging-sw.js?${queryConfig()}`,
            { scope: '/' }
          );
        } catch (rootError) {
          console.debug('Root scope FCM registration failed, trying sw.js', rootError);
          // Fallback to sw.js at root
          try {
            registration = await navigator.serviceWorker.register(
              `/sw.js?${queryConfig()}`,
              { scope: '/' }
            );
          } catch (swError) {
            console.debug('sw.js registration also failed, trying sub-scope', swError);
            // Last resort: sub-scope (old behavior)
            registration = await navigator.serviceWorker.register(
              `/firebase-messaging-sw.js?${queryConfig()}`,
              { scope: '/firebase-cloud-messaging-push-scope' }
            );
          }
        }

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
  }
  return registrationPromise;
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
  if (Notification.permission === 'denied') return { state: 'denied', reason: 'Notifications are blocked in the browser permissions for this site.' };
  if (Notification.permission === 'default') return { state: 'needs-permission', reason: 'Notification permission has not been granted yet.' };
  try {
    const token = await getPushToken({ requestPermission: false });
    if (token) return { state: 'enabled', token };
  } catch (statusError) {
    console.debug(getErrorMessage(statusError, 'Could not check notification status.'));
  }
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
    try { localStorage.removeItem('FCM_TOKEN'); } catch {}
    return '';
  }

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await delay(600 * attempt);
    try {
      const registration = await getPushServiceWorker();
      if (!registration) {
        registrationPromise = undefined;
        if (attempt < 2) continue;
        return '';
      }
      if (attempt === 1) {
        try {
          await Promise.race([navigator.serviceWorker.ready, delay(1000)]);
        } catch {}
      }
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      if (token) {
        try { localStorage.setItem('FCM_TOKEN', token); } catch {}
        return token;
      }
      if (attempt === 2) {
        try { localStorage.removeItem('FCM_TOKEN'); } catch {}
        return '';
      }
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || '').toLowerCase();
      console.debug(getErrorMessage(error, 'Firebase could not generate a browser notification token.'));
      if (msg.includes('no active service worker') || msg.includes('push subscription') || msg.includes('abort') || msg.includes('network')) {
        registrationPromise = undefined;
        if (attempt < 2) continue;
      }
      if (attempt === 2) {
        return '';
      }
    }
  }
  console.debug('getPushToken failed after retries', lastError);
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

  if (isBuzzerType) {
    broadcastToClients({ type: 'MYNAAI_PLAY_BUZZER', notificationType: type, data });
  }

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
          if (target && target !== '/#/') {
            window.location.hash = target.replace(/^\/#/, '#');
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
    return `/#/delay?bookingRequestId=${id}&delayMinutes=${encodeURIComponent(data.delayMinutes || '')}&proposedTime=${encodeURIComponent(data.proposedTime || '')}${data.reason ? `&reason=${encodeURIComponent(data.reason)}` : ''}`;
  }
  if (type === 'BOOKING_CONFIRMED' || type === 'BOOKING_REJECTED' || type === 'DELAY_RESPONSE') return '/#/bookings';
  if (type === 'BOOKING_REQUEST') return `/#/bookingRequest?bookingRequestId=${id}`;
  if (type === 'DELAY_BOOKING') return `/#/bookingRequest?bookingRequestId=${id}&openDelayModal=true`;
  return '/#/';
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
