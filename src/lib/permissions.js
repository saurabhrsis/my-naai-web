// Browser permissions for My Naai — booking alerts (notifications) and
// location — in one calm, one-tap place.
//
// These rules come straight from the "I allowed it but the app still says
// blocked" reports:
//
//   1. Never open a browser permission popup out of nowhere. Chrome and Safari
//      discount a prompt that is not attached to a labelled, deliberate tap, and
//      a *denied* permission can never be requested again from JavaScript — one
//      surprise popup permanently costs that visitor their alerts. Every ask
//      here is a button the user can read before tapping.
//   2. Read the LIVE permission. `Notification.permission` is a snapshot taken
//      when the page loaded; it keeps saying "denied" after the user has just
//      flipped the site back on in browser settings (Chrome and Samsung
//      Internet on Android are the usual offenders). The Permissions API is what
//      the browser's own settings UI writes to, so it is read first and
//      `Notification.permission` is only the fallback.
//   3. Call the browser API inside the tap. Safari silently drops a
//      `requestPermission()` / `getCurrentPosition()` that happens after an
//      `await` — the reason "I tapped Allow and no popup appeared".
//   4. Remember an explicit "Not now". The app never nags; the user can still
//      turn either permission on later from the Alerts & permissions card.
import { getErrorMessage } from '../components/Shared';

const ASK_KEY_PREFIX = 'mynaaiPermissionAsk:';
export const ASK_CHOICES = { later: 'later', allowed: 'allowed', blocked: 'blocked', never: 'never' };

// ── What the visitor last told us (so the UI never nags) ─────────────────────
export function readAskChoice(kind) {
  try {
    return localStorage.getItem(`${ASK_KEY_PREFIX}${kind}`) || '';
  } catch {
    return '';
  }
}

export function rememberAskChoice(kind, choice) {
  try {
    if (choice) localStorage.setItem(`${ASK_KEY_PREFIX}${kind}`, choice);
    else localStorage.removeItem(`${ASK_KEY_PREFIX}${kind}`);
  } catch {
    /* private mode: the in-memory UI state still behaves */
  }
}

// ── Device / browser detection ───────────────────────────────────────────────
// Named browsers matter: "open your browser settings" is not an instruction
// anybody can follow on a phone, and the path differs on every browser.
export function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isIosPwaInstalled() {
  if (typeof window === 'undefined' || !isIosDevice()) return false;
  return window.matchMedia?.('(display-mode: standalone)').matches === true || navigator.standalone === true;
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);
}

// True when My Naai is rendered inside another page's <iframe> (an embedded
// preview, a web view, a portal). Browsers force notification permission to
// "denied" for embedded frames, so the only honest advice there is to open My
// Naai in its own tab.
export function isEmbeddedFrame() {
  try {
    return typeof window !== 'undefined' && window.top !== window.self;
  } catch {
    return true; // reading window.top threw: a cross-origin frame for sure
  }
}

export function detectBrowser() {
  if (typeof navigator === 'undefined') return 'other';
  const agent = navigator.userAgent || '';
  const android = /android/i.test(agent);
  if (isIosDevice()) {
    // Every browser on iOS is a WebKit shell, but the *steps* differ: only a
    // Home Screen web app can receive web push, and Safari is the browser whose
    // "Add to Home Screen" reliably creates one — so the copy has to name the
    // browser the visitor actually opened.
    if (/crios/i.test(agent)) return 'ios-chrome';
    if (/fxios/i.test(agent)) return 'ios-firefox';
    if (/edgios/i.test(agent)) return 'ios-edge';
    return 'ios-safari';
  }
  if (/samsungbrowser/i.test(agent)) return 'samsung';
  if (/firefox|fxios/i.test(agent)) return 'firefox';
  if (/edg\//i.test(agent)) return 'edge';
  if (/opr\/|opera/i.test(agent)) return 'opera';
  if (/chrome|crios/i.test(agent)) return android ? 'chrome-android' : 'chrome-desktop';
  if (/safari/i.test(agent)) return 'safari-desktop';
  return android ? 'chrome-android' : 'other';
}

export const BROWSER_LABELS = {
  'chrome-android': 'Chrome on Android',
  'chrome-desktop': 'Chrome',
  'ios-safari': 'Safari on iPhone/iPad',
  'ios-chrome': 'Chrome on iPhone/iPad',
  'ios-firefox': 'Firefox on iPhone/iPad',
  'ios-edge': 'Edge on iPhone/iPad',
  samsung: 'Samsung Internet',
  firefox: 'Firefox',
  edge: 'Microsoft Edge',
  opera: 'Opera',
  'safari-desktop': 'Safari',
  other: 'your browser',
};

export function browserLabel(browser) {
  return BROWSER_LABELS[browser] || BROWSER_LABELS.other;
}

// Android switches site notifications off for the whole browser when the
// browser app's own notifications are off at OS level — the site setting then
// stays Blocked no matter what the user taps in the browser.
// A buzzer the salon cannot hear is the same as no alert at all, and the
// OS-level sound switches sit outside the browser permission. One line, only
// where it is true for the device actually in use.
export function buzzerHint(browser) {
  if (browser === 'chrome-android' || browser === 'samsung') {
    return 'Keep the phone off silent and media volume up — the buzzer plays as a sound plus vibration.';
  }
  if (isIosDevice()) {
    return 'The iPhone silent switch mutes the buzzer sound (the alert still arrives and vibrates).';
  }
  return 'Check that this device is not muted — the buzzer plays a sound and vibrates where supported.';
}

export function androidAppNotificationHint(browser) {
  return browser === 'chrome-android' || browser === 'samsung'
    ? ` Also check the browser app itself: Android Settings → Apps → ${browserLabel(browser)} → Notifications must be On.`
    : '';
}

export function siteHost() {
  try {
    return window.location.host;
  } catch {
    return 'this site';
  }
}

// ── Live permission reads ────────────────────────────────────────────────────
// 'granted' | 'denied' | 'default' | 'unsupported'
export async function readPermission(kind) {
  if (typeof window === 'undefined') return 'unsupported';
  const name = kind === 'location' ? 'geolocation' : 'notifications';
  if (kind === 'notifications' && !('Notification' in window)) return 'unsupported';
  if (kind === 'location' && typeof navigator !== 'undefined' && !navigator.geolocation) return 'unsupported';
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name });
      if (status && ['granted', 'denied', 'prompt'].includes(status.state)) {
        return status.state === 'prompt' ? 'default' : status.state;
      }
    }
  } catch (permissionError) {
    console.debug(getErrorMessage(permissionError, `Live ${kind} permission was not available.`));
  }
  if (kind === 'notifications') return (typeof Notification !== 'undefined' && Notification.permission) || 'default';
  return 'default';
}

// The browser fires `change` the moment the user flips the setting in its own
// UI (lock icon, site settings, Android app settings), which is what lets every
// card update itself without a "Check" tap. Returns an unsubscribe function.
export function watchPermission(kind, callback) {
  if (typeof window === 'undefined' || !navigator.permissions?.query) return () => {};
  const name = kind === 'location' ? 'geolocation' : 'notifications';
  let stopped = false;
  let status = null;
  navigator.permissions
    .query({ name })
    .then(result => {
      if (stopped) return;
      status = result;
      status.onchange = () => {
        try {
          callback();
        } catch (callbackError) {
          console.debug(getErrorMessage(callbackError, 'Permission change handler failed.'));
        }
      };
    })
    .catch(() => { /* older browsers: the focus re-check still covers this */ });
  return () => {
    stopped = true;
    try {
      if (status) status.onchange = null;
    } catch {
      /* ignore */
    }
  };
}

// ── The asks (always called from a real tap) ─────────────────────────────────
// Gesture-safe: the browser API is invoked synchronously, before any await, so
// Safari keeps the user gesture and actually shows its popup.
export function requestNotifications() {
  if (typeof window === 'undefined' || !('Notification' in window)) return Promise.resolve('unsupported');
  let prompt;
  try {
    prompt = Notification.requestPermission();
  } catch (error) {
    console.debug(getErrorMessage(error, 'Notification permission request failed.'));
    return readPermission('notifications');
  }
  // Older Safari uses the callback form and returns undefined here — the live
  // read below still reports whatever the user chose.
  return Promise.resolve(prompt)
    .catch(error => {
      console.debug(getErrorMessage(error, 'Notification permission request failed.'));
      return undefined;
    })
    .then(result => readPermission('notifications').then(live => {
      if (live === 'granted' || live === 'denied') return live;
      return result === 'granted' || result === 'denied' ? result : 'default';
    }));
}

function locateOnce(options) {
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        ok: true,
        state: 'granted',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      error => resolve({
        ok: false,
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        code: error?.code || 0,
        state: error?.code === 1 ? 'denied' : 'unavailable',
      }),
      options,
    );
  });
}

// One call, gesture-safe (no await before the browser API), with a single retry
// when the first attempt times out: a laptop with no GPS gets its position from
// Wi-Fi and often needs longer than the first window, and that cold timeout was
// one more way "Use my location" looked broken. The retry reuses the grant, so
// it never pops a second prompt.
export async function requestLocation(options = {}) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return { ok: false, state: 'unsupported', code: 0 };
  const first = await locateOnce({ enableHighAccuracy: false, timeout: 12000, maximumAge: 300000, ...options });
  if (first.ok || first.state === 'denied' || first.code !== 3) return first;
  return locateOnce({ enableHighAccuracy: false, timeout: 25000, maximumAge: 600000, ...options });
}

// ── Short, honest instructions ───────────────────────────────────────────────
// A blocked permission cannot be re-requested from JavaScript, so step-by-step
// settings directions are the only way back. They stay SHORT (three lines) and
// are only ever shown after the blocked state is real.
export function permissionSteps(browser, kind) {
  const name = kind === 'location' ? 'Location' : 'Notifications';
  const back = 'Come back to My Naai — it updates by itself, or tap Try again.';
  const steps = {
    'chrome-android': kind === 'location' ? [
      'Tap the lock (or settings) icon next to the address bar.',
      `Choose Permissions → ${name} → Allow.`,
      back,
    ] : [
      `In this page: tap the lock icon → Permissions → ${name} → Allow.`,
      'In Android: Settings → Apps → Chrome → Notifications → On.',
      back,
    ],
    'chrome-desktop': [
      'Click the lock (or tune) icon on the left of the address bar.',
      `Switch ${name} to Allow.`,
      back,
    ],
    samsung: kind === 'location' ? [
      'Tap the lock icon next to the address bar.',
      `Open Permissions → ${name} → Allow.`,
      back,
    ] : [
      `In this page: tap the lock icon → ${name} → Allow.`,
      'In Android: Settings → Apps → Samsung Internet → Notifications → On.',
      back,
    ],
    firefox: [
      'Tap the lock (or shield) icon next to the address bar.',
      'Open Site permissions and clear the block.',
      `Allow ${name}, then ${back.charAt(0).toLowerCase()}${back.slice(1)}`,
    ],
    edge: [
      'Tap the lock icon next to the address bar.',
      `Open Permissions → ${name} → Allow.`,
      back,
    ],
    opera: [
      'Tap the lock icon next to the address bar.',
      `Open Site settings → ${name} → Allow.`,
      back,
    ],
    'ios-safari': kind === 'location'
      ? [
        'Open iPhone Settings → Privacy & Security → Location Services.',
        'Turn it on, then scroll to Safari Websites → While Using the App.',
        back,
      ]
      : [
        'iPhone only allows notifications for apps added to the Home Screen.',
        'In Safari: Share → Add to Home Screen → Add.',
        'Open My Naai from the Home Screen and tap Allow.',
      ],
    'ios-chrome': kind === 'location'
      ? [
        'Open iPhone Settings → Privacy & Security → Location Services.',
        'Find Chrome and choose While Using the App.',
        back,
      ]
      : [
        'On iPhone, notifications only work for apps added to the Home Screen.',
        'Open mynaai.in in Safari → Share → Add to Home Screen → Add.',
        'Open My Naai from the Home Screen and tap Allow alerts.',
      ],
    'ios-firefox': kind === 'location'
      ? [
        'Open iPhone Settings → Privacy & Security → Location Services.',
        'Find Firefox and choose While Using the App.',
        back,
      ]
      : [
        'Firefox on iPhone cannot receive web notifications — iPhone only allows them for apps added to the Home Screen.',
        'Open mynaai.in in Safari → Share → Add to Home Screen → Add.',
        'Open My Naai from the Home Screen and tap Allow alerts.',
      ],
    'ios-edge': kind === 'location'
      ? [
        'Open iPhone Settings → Privacy & Security → Location Services.',
        'Find Edge and choose While Using the App.',
        back,
      ]
      : [
        'On iPhone, notifications only work for apps added to the Home Screen.',
        'Open mynaai.in in Safari → Share → Add to Home Screen → Add.',
        'Open My Naai from the Home Screen and tap Allow alerts.',
      ],
    'safari-desktop': [
      'Open Safari → Settings → Websites.',
      `Choose ${name} and set My Naai to Allow.`,
      back,
    ],
  };
  return steps[browser] || [
    'Open this site’s permissions in your browser (the lock icon next to the address bar).',
    `Set ${name} to Allow.`,
    back,
  ];
}

// ── The one-line explanations users read before they tap ─────────────────────
export const ALERTS_REQUIRED_MESSAGE = 'Turn on booking alerts so booking requests and confirmations reach you. Your browser will ask once — choose Allow and you are in.';
export const IOS_ALERTS_REQUIRED_MESSAGE = 'On iPhone, alerts only work once My Naai is on your Home Screen. Install it, then tap Allow — it takes 20 seconds.';
export const ALERTS_BLOCKED_MESSAGE = 'Alerts are switched off for My Naai in your browser settings. Turn them back on there, then tap Try again.';

// ── Backend contract helper ──────────────────────────────────────────────────
// Alerts are optional for the visitor but the API may still insist on a
// deviceToken. When that happens we need to recognise the refusal and answer
// with the alerts sheet instead of a generic error.
export function isDeviceTokenError(error) {
  const message = String(error?.data?.message || error?.message || error || '').toLowerCase();
  if (!message) return false;
  if (/device\s*-?\s*token/.test(message)) return true;
  const mentionsToken = message.includes('token');
  const demandsValue = /required|missing|empty|mandatory|not provided/.test(message);
  const isAuthToken = /auth|session|bearer|login token|otp|expired|invalid/.test(message);
  return mentionsToken && demandsValue && !isAuthToken;
}
