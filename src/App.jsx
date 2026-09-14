import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarCheck2,
  Check,
  ChevronRight,
  CircleAlert,
  CircleUserRound,
  Download,
  RefreshCw,
  HelpCircle,
  History,
  Info,
  LogOut,
  MapPin,
  Package,
  Scissors,
  Settings2,
  Sparkles,
  Store,
  UsersRound,
  X,
  Settings,
  Volume2,
  Smartphone,
  BellRing,
  ShieldCheck,
  RotateCw,
} from 'lucide-react';
import { api, clearSession, getToken, isPlanExpiredResponse, isUnknownSalonResponse, setToken } from './lib/api';
import { closeNotification, deletePushToken, displayNotification, getNotificationRoute, getPushStatus, getPushToken, isActionableNotification, isEmbeddedFrame, normalizePushPayload, recordForegroundMessage, setupPush, watchNotificationPermission } from './lib/push';
import { playBuzzer, unlockBuzzer } from './lib/buzzer';
import { resetLiveUpdatesSocket } from './lib/socket';
import { DEFAULT_SERVICES } from './lib/defaultServices';
import { getSubscriptionState } from './lib/planDetails';
import { getSalonSubscriptionProfile, getSalonSubscriptionState, salonProfileNeedsCompletion as salonNeedsProfileCompletion } from './lib/salonProfile';
import { flagIsFalse, flagIsTrue } from './lib/flags';
import { STATE_OPTIONS } from './lib/stateOptions';
import {
  AccountScreen,
  BookingsScreen,
  DelayRequestScreen,
  HomeScreen,
  InfoScreen,
  NotificationsScreen,
  ProductsScreen,
  SalonDetailScreen,
  ScheduleScreen,
  ServicesScreen,
} from './components/UserScreens';
import {
  BookingRequestScreen,
  EditSalonProfileScreen,
  SalonAccountScreen,
  SalonHistoryScreen,
  SalonProductsScreen,
  SalonQueueScreen,
} from './components/SalonScreens';
import { SubscriptionScreen } from './components/SubscriptionScreen';
import { ConfirmProvider, LOGOUT_CONFIRM, useConfirm } from './components/ConfirmDialog';
import { SALON_ABOUT_CONTENT, SALON_FAQ_CONTENT, SALON_TERMS_CONTENT } from './lib/salonContent';
import { Button, Field, Modal, SelectField, Spinner, getBrowserLocation, getErrorMessage, cx } from './components/Shared';

const USER_NAV = [
  { name: 'home', label: 'Discover', icon: Scissors },
  { name: 'bookings', label: 'My bookings', icon: CalendarCheck2 },
  { name: 'products', label: 'Products', icon: Package },
  { name: 'account', label: 'Account', icon: CircleUserRound },
];
const SALON_NAV = [
  { name: 'queue', label: 'Customer queue', icon: UsersRound },
  { name: 'history', label: 'History', icon: History },
  { name: 'salonProducts', label: 'Products', icon: Package },
  { name: 'account', label: 'Account', icon: CircleUserRound },
];

function readStoredSession() {
  const loggedIn = localStorage.getItem('isLoggedIn') === 'true';
  const role = localStorage.getItem('userType');
  if (!loggedIn || !role || !getToken()) return null;
  let user = {};
  try { user = JSON.parse(localStorage.getItem('mynaaiUser') || '{}'); } catch (parseError) { console.debug(getErrorMessage(parseError, 'Stored session data was invalid.')); user = {}; }
  const userId = user?.userId || user?.salon?.salonId || user?.salonId || user?.id || '';
  const incompleteSalon = String(role).toUpperCase() === 'SALON' && (flagIsTrue(user?.isNewSalon) || flagIsFalse(user?.profileCompleted) || flagIsFalse(user?.salon?.profileCompleted));
  return { role, user, userId, isNewSalon: localStorage.getItem('isNewSalon') === 'true' || incompleteSalon };
}

function saveSession(session) {
  const role = String(session.role || '').toUpperCase();
  const user = session.user || {};
  if (session.token) setToken(session.token);
  localStorage.setItem('mynaaiUser', JSON.stringify(user));
  localStorage.setItem('userType', role);
  localStorage.setItem('isLoggedIn', 'true');
  localStorage.setItem('isNewSalon', session.isNewSalon ? 'true' : 'false');
  return { ...session, role, userId: session.userId || user?.userId || user?.salon?.salonId || user?.salonId || user?.id || '' };
}

// Hash routing. `navigate` writes `#/<screen>?<query>`, and `getRouteFromHash`
// is its inverse: it turns the current hash back into `{ name, params }`. It runs
// on first paint (so a refresh keeps you on the screen you were on), on
// popstate/hashchange (browser back/forward), and when another tab rewrites the
// stored session. It also has to accept the deep links notifications open —
// `/#/bookingRequest?bookingRequestId=…` for a partner, `/#/delay?…` for a
// customer — which is why an unknown or role-mismatched screen falls back to the
// role's home instead of rendering a screen the shell has no branch for.
const USER_ROUTE_NAMES = ['home', 'bookings', 'products', 'account', 'detail', 'services', 'schedule', 'notifications', 'delay', 'about', 'faq', 'terms'];
const SALON_ROUTE_NAMES = ['queue', 'history', 'salonProducts', 'account', 'notifications', 'editProfile', 'bookingRequest', 'subscription', 'salonAbout', 'salonFaq', 'salonTerms'];

function defaultRouteForRole(role) {
  return { name: String(role || '').toUpperCase() === 'SALON' ? 'queue' : 'home', params: {} };
}

export function getRouteFromHash(role) {
  const fallback = defaultRouteForRole(role);
  if (typeof window === 'undefined') return fallback;
  const hash = String(window.location.hash || '').replace(/^#/, '');
  const [rawName, rawQuery = ''] = hash.split('?');
  let name = '';
  try { name = decodeURIComponent(rawName); } catch { name = rawName; }
  name = name.replace(/^\/+|\/+$/g, '');
  const knownRoutes = String(role || '').toUpperCase() === 'SALON' ? SALON_ROUTE_NAMES : USER_ROUTE_NAMES;
  if (!knownRoutes.includes(name)) return fallback;
  const params = {};
  try {
    for (const [key, value] of new URLSearchParams(rawQuery).entries()) params[key] = value;
  } catch (parseError) {
    console.debug(getErrorMessage(parseError, 'Ignored an unreadable route query string.'));
  }
  return { name, params };
}

const PUSH_REQUIRED_MESSAGE = 'My Naai needs notification permission to sign you in — it is how booking requests and confirmations reach you. Please allow notifications to continue.';
const IOS_PUSH_REQUIRED_MESSAGE = 'On iPhone, notifications only work once My Naai is on your Home Screen. Install the app to your Home Screen, then allow notifications.';
const PUSH_BLOCKED_MESSAGE = 'Notifications are blocked for My Naai in your browser. You need to allow them in browser settings to sign in and receive booking alerts.';

// The exact host the user must have in the address bar when they unblock the
// site. Allowing notifications for www.mynaai.in does nothing for mynaai.in
// (or the other way round), which is one of the reasons "I allowed it — Check"
// kept saying Blocked.
function siteHost() {
  try { return window.location.host; } catch { return 'this site'; }
}

// Android switches site notifications off for the whole browser when the
// browser app's own notifications are off at OS level — the site setting then
// stays Blocked no matter what the user taps in the browser. Only Android
// browsers need the hint.
function androidAppNotificationHint(browser) {
  return browser === 'chrome-android' || browser === 'samsung'
    ? ` Also check the browser app itself: Android Settings → Apps → ${BROWSER_LABELS[browser]} → Notifications must be On.`
    : '';
}

async function requirePushToken() {
  const token = await getPushToken({ requestPermission: true });
  if (!token) {
    // A token can never be created in regular iOS Safari (web push only exists
    // for Home Screen apps). Point the user at the install steps instead of the
    // generic "allow notifications" copy, which describes a dialog iOS never shows.
    if (isIosDevice() && !isIosPwaInstalled()) throw new Error(IOS_PUSH_REQUIRED_MESSAGE);
    throw new Error(PUSH_REQUIRED_MESSAGE);
  }
  return token;
}

function withDeviceToken(payload, token) {
  const value = typeof token === 'string' ? token.trim() : '';
  if (!value) throw new Error(PUSH_REQUIRED_MESSAGE);
  return { ...payload, deviceToken: value };
}

async function queryLocationPermission() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  try {
    if (navigator.permissions?.query) {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      if (result.state === 'granted' || result.state === 'denied') return result.state;
    }
  } catch (error) {
    console.debug(getErrorMessage(error, 'Could not check location permission.'));
  }
  return 'prompt';
}

// iOS only exposes web push to installed PWAs (iOS 16.4+). Regular Safari has
// no PushManager, so a notification token can never be created there. Detect
// that case so the notification card can guide the user to Add to Home Screen
// instead of hiding every action and stranding them at login.
function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isIosPwaInstalled() {
  return isIosDevice() && (window.matchMedia?.('(display-mode: standalone)').matches === true || navigator.standalone === true);
}

// Which browser is this, so the permission help can name the actual menu the
// person has to open. "Open your browser settings" is not an instruction
// anybody can follow on a phone — the path differs on every browser, and a
// blocked permission cannot be re-requested from JavaScript (the browser only
// shows its prompt once), so precise steps are the only way out of a block.
function detectBrowser() {
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

const BROWSER_LABELS = {
  'chrome-android': 'Chrome on Android',
  'chrome-desktop': 'Chrome',
  'ios-safari': 'Safari on iPhone/iPad',
  'ios-chrome': 'Chrome on iPhone/iPad',
  samsung: 'Samsung Internet',
  firefox: 'Firefox',
  edge: 'Microsoft Edge',
  opera: 'Opera',
  'safari-desktop': 'Safari',
  other: 'your browser',
};

// Step-by-step routes to the site permission screen, per browser and per
// permission. These are the only reliable way back from a "blocked" state.
function permissionSteps(browser, kind) {
  const name = kind === 'location' ? 'Location' : 'Notifications';
  const steps = {
    'chrome-android': [
      'Tap the lock or settings icon next to the address bar at the top of this page.',
      'Choose Permissions (or Site settings).',
      `Set ${name} to Allow.`,
      'Come back to My Naai — the status updates by itself, or tap Check again.',
    ],
    'chrome-desktop': [
      'Click the lock, tune or info icon on the left of the address bar.',
      `Find ${name} in the list and switch it to Allow.`,
      'Come back to My Naai — the status updates by itself, or tap Check again.',
    ],
    samsung: [
      'Tap the lock icon next to the address bar.',
      'Open Permissions.',
      `Set ${name} to Allow.`,
      'Come back to My Naai — the status updates by itself, or tap Check again.',
    ],
    firefox: [
      'Tap the lock or shield icon next to the address bar.',
      'Open the site permissions / Clear permissions option.',
      `Allow ${name} for this site.`,
      'Come back to My Naai — the status updates by itself, or tap Check again.',
    ],
    edge: [
      'Click or tap the lock icon next to the address bar.',
      'Open Permissions for this site.',
      `Set ${name} to Allow.`,
      'Come back to My Naai — the status updates by itself, or tap Check again.',
    ],
    opera: [
      'Tap the lock icon next to the address bar.',
      'Open Site settings.',
      `Set ${name} to Allow.`,
      'Come back to My Naai — the status updates by itself, or tap Check again.',
    ],
    'ios-safari': kind === 'location'
      ? [
        'Open the iPhone Settings app.',
        'Go to Privacy & Security, then Location Services, and make sure it is on.',
        'Scroll to Safari Websites and choose While Using the App.',
        'Come back to My Naai — the status updates by itself, or tap Check again.',
      ]
      : [
        'Add My Naai to your Home Screen first — iPhone only allows notifications for installed apps.',
        'In Safari tap the Share button, then Add to Home Screen, then Add.',
        'Open My Naai from your Home Screen.',
        'Tap Enable and choose Allow.',
      ],
    'ios-chrome': kind === 'location'
      ? [
        'Open the iPhone Settings app.',
        'Go to Privacy & Security, then Location Services.',
        'Find Chrome and choose While Using the App.',
        'Come back to My Naai — the status updates by itself, or tap Check again.',
      ]
      : [
        'iPhone only allows notifications for apps added to the Home Screen, and that has to be done in Safari.',
        'Open mynaai.in in Safari, tap Share, then Add to Home Screen.',
        'Open My Naai from your Home Screen.',
        'Tap Enable and choose Allow.',
      ],
    'safari-desktop': [
      'Open Safari > Settings > Websites.',
      `Choose ${name} in the sidebar.`,
      'Set My Naai to Allow.',
      'Come back to My Naai — the status updates by itself, or tap Check again.',
    ],
  };
  return steps[browser] || [
    'Open the site permissions for My Naai in your browser (usually the lock or settings icon next to the address bar).',
    `Set ${name} to Allow.`,
    'Come back to My Naai — the status updates by itself, or tap Check again.',
  ];
}

// One shared modal for "notifications are blocked" and "location is blocked".
function PermissionHelp({ open, onClose, kind = 'notifications' }) {
  const browser = detectBrowser();
  const label = BROWSER_LABELS[browser] || BROWSER_LABELS.other;
  const title = kind === 'location' ? 'Allow location for My Naai' : 'Allow notifications for My Naai';
  const lede = kind === 'location'
    ? `Location is optional — you can use My Naai without it, you just won't see how far each salon is. To turn it on in ${label}:`
    : `A browser only asks once, so once notifications are blocked they have to be turned back on in ${label}'s settings:`;
  // "Check again" is honest: every card that opens this modal re-reads the
  // real permission when it closes, so the user gets an immediate answer. A
  // reload is offered too, because some browsers only hand the page the fresh
  // permission on a new load.
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={(
        <>
          {kind === 'notifications' && <Button variant="secondary" onClick={() => window.location.reload()}><RotateCw size={14} /> Reload page</Button>}
          <Button onClick={onClose}>Check again</Button>
        </>
      )}
    >
      <p className="modal-lede">{lede}</p>
      <ol className="ios-install-steps">
        {permissionSteps(browser, kind).map(step => <li key={step}>{step}</li>)}
      </ol>
      {kind === 'notifications' && (
        <p className="permission-help-note">
          My Naai uses notifications for booking requests, confirmations and delay alerts — the buzzer that tells a salon a customer is waiting. If you cannot enable them on this device, call <a href="tel:8380017393">8380017393</a> and we will help.
        </p>
      )}
    </Modal>
  );
}

// Opens the browser's own popups one at a time, from one tap — notifications
// first (sign-in depends on them), then location while the tap is still fresh.
// Two popups at once is what made the old splash flow confusing, so the second
// one only appears after the first has been answered. The login screen never
// does this on its own; its setup card and the Continue button own the prompts.
async function promptBrowserPermissions() {
  let token = '';
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      token = await getPushToken({ requestPermission: true });
    }
    if (!token) token = await getPushToken({ requestPermission: false });
  } catch (error) {
    console.debug(getErrorMessage(error, 'Browser notification permission was not available.'));
  }
  try {
    // Respect an explicit Skip on the login card — the first tap that fires
    // this handler can be the Skip tap itself.
    let locationDismissed = false;
    try { locationDismissed = sessionStorage.getItem('mynaaiLocationPromptDismissed') === 'true'; } catch {}
    const state = locationDismissed ? 'denied' : await queryLocationPermission();
    if (state !== 'denied' && state !== 'unsupported') {
      await getBrowserLocation({ timeout: 60000 });
    }
  } catch (error) {
    console.debug(getErrorMessage(error, 'Browser location permission was not available.'));
  }
  return token || '';
}

// The last-resort sheet for when "Continue with OTP" is tapped without a
// token. It never opens a second modal on top of itself — the fix for a
// blocked browser is inline: exact steps for the detected browser plus a
// one-tap "I allowed it — Check" that re-reads the real permission, which is
// the only way back from "denied" (a browser will not show its popup twice).
function PermissionGateModal({ open, onClose, onGranted, state: initialState = 'needs-permission' }) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const browser = detectBrowser();
  const browserLabel = BROWSER_LABELS[browser] || BROWSER_LABELS.other;
  const needsInstall = isIosDevice() && !isIosPwaInstalled();

  useEffect(() => {
    if (open) {
      setState(initialState);
      setCheckFailed(false);
    }
  }, [open, initialState]);

  const readStatus = useCallback(async () => {
    try {
      const status = await getPushStatus();
      setState(status.state);
      return status;
    } catch (statusError) {
      console.debug(getErrorMessage(statusError, 'Could not read the notification status.'));
      setState('unavailable');
      return { state: 'unavailable', token: '' };
    }
  }, []);

  const succeed = useCallback((token) => {
    if (token) {
      onGranted?.(token);
      onClose?.();
    }
  }, [onClose, onGranted]);

  // While the sheet is open, follow the live permission: the moment the user
  // flips the setting in the browser (or the browser finally reports the
  // change), the sheet re-reads the status and closes itself on success — no
  // Check tap needed.
  useEffect(() => {
    if (!open) return undefined;
    return watchNotificationPermission(async () => {
      const status = await readStatus();
      if (status.state === 'enabled' && status.token) succeed(status.token);
    });
  }, [open, readStatus, succeed]);

  // The normal path: the browser's own popup appears, the user chooses Allow,
  // and the sheet closes the moment a token exists.
  const allow = async () => {
    setBusy(true);
    try {
      const token = await getPushToken({ requestPermission: true });
      if (token) {
        succeed(token);
        return;
      }
    } catch (askError) {
      console.debug(getErrorMessage(askError, 'Could not ask the browser for notification permission.'));
    }
    await readStatus();
    setBusy(false);
  };

  // One tap after the user flipped the setting in the browser's own settings.
  // Re-reads the live permission — not a cached copy — so "I did it" is either
  // confirmed by closing the sheet or answered with a concrete next hint.
  const check = async () => {
    setBusy(true);
    try {
      const status = await readStatus();
      if (status.state === 'enabled' && status.token) {
        succeed(status.token);
        return;
      }
      if (status.state === 'needs-permission') {
        const token = await getPushToken({ requestPermission: true });
        if (token) {
          succeed(token);
          return;
        }
        await readStatus();
      }
      setCheckFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  let title;
  let lede;
  let body;
  if (needsInstall) {
    title = 'Install My Naai to get alerts';
    lede = 'On iPhone, web notifications only work after My Naai is on your Home Screen. It takes about 20 seconds:';
    body = (
      <>
        <ol className="ios-install-steps permission-gate-steps">
          <li>In Safari, tap the <strong>Share</strong> button (the square with an arrow).</li>
          <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
          <li>Open My Naai from your Home Screen and tap <strong>Turn on</strong>.</li>
        </ol>
        <div className="permission-gate-actions">
          <Button onClick={check} loading={busy}><Check size={16} /> I installed it — Check</Button>
          <div className="permission-gate-secondary">
            <button className="ghost" onClick={onClose}>Not now</button>
            <a className="ghost" href="tel:8380017393">Need help? Call</a>
          </div>
        </div>
      </>
    );
  } else if (state === 'denied') {
    title = 'Notifications are blocked';
    lede = `A browser only asks once, so blocked notifications are switched back on in ${browserLabel} settings. It takes about 15 seconds:`;
    body = (
      <>
        <ol className="ios-install-steps permission-gate-steps">
          {permissionSteps(browser, 'notifications').map(step => <li key={step}>{step}</li>)}
        </ol>
        {checkFailed && <p className="permission-gate-warn">Still blocked. Make sure the site in the address bar is exactly <strong>{siteHost()}</strong> — not a different spelling — and that the steps changed <strong>Notifications</strong>, not Location. Some browsers only see the change after a reload, so tap Reload page and try once more.{androidAppNotificationHint(browser)}</p>}
        <div className="permission-gate-actions">
          <Button onClick={check} loading={busy}><Check size={16} /> I allowed it — Check</Button>
          <div className="permission-gate-secondary">
            <button className="ghost" onClick={() => window.location.reload()}><RotateCw size={14} /> Reload page</button>
            <button className="ghost" onClick={onClose}>Not now</button>
            <a className="ghost" href="tel:8380017393">Need help? Call</a>
          </div>
        </div>
      </>
    );
  } else if (state === 'needs-permission') {
    title = 'Enable booking alerts to sign in';
    lede = PUSH_REQUIRED_MESSAGE;
    body = (
      <>
        <div className="permission-gate-benefits">
          <span><BellRing size={14} /> Booking requests and confirmations reach you instantly — even in background</span>
          <span><Volume2 size={14} /> Buzzer sound + vibration for time-critical alerts</span>
          <span><ShieldCheck size={14} /> Your browser will ask — choose Allow and you are in</span>
        </div>
        <div className="permission-gate-actions">
          <Button onClick={allow} loading={busy}><Bell size={16} /> Allow notifications</Button>
          <div className="permission-gate-secondary">
            <button className="ghost" onClick={onClose}>Not now</button>
          </div>
        </div>
      </>
    );
  } else {
    title = 'Notifications need a second try';
    lede = state === 'unconfigured'
      ? 'This build of My Naai is not set up for web alerts yet. You can still browse; call 8380017393 if you need booking alerts on this device.'
      : 'Setup did not finish on this device — first visits sometimes need one more try.';
    body = (
      <div className="permission-gate-actions">
        <Button onClick={allow} loading={busy}><RefreshCw size={16} /> Try again</Button>
        <div className="permission-gate-secondary">
          <button className="ghost" onClick={onClose}>Not now</button>
          <a className="ghost" href="tel:8380017393">Need help? Call</a>
        </div>
      </div>
    );
  }

  return (
    <div className="permission-gate-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="permission-gate-sheet" role="dialog" aria-modal="true" aria-label="Enable notifications">
        <span className="permission-gate-grip" />
        <div className="permission-gate-icon">
          {needsInstall ? <Smartphone size={26} /> : state === 'denied' ? <Settings size={26} /> : <BellRing size={26} />}
        </div>
        <span className="permission-gate-browser"><Bell size={12} /> {browserLabel}</span>
        <h2 style={{ marginTop: '12px' }}>{title}</h2>
        <p className="permission-gate-lede">{lede}</p>
        {body}
        <p className="permission-gate-note">
          Having trouble? Call <a href="tel:8380017393">8380017393</a> — we will help you enable notifications on {browserLabel}.
        </p>
      </div>
    </div>
  );
}

// The backend requires deviceToken on login and registration. Ask for
// notification permission on splash and login, with a clear Enable control,
// and do not continue until a token exists. Location stays optional.
function NotificationSetupCard({ compact = false, prominent = false, notifyInstall = null, onEnabled }) {
  const [status, setStatus] = useState('checking');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const onEnabledRef = useRef(onEnabled);
  onEnabledRef.current = onEnabled;

  const inspect = useCallback(async (requestPermission = false) => {
    if (requestPermission) {
      try {
        const token = await getPushToken({ requestPermission: true });
        if (token) {
          setStatus('enabled');
          setReason('');
          setRetryAttempts(0);
          onEnabledRef.current?.(token);
          return;
        }
      } catch (inspectError) {
        console.debug(getErrorMessage(inspectError, 'Notification status check failed.'));
      }
    }
    try {
      const result = await getPushStatus();
      setStatus(result.state);
      setReason(result.reason || '');
      if (result.state === 'enabled' && result.token) {
        onEnabledRef.current?.(result.token);
        setRetryAttempts(0);
      } else if (result.state === 'unavailable') {
        setRetryAttempts(c => c + 1);
      }
    } catch (statusError) {
      console.debug(getErrorMessage(statusError, 'Could not check notification status.'));
      setStatus('unavailable');
      setReason('We could not check notification status. Please try again.');
      setRetryAttempts(c => c + 1);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getPushStatus()
      .then(result => {
        if (!active) return;
        setStatus(result.state);
        setReason(result.reason || '');
        if (result.state === 'enabled' && result.token) onEnabledRef.current?.(result.token);
      })
      .catch(error => {
        if (!active) return;
        console.debug(getErrorMessage(error, 'Could not check notification status.'));
        setStatus('unavailable');
        setReason('We could not check notification status. Please try again.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const recheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      inspect(false);
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [inspect]);

  // Follow the live permission: the card updates itself the moment the user
  // flips the setting in the browser's own UI, no Check tap needed.
  useEffect(() => watchNotificationPermission(() => { inspect(false); }), [inspect]);

  const enable = async () => {
    setBusy(true);
    try { await inspect(true); } finally { setBusy(false); }
  };

  const tryAgain = async () => {
    setBusy(true);
    try { await inspect(false); } finally { setBusy(false); }
  };

  if (['checking', 'enabled'].includes(status)) return null;
  const needsIosInstall = status === 'unsupported' && isIosDevice() && !isIosPwaInstalled();
  const copy = {
    unconfigured: { title: 'Notifications are unavailable', body: reason || 'This build of My Naai is not set up for web alerts yet. You can still browse; call 8380017393 if you need booking alerts on this device.' },
    unsupported: { title: 'Notifications need a different setup', body: reason || 'This browser cannot deliver web notifications. Install My Naai to your home screen, or use Chrome, Edge or Samsung Internet.' },
    denied: { title: 'Notifications are blocked', body: 'My Naai sends booking requests, confirmations and delay alerts. Your browser has blocked them for this site — tap How to allow, then Check again. If Check keeps saying blocked, tap Reload once.' },
    'needs-permission': { title: 'Turn on booking alerts', body: 'Tap Allow so My Naai can send booking requests, confirmations and delay alerts. Your salon\u2019s buzzer needs this to reach you in background too.' },
    unavailable: { title: retryAttempts > 1 ? 'Still setting up — try again' : 'Notifications are not ready yet', body: reason || (retryAttempts > 1 ? 'First-time setup sometimes needs a second try. Tap Try again — it usually works.' : 'We could not finish setting up notifications on this device. Tap Try again — if it keeps failing, tap Show me how.') },
  }[status] || { title: 'Turn on booking alerts', body: reason };
  const blocked = status === 'denied';
  const isUnavailable = status === 'unavailable';
  return (
    <section className={cx('push-setup-card', compact && 'push-setup-compact', prominent && 'push-setup-prominent', status === 'unavailable' && 'push-setup-retry')} aria-live="polite">
      <span className="push-setup-icon"><Bell size={compact ? 15 : 18} /></span>
      <div className="push-setup-copy"><strong>{copy.title}</strong><p>{copy.body}</p></div>
      <div className="push-setup-actions">
        {status === 'unsupported' && notifyInstall && <Button size="small" onClick={notifyInstall}><Download size={14} /> Install app</Button>}
        {needsIosInstall
          ? <>
            <Button size="small" onClick={() => setIosHelpOpen(true)}>How to install</Button>
            <button type="button" className="permission-help-link" onClick={tryAgain}>I installed — Check</button>
          </>
          : blocked
            ? <>
            <Button size="small" onClick={tryAgain} loading={busy}><Check size={13} /> Check again</Button>
            <button type="button" className="permission-help-link" onClick={() => setIosHelpOpen(true)}>How to allow</button>
            <button type="button" className="permission-help-link" onClick={() => window.location.reload()}>Reload</button>
          </>
            : isUnavailable
              ? <>
                <Button size="small" onClick={tryAgain} loading={busy}>Try again</Button>
                <button type="button" className="permission-help-link" onClick={() => setIosHelpOpen(true)}>Need help?</button>
              </>
              : <>
              <Button size="small" onClick={enable} loading={busy}>{status === 'unavailable' ? 'Try again' : 'Allow'}</Button>
              <button type="button" className="permission-help-link" onClick={() => setIosHelpOpen(true)}>Need help?</button>
            </>}
      </div>
      {needsIosInstall
        ? <IosInstallHelp open={iosHelpOpen} onClose={() => { setIosHelpOpen(false); inspect(false); }} />
        : <PermissionHelp open={iosHelpOpen} kind="notifications" onClose={() => { setIosHelpOpen(false); inspect(false); }} />}
    </section>
  );
}

function IosInstallHelp({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Enable notifications on iPhone" footer={<Button onClick={onClose}>Got it</Button>}>
      <p className="modal-lede">iPhone only allows web notifications after My Naai is added to your Home Screen. It takes a few seconds:</p>
      <ol className="ios-install-steps">
        <li>In Safari, tap the <strong>Share</strong> button (the square with an arrow) at the bottom of the screen.</li>
        <li>Scroll the menu and choose <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong>, then open <strong>My Naai</strong> from your Home Screen.</li>
        <li>Tap <strong>Enable</strong> and choose <strong>Allow</strong> when asked, then log in.</li>
      </ol>
      <p className="permission-help-note">Once installed, notifications and buzzer work in background just like the mobile app — on Safari and Chrome on iOS (when opened from Home Screen).</p>
    </Modal>
  );
}

function LocationSetupCard({ compact = false, onLocated, onDismiss }) {
  const [status, setStatus] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const inspect = useCallback(async () => {
    setStatus(await queryLocationPermission());
  }, []);

  useEffect(() => { inspect(); }, [inspect]);

  const enable = async () => {
    setBusy(true);
    try {
      const current = await getBrowserLocation();
      if (current) {
        setStatus('granted');
        onLocated?.(current);
        return;
      }
      setStatus(await queryLocationPermission() === 'denied' ? 'denied' : 'prompt');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'checking' || status === 'granted') return null;

  const copy = status === 'unsupported'
    ? { title: 'Location is unavailable', body: 'This browser cannot share your location. Nearby salons are still listed — just without the distance.' }
    : status === 'denied'
      ? { title: 'Location is off — that is fine', body: 'Optional. Salons are still listed, only without distances. To sort by nearest, allow location in your browser settings.' }
      : { title: 'Show nearby salons first?', body: 'Optional. Share your location and My Naai sorts salons by how close they are. You can skip this and still book.' };

  return (
    <section className={cx('push-setup-card', compact && 'push-setup-compact', 'push-setup-optional')} aria-live="polite">
      <span className="push-setup-icon"><MapPin size={compact ? 15 : 18} /></span>
      <div className="push-setup-copy"><strong>{copy.title}</strong><p>{copy.body}</p></div>
      <div className="push-setup-actions">
        {status === 'denied'
          ? <>
            <Button size="small" variant="secondary" onClick={inspect} loading={busy}><Check size={13} /> Check again</Button>
            <button type="button" className="permission-help-link" onClick={() => setHelpOpen(true)}>How to allow</button>
          </>
          : status !== 'unsupported' && <Button size="small" onClick={enable} loading={busy}>Allow</Button>}
        {onDismiss && <button type="button" className="permission-help-link" onClick={onDismiss}>Not now</button>}
      </div>
      <PermissionHelp open={helpOpen} kind="location" onClose={() => { setHelpOpen(false); inspect(); }} />
    </section>
  );
}


function PWAInstallCard({ compact = false, notifyInstall = null }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('mynaaiPWAInstallDismissed') === 'true'; } catch { return false; }
  });
  const [isStandalone, setIsStandalone] = useState(false);
  const [hasPrompt, setHasPrompt] = useState(() => Boolean(typeof window !== 'undefined' && window.deferredPWAInstallPrompt));

  useEffect(() => {
    const checkStandalone = () => {
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
      setIsStandalone(Boolean(standalone));
    };
    checkStandalone();
    const onAvailable = () => setHasPrompt(true);
    const onInstalled = () => { setHasPrompt(false); setIsStandalone(true); };
    window.addEventListener('pwa-install-available', onAvailable);
    window.addEventListener('pwa-installed', onInstalled);
    window.addEventListener('appinstalled', onInstalled);
    // Also check deferred prompt periodically for 5 seconds (in case it fires early)
    let checks = 0;
    const interval = setInterval(() => {
      if (window.deferredPWAInstallPrompt) setHasPrompt(true);
      checks++;
      if (checks > 10) clearInterval(interval);
    }, 500);
    return () => {
      clearInterval(interval);
      window.removeEventListener('pwa-install-available', onAvailable);
      window.removeEventListener('pwa-installed', onInstalled);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (isStandalone || dismissed) return null;
  // Only show if we have install prompt or on iOS where prompt doesn't exist
  const isIos = isIosDevice();
  const showForIos = isIos && !isIosPwaInstalled();
  if (!hasPrompt && !showForIos) return null;

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem('mynaaiPWAInstallDismissed', 'true'); } catch {}
  };

  return (
    <section className={cx('push-setup-card', compact && 'push-setup-compact', 'push-setup-pwa')} aria-live="polite">
      <span className="push-setup-icon"><Download size={compact ? 15 : 18} /></span>
      <div className="push-setup-copy">
        <strong>{isIos ? 'Install My Naai to your Home Screen' : 'Install My Naai app'}</strong>
        <p>{isIos ? 'Required for notifications with buzzer when app is closed. Tap Share → Add to Home Screen.' : 'Get booking alerts with buzzer even when app is not in recent. Works offline too.'}</p>
      </div>
      <div className="push-setup-actions">
        {notifyInstall ? <Button size="small" onClick={notifyInstall}><Download size={14} /> Install</Button> : <Button size="small" variant="secondary" onClick={() => { if (isIos) { /* iOS has no programmatic install */ } }}><Smartphone size={14} /> {isIos ? 'How to install' : 'Install'}</Button>}
        <button type="button" className="permission-help-link" onClick={dismiss}>Not now</button>
      </div>
    </section>
  );
}


// The single permission card on the login screen — replaces the old
// three-card stack. One row per thing, one tap per browser popup:
//   · notifications → the browser's own Allow popup (required to sign in)
//   · location      → the browser's own Allow popup (optional)
//   · buzzer        → plays the real booking buzz so the user can hear it
// A blocked permission cannot be re-asked by a browser, so instead of another
// modal the fix is inline: exact steps for the detected browser plus a one-tap
// "I allowed — Check" that re-reads the real permission. The card also
// re-checks itself whenever the tab regains focus, so fixing the setting in
// the browser and coming back updates it without any tap at all. When
// notifications are on and location is settled, the card removes itself and
// the login form is all that is left.
function LoginPermissionsPanel({ onPushToken, onLocated }) {
  const [notif, setNotif] = useState({ state: 'checking', token: '' });
  const [loc, setLoc] = useState('checking');
  const [locDismissed, setLocDismissed] = useState(() => {
    try { return sessionStorage.getItem('mynaaiLocationPromptDismissed') === 'true'; } catch { return false; }
  });
  const [busy, setBusy] = useState({ notif: false, loc: false, check: false });
  const [soundTested, setSoundTested] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [locHelpOpen, setLocHelpOpen] = useState(false);
  const onPushTokenRef = useRef(onPushToken);
  onPushTokenRef.current = onPushToken;
  const onLocatedRef = useRef(onLocated);
  onLocatedRef.current = onLocated;

  const applyPushStatus = useCallback(result => {
    setNotif({ state: result.state, token: result.token || '' });
    if (result.state === 'enabled' && result.token) onPushTokenRef.current?.(result.token);
    return result.state === 'enabled' && Boolean(result.token);
  }, []);

  const refreshNotif = useCallback(async ({ requestPermission = false } = {}) => {
    if (requestPermission) {
      try {
        const token = await getPushToken({ requestPermission: true });
        if (token) {
          setNotif({ state: 'enabled', token });
          onPushTokenRef.current?.(token);
          return true;
        }
      } catch (askError) {
        console.debug(getErrorMessage(askError, 'Notification permission request failed.'));
      }
    }
    try {
      return applyPushStatus(await getPushStatus());
    } catch (statusError) {
      console.debug(getErrorMessage(statusError, 'Could not check notification status.'));
      setNotif({ state: 'unavailable', token: '' });
      return false;
    }
  }, [applyPushStatus]);

  const refreshLoc = useCallback(() => {
    queryLocationPermission().then(setLoc).catch(() => setLoc('unsupported'));
  }, []);

  useEffect(() => {
    let active = true;
    getPushStatus()
      .then(result => { if (active) applyPushStatus(result); })
      .catch(() => { if (active) setNotif({ state: 'unavailable', token: '' }); });
    refreshLoc();
    return () => { active = false; };
  }, [applyPushStatus, refreshLoc]);

  // The user leaves to change a setting in the browser and comes back: pick the
  // new state up automatically instead of waiting for a tap.
  useEffect(() => {
    const recheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      getPushStatus().then(result => { if (applyPushStatus(result)) setCheckFailed(false); }).catch(() => {});
      refreshLoc();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [applyPushStatus, refreshLoc]);

  // The browser's Permissions API fires the instant the user flips the
  // notification setting in its own UI — refresh the row right away, before the
  // tab even regains focus. This is what makes "I allowed it" reflect without a
  // Check tap on browsers that report the change live.
  useEffect(() => watchNotificationPermission(() => {
    refreshNotif().then(enabled => { if (enabled) setCheckFailed(false); }).catch(() => {});
  }), [refreshNotif]);

  const enableNotifs = async () => {
    setBusy(current => ({ ...current, notif: true }));
    try { setCheckFailed(!(await refreshNotif({ requestPermission: true }))); } finally { setBusy(current => ({ ...current, notif: false })); }
  };
  const enableLoc = async () => {
    setBusy(current => ({ ...current, loc: true }));
    try {
      const current = await getBrowserLocation();
      if (current) {
        setLoc('granted');
        onLocatedRef.current?.(current);
        return;
      }
      setLoc((await queryLocationPermission()) === 'denied' ? 'denied' : 'prompt');
    } finally { setBusy(current => ({ ...current, loc: false })); }
  };
  const checkNotif = async () => {
    setBusy(current => ({ ...current, check: true }));
    try { setCheckFailed(!(await refreshNotif())); } finally { setBusy(current => ({ ...current, check: false })); }
  };
  const checkLoc = () => refreshLoc();
  const dismissLoc = () => {
    setLocDismissed(true);
    try { sessionStorage.setItem('mynaaiLocationPromptDismissed', 'true'); } catch { /* private mode: skip this session only */ }
  };
  const testBuzz = () => {
    unlockBuzzer();
    playBuzzer({ type: 'BOOKING_REQUEST', repeats: 1 });
    setSoundTested(true);
  };

  const browser = detectBrowser();
  const browserLabel = BROWSER_LABELS[browser] || BROWSER_LABELS.other;
  const needsInstall = isIosDevice() && !isIosPwaInstalled();
  const notifDone = notif.state === 'enabled';
  const showLoc = !locDismissed && (loc === 'prompt' || loc === 'denied');
  if (notifDone && !showLoc) return null;

  const notifCopy = {
    checking: 'Checking this browser…',
    enabled: 'Booking requests, confirmations and the salon buzzer will reach you here.',
    'needs-permission': 'One tap opens your browser\u2019s Allow popup — choose Allow.',
    denied: `Blocked in ${browserLabel}. Tap Allow notifications — if nothing pops up, open How to allow.`,
    unavailable: 'Setup did not finish — a first visit sometimes needs a second try.',
    unsupported: needsInstall
      ? 'iPhone shows notifications only for apps on the Home Screen. Install My Naai first — it takes 20 seconds.'
      : 'This browser cannot show web notifications. Use Chrome, Edge or Samsung Internet.',
    unconfigured: 'Notifications are not set up for this build yet. Call 8380017393 for booking alerts on this device.',
  }[notif.state] || 'Turn on booking alerts so requests and confirmations reach you.';

  // The unblock steps stay collapsed behind "How to allow" so the card reads
  // like a clean permission ask. They open on demand, and by themselves after
  // a failed Allow/Check — the moment they are actually needed. The iPhone
  // install steps are the only path forward there, so those stay open.
  const showNotifFix = !notifDone && (notif.state === 'denied' || needsInstall);
  const fixOpen = Boolean(showNotifFix && (needsInstall || showSteps || (checkFailed && notif.state === 'denied')));

  let notifAction;
  if (notif.state === 'checking') notifAction = <Spinner size={15} />;
  else if (notifDone) notifAction = <span className="perm-chip perm-chip-on"><Check size={12} /> On</span>;
  else if (needsInstall) notifAction = <span className="perm-chip perm-chip-warn">Install first</span>;
  else if (notif.state === 'needs-permission' || notif.state === 'denied') notifAction = (
    <>
      <Button size="small" onClick={enableNotifs} loading={busy.notif}><Bell size={13} /> Allow notifications</Button>
      {notif.state === 'denied' && (
        <button type="button" className="ghost-link" onClick={() => setShowSteps(value => !value)}>{fixOpen ? 'Hide steps' : 'How to allow'}</button>
      )}
    </>
  );
  else if (notif.state === 'unavailable') notifAction = <Button size="small" variant="secondary" onClick={enableNotifs} loading={busy.notif}>Try again</Button>;
  else notifAction = <span className="perm-chip perm-chip-mute">{notif.state === 'unconfigured' ? 'Not set up' : 'Not supported'}</span>;

  return (
    <section className={cx('perm-panel', !notifDone && 'perm-panel-attention')} aria-live="polite">
      <div className="perm-panel-head">
        <BellRing size={15} />
        <strong>{notifDone ? 'Booking alerts are on' : 'One-time setup · about 20 seconds'}</strong>
        <span className="perm-panel-hint">{notifDone ? 'You are all set' : 'Notifications are required to sign in'}</span>
      </div>

      {!notifDone && (
        <div className={cx('perm-row', notif.state === 'denied' && 'perm-row-attention')}>
          <span className="perm-ico"><Bell size={15} /></span>
          <div className="perm-copy">
            <strong>Booking notifications <em className="perm-tag">Required</em></strong>
            <p>{notifCopy}</p>
          </div>
          <div className="perm-actions">{notifAction}</div>
        </div>
      )}

      {showNotifFix && fixOpen && (
        <div className="perm-fix" role="note">
          {needsInstall ? (
            <>
              <span className="perm-fix-label">How to install on iPhone (20 seconds):</span>
              <ol className="ios-install-steps">
                <li>Tap the <strong>Share</strong> button (the square with an arrow) at the bottom.</li>
                <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
                <li>Open My Naai from the Home Screen and tap <strong>Allow notifications</strong>.</li>
              </ol>
              {checkFailed && <p className="permission-gate-warn">Not detected yet. Make sure you opened My Naai from the Home Screen icon — not from Safari — then tap Check again.</p>}
              <div className="perm-fix-actions">
                <Button size="small" onClick={() => setIosHelpOpen(true)}><Smartphone size={13} /> Show me how</Button>
                <Button size="small" variant="secondary" onClick={checkNotif} loading={busy.check}><Check size={13} /> I installed — Check</Button>
              </div>
            </>
          ) : (
            <>
              <span className="perm-fix-label">How to unblock notifications in {browserLabel}:</span>
              <ol className="ios-install-steps">
                {permissionSteps(browser, 'notifications').map(step => <li key={step}>{step}</li>)}
              </ol>
              {checkFailed && (
                <p className="permission-gate-warn">
                  Still blocked. The address bar must say exactly <strong>{siteHost()}</strong> — not a different spelling — and the steps must set <strong>Notifications</strong> to Allow, not Location. After changing it, tap <strong>Reload page</strong> once: some browsers only pick the new setting up on a fresh load.{androidAppNotificationHint(browser)}{isEmbeddedFrame() ? ` This page looks open inside another app or preview — open ${siteHost()} in its own browser tab and allow notifications there; browsers do not show the permission prompt inside embedded pages.` : ''}
                </p>
              )}
              <div className="perm-fix-actions">
                <Button size="small" onClick={checkNotif} loading={busy.check}><Check size={13} /> I allowed — Check</Button>
                <button type="button" className="ghost-link" onClick={() => window.location.reload()}>Reload page</button>
                <a href="tel:8380017393">Need help? Call us</a>
              </div>
            </>
          )}
        </div>
      )}

      {showLoc && (
        <div className="perm-row perm-row-optional">
          <span className="perm-ico"><MapPin size={15} /></span>
          <div className="perm-copy">
            <strong>Nearby salons <em className="perm-tag perm-tag-optional">Optional</em></strong>
            <p>{loc === 'denied' ? 'Blocked — salons still show, just without distance.' : 'Share your location and salons sort by distance.'}</p>
          </div>
          <div className="perm-actions">
            {loc === 'prompt' && <Button size="small" variant="secondary" onClick={enableLoc} loading={busy.loc}><MapPin size={13} /> Allow</Button>}
            {loc === 'denied' && (
              <>
                <Button size="small" variant="secondary" onClick={() => setLocHelpOpen(true)}>How to allow</Button>
                <button type="button" className="ghost-link" onClick={checkLoc}>Check again</button>
              </>
            )}
            <button type="button" className="ghost-link" onClick={dismissLoc}>Skip</button>
          </div>
        </div>
      )}

      <div className="perm-row perm-row-sound">
        <span className="perm-ico"><Volume2 size={15} /></span>
        <div className="perm-copy">
          <strong>Buzzer sound + vibration</strong>
          <p>{soundTested ? 'The booking buzz works on this device.' : 'Hear the booking buzz now — it plays and vibrates once.'}</p>
        </div>
        <div className="perm-actions">
          {soundTested
            ? <span className="perm-chip perm-chip-on"><Check size={12} /> Works</span>
            : <Button size="small" variant="secondary" onClick={testBuzz}><Volume2 size={13} /> Test buzz</Button>}
        </div>
      </div>

      <IosInstallHelp open={iosHelpOpen} onClose={() => { setIosHelpOpen(false); checkNotif(); }} />
      <PermissionHelp open={locHelpOpen} kind="location" onClose={() => { setLocHelpOpen(false); refreshLoc(); }} />
    </section>
  );
}


function PermissionsPrompt({ compact = false, prominent = false, notifyInstall = null, onPushToken, onLocated }) {
  const [locationDismissed, setLocationDismissed] = useState(() => {
    try { return sessionStorage.getItem('mynaaiLocationPromptDismissed') === 'true'; } catch { return false; }
  });
  const dismissLocation = () => {
    setLocationDismissed(true);
    try { sessionStorage.setItem('mynaaiLocationPromptDismissed', 'true'); } catch { /* private mode: dismiss for this render only */ }
  };
  return (
    <div className={cx('permission-prompt-stack', compact && 'permission-prompt-compact')}>
      <PWAInstallCard compact={compact} notifyInstall={notifyInstall} />
      <NotificationSetupCard compact={compact} prominent={prominent} notifyInstall={notifyInstall} onEnabled={onPushToken} />
      {!locationDismissed && <LocationSetupCard compact={compact} onLocated={onLocated} onDismiss={dismissLocation} />}
    </div>
  );
}


// The provider sits above the auth flow *and* the signed-in shell: logout is
// confirmed from both, and no screen may fall back to a blocking browser dialog.
export default function App() {
  return (
    <ConfirmProvider>
      <AppRoot />
    </ConfirmProvider>
  );
}

function AppRoot() {
  const [session, setSession] = useState(readStoredSession);
  const [route, setRoute] = useState(() => getRouteFromHash(session?.role));
  const [installPrompt, setInstallPrompt] = useState(() => {
    // Check if prompt was already captured in index.html
    if (typeof window !== 'undefined' && window.deferredPWAInstallPrompt) {
      return window.deferredPWAInstallPrompt;
    }
    return null;
  });
  useEffect(() => {
    const onBeforeInstall = event => { event.preventDefault(); setInstallPrompt(event); window.deferredPWAInstallPrompt = event; };
    const onPwaAvailable = () => {
      if (window.deferredPWAInstallPrompt) setInstallPrompt(window.deferredPWAInstallPrompt);
    };
    const onPwaInstalled = () => setInstallPrompt(null);
    // Check for existing prompt on mount (in case it fired before React)
    if (window.deferredPWAInstallPrompt) setInstallPrompt(window.deferredPWAInstallPrompt);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('pwa-install-available', onPwaAvailable);
    window.addEventListener('pwa-installed', onPwaInstalled);
    window.addEventListener('appinstalled', onPwaInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('pwa-install-available', onPwaAvailable);
      window.removeEventListener('pwa-installed', onPwaInstalled);
      window.removeEventListener('appinstalled', onPwaInstalled);
    };
  }, []);
  // Unlock the Web Audio buzzer on the first user gesture so a later booking
  // buzz can actually make a sound (browsers block audio until an interaction).
  useEffect(() => {
    const unlock = () => unlockBuzzer();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  const completeAuth = useCallback(async nextSession => {
    let resolvedSession = nextSession;
    // Some salon login responses expose isNewSalon while others only expose
    // profileCompleted on the profile endpoint. Check both so an incomplete
    // partner can never briefly land on the normal queue dashboard.
    const role = String(nextSession?.role).toUpperCase();
    const alreadyIncomplete = flagIsTrue(nextSession?.isNewSalon) || flagIsFalse(nextSession?.user?.profileCompleted) || flagIsFalse(nextSession?.user?.salon?.profileCompleted);
    if (role === 'SALON' && alreadyIncomplete) {
      resolvedSession = { ...nextSession, isNewSalon: true };
    } else if (role === 'SALON' && nextSession.userId) {
      if (nextSession.token) setToken(nextSession.token);
      try {
        const response = await api.salonProfile({ salonId: nextSession.userId });
        const profileData = response?.data?.salon || response?.data || {};
        const fetchedProfile = {
          ...profileData,
          ...(profileData.profileCompleted === undefined && response?.profileCompleted !== undefined ? { profileCompleted: response.profileCompleted } : {}),
          ...(profileData.isNewSalon === undefined && response?.isNewSalon !== undefined ? { isNewSalon: response.isNewSalon } : {}),
        };
        const planState = getSubscriptionState(fetchedProfile);
        const profilePatch = {
          ...(nextSession.user || {}),
          ...fetchedProfile,
          ...(planState.expired ? { subscriptionExpired: true } : {}),
        };
        resolvedSession = {
          ...nextSession,
          user: profilePatch,
          ...(planState.expired ? { subscriptionExpired: true } : {}),
          ...(salonNeedsProfileCompletion(fetchedProfile) ? { isNewSalon: true } : {}),
        };
      } catch (profileError) {
        console.debug(getErrorMessage(profileError, 'Could not preflight salon profile completion.'));
        // A plan-expired response is authoritative even when the profile call
        // is rejected. Preserve the existing safe onboarding fallback for any
        // other profile error so an incomplete salon cannot reach the dashboard.
        resolvedSession = isPlanExpiredResponse(profileError)
          ? { ...nextSession, subscriptionExpired: true, user: { ...(nextSession.user || {}), subscriptionExpired: true } }
          : { ...nextSession, isNewSalon: true };
      }
    }
    const stored = saveSession(resolvedSession);
    setSession(stored);
    const needsSalonProfile = stored.role === 'SALON' && stored.isNewSalon;
    const nextRoute = needsSalonProfile ? 'editProfile' : stored.role === 'SALON' ? 'queue' : 'home';
    const nextParams = needsSalonProfile ? { isOnboarding: 'true' } : {};
    setRoute({ name: nextRoute, params: nextParams });
    const query = new URLSearchParams(nextParams).toString();
    window.history.replaceState({}, '', `#/${nextRoute}${query ? `?${query}` : ''}`);
  }, []);
  const logout = useCallback(() => { clearSession(); resetLiveUpdatesSocket(); setSession(null); setRoute({ name: 'home', params: {} }); window.history.replaceState({}, '', '#/'); }, []);
  const updateSessionUser = useCallback((user, sessionPatch = {}) => setSession(current => {
    if (!current) return current;
    const nextUser = { ...current.user, ...user };
    localStorage.setItem('mynaaiUser', JSON.stringify(nextUser));
    if (Object.prototype.hasOwnProperty.call(sessionPatch, 'isNewSalon')) {
      localStorage.setItem('isNewSalon', sessionPatch.isNewSalon ? 'true' : 'false');
    }
    return { ...current, ...sessionPatch, user: nextUser };
  }), []);
  useEffect(() => {
    const onRouteChange = () => setRoute(getRouteFromHash(session?.role));
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);
    return () => {
      window.removeEventListener('popstate', onRouteChange);
      window.removeEventListener('hashchange', onRouteChange);
    };
  }, [session?.role]);
  useEffect(() => {
    if (session?.role !== 'SALON' || !session.isNewSalon || route.name === 'editProfile') return;
    const next = { name: 'editProfile', params: { isOnboarding: 'true' } };
    setRoute(next);
    window.history.replaceState({}, '', '#/editProfile?isOnboarding=true');
  }, [route.name, session?.isNewSalon, session?.role]);
  const navigate = useCallback((screen, params = {}, options = {}) => {
    if (screen === -1) { window.history.back(); return; }
    const next = typeof screen === 'object' ? screen : { name: screen, params };
    setRoute(next);
    const serializableParams = Object.fromEntries(Object.entries(next.params || {}).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object'));
    const query = new URLSearchParams(serializableParams).toString();
    const hash = `#/${next.name}${query ? `?${query}` : ''}`;
    if (options.replace) window.history.replaceState({}, '', hash); else window.history.pushState({}, '', hash);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  useEffect(() => {
    const onStorage = event => {
      if (['mynaai', 'mynaaiUser', 'userType', 'isLoggedIn', 'isNewSalon'].includes(event.key)) {
        const next = readStoredSession();
        setSession(next);
        if (next) setRoute(getRouteFromHash(next.role));
      }
    };
    const onSessionExpired = () => { deletePushToken().catch(error => console.debug(getErrorMessage(error, 'Could not clear the browser notification token.'))); resetLiveUpdatesSocket(); setSession(null); setRoute({ name: 'home', params: {} }); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('mynaai:session-expired', onSessionExpired);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mynaai:session-expired', onSessionExpired);
    };
  }, []);
  const install = async () => {
    const promptEvent = installPrompt;
    if (!promptEvent) return;
    try {
      promptEvent.prompt();
      await promptEvent.userChoice;
    } catch (installError) {
      console.debug(getErrorMessage(installError, 'Could not open the install prompt.'));
    } finally {
      setInstallPrompt(null);
    }
  };
  if (!session) return <AuthFlow onComplete={completeAuth} notifyInstall={installPrompt ? install : null} />;
  return <AppShell session={session} route={route} navigate={navigate} onLogout={logout} onSessionUpdate={updateSessionUser} notifyInstall={installPrompt ? install : null} />;
}

function AuthFlow({ onComplete, notifyInstall }) {
  const [view, setView] = useState(() => localStorage.getItem('hasSeenOnboarding') === 'true' ? 'login' : 'onboarding');
  const [slide, setSlide] = useState(0);
  const [role, setRole] = useState('USER');
  const [salonAuthMode, setSalonAuthMode] = useState('login');
  const [salonRegistrationData, setSalonRegistrationData] = useState(null);
  const [step, setStep] = useState('phone');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [pushToken, setPushToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [permissionGate, setPermissionGate] = useState({ open: false, state: 'needs-permission' });
  const askedBrowserPermissions = useRef(false);

  const askBrowserPermissions = useCallback(async () => {
    if (askedBrowserPermissions.current) return;
    askedBrowserPermissions.current = true;
    const token = await promptBrowserPermissions();
    if (token) setPushToken(token);
  }, []);

  // The splash AND the login screen both open the browser's own permission
  // popups on the first tap (any tap counts as the user gesture) —
  // notifications first (sign-in depends on them), then location while the tap
  // is still fresh. A returning customer who lands straight on the login page —
  // from Google, a bookmark or a notification — gets the exact same one-tap
  // permission flow as the splash, instead of a card that only describes it.
  // `askedBrowserPermissions` keeps it to one ask per visit.
  useEffect(() => {
    if (view !== 'onboarding' && view !== 'login') return undefined;
    const onGesture = () => { askBrowserPermissions(); };
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [askBrowserPermissions, view]);

  const onboarding = [
    { image: '/assets/naai/naai3.jpg', kicker: 'THE PROFESSIONAL SPECIALISTS', title: 'Your next good look is closer than you think.', text: 'Find trusted barbers and salons around your location.' },
    { image: '/assets/naai/naai2.jpeg', kicker: 'A LITTLE MORE YOU', title: 'Book the service. Skip the waiting room.', text: 'Haircut, beard, spa and more — choose a time that works for you.' },
    { image: '/assets/naai/naai1.jpg', kicker: 'MADE FOR YOUR TIME', title: 'Good style, without the guesswork.', text: 'See availability, pick your specialist and arrive ready.' }
  ];

  const finishOnboarding = async () => {
    localStorage.setItem('hasSeenOnboarding', 'true');
    await askBrowserPermissions();
    setView('login');
  };

  const requirePushTokenWithGate = useCallback(async () => {
    // 1) A token from the setup card or an earlier step — nothing to ask.
    if (pushToken) return pushToken;
    try {
      const token = await getPushToken({ requestPermission: false });
      if (token) {
        setPushToken(token);
        return token;
      }
    } catch (tokenError) {
      console.debug(getErrorMessage(tokenError, 'Could not check the browser notification token.'));
    }
    // 2) The browser has never been asked → ask it directly, right now. The
    //    tap that submitted the form is the user gesture, so the browser's own
    //    popup appears here and signing in continues immediately after Allow.
    //    Regular iPhone Safari is excluded — it has no popup until the app is
    //    on the Home Screen, so it goes to the install gate instead.
    const iosNotInstalled = isIosDevice() && !isIosPwaInstalled();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default' && !iosNotInstalled) {
      try {
        const token = await getPushToken({ requestPermission: true });
        if (token) {
          setPushToken(token);
          return token;
        }
      } catch (askError) {
        console.debug(getErrorMessage(askError, 'Could not ask the browser for notification permission.'));
      }
    }
    // 3) No token and no popup to show → open the gate with the true state so
    //    the user sees the exact fix: blocked → inline steps + Check, iPhone →
    //    install, anything else → Try again.
    let state = 'needs-permission';
    try {
      const status = await getPushStatus();
      state = status.state;
    } catch (statusError) {
      console.debug(getErrorMessage(statusError, 'Could not read the notification status.'));
    }
    const message = state === 'denied' ? PUSH_BLOCKED_MESSAGE : iosNotInstalled ? IOS_PUSH_REQUIRED_MESSAGE : PUSH_REQUIRED_MESSAGE;
    setPermissionGate({ open: true, state });
    throw new Error(message);
  }, [pushToken]);

  const handlePermissionGranted = (token) => {
    if (token) {
      setPushToken(token);
      setError('');
    }
  };

  const requestOtp = async event => {
    event.preventDefault();
    if (!/^\d{10}$/.test(mobile)) return setError('Enter a valid 10-digit mobile number.');
    setBusy(true);
    setError('');
    try {
      const token = await requirePushTokenWithGate();
      setPushToken(token);
      let response;
      let nextSalonAuthMode = 'login';
      if (role === 'USER') {
        response = await api.userLogin({ phoneNumber: mobile });
      } else {
        try {
          response = await api.SalonLogin({ phoneNumber: mobile });
        } catch (loginError) {
          if (!isUnknownSalonResponse(loginError)) throw loginError;
          response = await api.salonOwnerLogin({ phoneNumber: mobile });
          nextSalonAuthMode = 'register';
        }
        if (response?.status !== 'SUCCESS' && isUnknownSalonResponse(response)) {
          response = await api.salonOwnerLogin({ phoneNumber: mobile });
          nextSalonAuthMode = 'register';
        }
      }
      if (response?.status !== 'SUCCESS') throw new Error(response?.message || 'Could not send OTP.');
      setSalonAuthMode(nextSalonAuthMode);
      setStep('otp');
      setOtp('');
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Could not send OTP. Please try again.'));
    } finally { setBusy(false); }
  };

  const verify = async event => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit OTP.');
    setBusy(true); setError('');
    try {
      const deviceToken = pushToken || await requirePushTokenWithGate();
      setPushToken(deviceToken);
      const payload = withDeviceToken({ phoneNumber: mobile, otp }, deviceToken);
      let verifyMode = salonAuthMode;
      let response;
      if (role === 'USER') {
        response = await api.verifyLogin(payload);
      } else if (verifyMode === 'register') {
        response = await api.verifySalonOwnerLogin(payload);
      } else {
        try {
          response = await api.verifySalonLogin(payload);
        } catch (loginError) {
          if (!isUnknownSalonResponse(loginError)) throw loginError;
          response = await api.verifySalonOwnerLogin(payload);
          verifyMode = 'register';
        }
        if (response?.status !== 'SUCCESS' && isUnknownSalonResponse(response)) {
          response = await api.verifySalonOwnerLogin(payload);
          verifyMode = 'register';
        }
      }
      if (response?.status !== 'SUCCESS') throw new Error(response?.message || 'OTP verification failed.');
      if (role === 'USER' && flagIsFalse(response.isUserExist)) { setStep('new-user'); setOtp(''); setError(''); return; }
      const user = response.data || {};
      if (!user.token) throw new Error('No login session was returned. Please request a new OTP.');
      if (role === 'SALON' && verifyMode === 'register') {
        setSalonRegistrationData({ mobile, tempToken: user.token, pushToken: deviceToken });
        setView('register');
        setStep('phone');
        return;
      }
      const userId = user.userId || user.salon?.salonId || user.salonId;
      if (role === 'SALON' && !userId) throw new Error('Salon login completed without a salon ID. Please try again.');
      const isNewSalon = role === 'SALON' && (flagIsTrue(response.isNewSalon) || flagIsTrue(user.isNewSalon) || flagIsFalse(user.profileCompleted) || flagIsFalse(user.salon?.profileCompleted));
      onComplete({ role, token: user.token, user, userId, isNewSalon });
    } catch (verifyError) { setError(getErrorMessage(verifyError, 'That code did not work. Please try again.')); } finally { setBusy(false); }
  };

  const createAccount = async event => {
    event.preventDefault();
    if (!name.trim()) return setError('Tell us your name to finish setting up.');
    setBusy(true); setError('');
    try {
      const deviceToken = pushToken || await requirePushTokenWithGate();
      setPushToken(deviceToken);
      const response = await api.userOnBoard(withDeviceToken({ phoneNumber: mobile, fullName: name.trim() }, deviceToken));
      if (response?.status !== 'SUCCESS') throw new Error(response?.message || 'Could not create account.');
      if (!response.data?.token) throw new Error('Your account was created, but no login session was returned. Please try again.');
      onComplete({ role: 'USER', token: response.data.token, user: response.data, userId: response.data?.userId });
    } catch (createError) { setError(getErrorMessage(createError, 'Could not create your account.')); } finally { setBusy(false); }
  };

  if (view === 'onboarding') return <div className="auth-page onboarding-page"><div className="onboarding-slide" style={{ backgroundImage: `url(${onboarding[slide].image})` }}><div className="auth-image-shade" /><div className="onboarding-top"><Brand light /><div className="onboarding-top-actions">{notifyInstall && <button className="install-auth-button" onClick={notifyInstall}><Download size={14} /> Install app</button>}<button className="skip-button" onClick={finishOnboarding}>Skip</button></div></div><div className="onboarding-copy"><span className="eyebrow">{onboarding[slide].kicker}</span><h1>{onboarding[slide].title}</h1><p>{onboarding[slide].text}</p><PermissionsPrompt compact notifyInstall={notifyInstall} onPushToken={token => { if (token) setPushToken(token); }} /><div className="onboarding-controls"><div className="onboarding-dots">{onboarding.map((item, index) => <button key={item.kicker} className={index === slide ? 'active' : ''} onClick={() => setSlide(index)} aria-label={`Slide ${index + 1}`} />)}</div>{slide === onboarding.length - 1 ? <Button size="large" className="lets-start-button" onClick={finishOnboarding}><Sparkles size={18} /> Let&apos;s Start</Button> : <button className="next-circle" onClick={() => setSlide(current => current + 1)} aria-label="Next"><ChevronRight size={22} /></button>}</div></div></div></div>;

  if (view === 'register') return <SalonRegistration initialData={salonRegistrationData} onBack={() => { setSalonRegistrationData(null); setView('login'); }} onComplete={onComplete} notifyInstall={notifyInstall} />;

  return <div className="auth-page login-page"><div className="auth-visual"><div className="auth-visual-image" /><div className="auth-image-shade" /><div className="auth-visual-content"><Brand light /><div><span className="eyebrow">SALON & GROOMING, REIMAGINED</span><h1>Less waiting.<br /><em>More you.</em></h1><p>Book a great salon nearby and make the time yours.</p></div><div className="visual-quote"><span></span><p>Your time is valuable. We’re here to give it back.</p></div></div></div><div className="auth-form-panel"><div className="mobile-auth-brand"><Brand /></div><div className="auth-form-wrap"><span className="eyebrow">WELCOME TO MY NAAI</span><span className="login-hero-badge"><Sparkles size={12} /> {role === 'USER' ? 'Customer login' : 'Salon partner'}</span><h1>{step === 'phone' ? role === 'USER' ? 'Login to book your favorite salon' : 'Grow your salon with My Naai' : step === 'new-user' ? 'One last thing.' : 'Check your phone.'}</h1><p className="auth-subtitle">{step === 'phone' ? role === 'USER' ? 'Welcome back! Sign in to book appointments, track your visits, and get instant confirmations with buzzer alerts.' : 'Receive booking requests instantly with buzzer + vibration, even when app is in background. Works on Android, iOS, Chrome, Edge, Safari and more.' : step === 'new-user' ? `Let\u2019s create your My Naai profile for +91 ${mobile}.` : `Enter the 6-digit code sent to +91 ${mobile}.`}</p>{step === 'phone' && notifyInstall && <button className="install-auth-button install-login-button" onClick={notifyInstall}><Download size={14} /> Install app</button>}{!isIosDevice() && <PWAInstallCard compact notifyInstall={notifyInstall} />}<LoginPermissionsPanel onPushToken={token => { if (token) setPushToken(token); }} />{step === 'phone' && <div className="role-switch"><button className={role === 'USER' ? 'active' : ''} onClick={() => { setRole('USER'); setError(''); }}><CircleUserRound size={16} /> Customer</button><button className={role === 'SALON' ? 'active' : ''} onClick={() => { setRole('SALON'); setError(''); }}><Store size={16} /> Salon partner</button></div>}{error && <div className="form-error" role="alert"><Info size={16} />{error}</div>}{step === 'phone' && <form onSubmit={requestOtp}><Field label="Mobile number"><div className="phone-input"><span>+91</span><input inputMode="numeric" autoComplete="tel" maxLength="10" value={mobile} onChange={event => setMobile(event.target.value.replace(/\D/g, ''))} placeholder="Enter 10-digit number" autoFocus /></div></Field><Button type="submit" loading={busy}>Continue with OTP <ChevronRight size={17} /></Button></form>}{step === 'otp' && <form onSubmit={verify}><Field label="One-time password"><input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ''))} placeholder="· · · · · ·" autoFocus /></Field><Button type="submit" loading={busy}>Verify code <ChevronRight size={17} /></Button><button className="resend-link" type="button" onClick={requestOtp}>Resend code</button><button className="back-form-link" type="button" onClick={() => { setStep('phone'); setOtp(''); setError(''); }}>Use a different number</button></form>}{step === 'new-user' && <form onSubmit={createAccount}><Field label="Your name"><input value={name} onChange={event => setName(event.target.value)} placeholder="How should we call you?" autoFocus /></Field><Button type="submit" loading={busy}>Create my account <ChevronRight size={17} /></Button></form>}</div><p className="auth-legal">By continuing, you agree to My Naai’s terms and privacy policy.</p></div>
      <PermissionGateModal open={permissionGate.open} onClose={() => setPermissionGate(current => ({ ...current, open: false }))} onGranted={handlePermissionGranted} state={permissionGate.state} />
    </div>;
}



function SalonRegistration({ initialData, onBack, onComplete, notifyInstall }) {
  const [step, setStep] = useState('profile');
  const mobile = initialData?.mobile || '';
  const tempToken = initialData?.tempToken || '';
  const pushToken = initialData?.pushToken || '';
  const [profile, setProfile] = useState({ ownerName: '', salonName: '', addressLine1: '', addressLine2: '', city: '', state: '', pincode: '', email: '' });
  const [business, setBusiness] = useState({ genderType: '', openingTime: '09:00', closingTime: '22:00', agentCode: '' });
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [busy, setBusy] = useState(false);
  const [registrationPushToken, setRegistrationPushToken] = useState(pushToken);
  const latestTokenRef = React.useRef(pushToken || '');
  const [error, setError] = useState('');
  useEffect(() => { latestTokenRef.current = registrationPushToken || pushToken || latestTokenRef.current; }, [registrationPushToken, pushToken]);
  const detectLocation = useCallback(async () => {
    setLocationBusy(true);
    setLocationError('');
    try {
      const current = await getBrowserLocation();
      if (!current) {
        setLocationError('Allow location for this site so customers can find your salon nearby.');
        return null;
      }
      setLatitude(Number(current.latitude));
      setLongitude(Number(current.longitude));
      return current;
    } catch (locationRequestError) {
      setLocationError(getErrorMessage(locationRequestError, 'Unable to detect your salon location.'));
      return null;
    } finally { setLocationBusy(false); }
  }, []);
  useEffect(() => {
    if (latitude === null && longitude === null) detectLocation();
  }, [detectLocation, latitude, longitude]);
  const continueProfile = event => {
    event.preventDefault();
    if (!profile.ownerName.trim() || !profile.salonName.trim() || !profile.addressLine1.trim()) return setError('Please complete your name, salon name and address.');
    if (profile.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) return setError('Please enter a valid email address.');
    if (profile.pincode.trim() && !/^\d{6}$/.test(profile.pincode.trim())) return setError('Pincode must contain 6 digits.');
    setError('');
    setStep('business');
  };
  const continueBusiness = async event => {
    event.preventDefault();
    if (!business.genderType) return setError('Choose a salon type.');
    if (business.agentCode && !/^\d{10}$/.test(business.agentCode)) return setError('Agent code must be exactly 10 digits or blank.');
    if (business.openingTime === business.closingTime) return setError('Opening and closing time cannot be the same.');
    setError('');
    setBusy(true);
    try {
      const currentLocation = latitude !== null && longitude !== null ? { latitude, longitude } : await detectLocation();
      if (!currentLocation) throw new Error('Detect your salon location before continuing.');
      const token = await requirePushToken();
      latestTokenRef.current = token;
      setRegistrationPushToken(token);
      setStep('plans');
    } catch (businessError) {
      setError(getErrorMessage(businessError, PUSH_REQUIRED_MESSAGE));
    } finally { setBusy(false); }
  };
  if (step === 'plans') {
    const effectiveToken = registrationPushToken || latestTokenRef.current || pushToken;
    return <SubscriptionScreen params={{ registrationData: { ...profile, phoneNumber: mobile, tempToken, genderType: business.genderType, agentCode: business.agentCode, deviceToken: effectiveToken, latitude: Number(latitude), longitude: Number(longitude), businessHours: { openingTime: `${business.openingTime}:00`, closingTime: `${business.closingTime}:00`, breakStartTime: null, breakEndTime: null }, services: DEFAULT_SERVICES[business.genderType.toLowerCase()] || [] }, onBack }} notify={(type, message) => setError(message)} onAuthComplete={onComplete} />;
  }
  const title = step === 'profile' ? 'Tell us about you.' : 'Set up your day.';
  return <div className="auth-page registration-page"><div className="registration-back"><button className="icon-btn ghost" onClick={step === 'profile' ? onBack : () => setStep('profile')} aria-label="Go back"><ChevronRight size={19} className="rotate-180" /></button><Brand />{notifyInstall && <button className="install-auth-button registration-install-button" onClick={notifyInstall}><Download size={14} /> Install app</button>}</div><div className="registration-card"><div className="registration-progress"><span className="active" /><span className={step === 'business' ? 'active' : ''} /><span /><span /></div><span className="eyebrow">SALON PARTNER · STEP {step === 'profile' ? '2' : '3'} OF 3</span><h1>{title}</h1><p className="auth-subtitle">{step === 'profile' ? 'A few details help customers find you.' : 'Tell us when you are ready for your next customer.'}</p><NotificationSetupCard compact />{error && <div className="form-error"><Info size={16} />{error}</div>}{step === 'profile' && <form onSubmit={continueProfile}><Field label="Mobile number"><div className="phone-input"><span>+91</span><input inputMode="numeric" value={mobile} readOnly aria-label="Registered mobile number" /></div></Field><Field label="Owner name"><input value={profile.ownerName} onChange={event => setProfile(current => ({ ...current, ownerName: event.target.value }))} placeholder="Your full name" autoFocus /></Field><Field label="Salon name"><input value={profile.salonName} onChange={event => setProfile(current => ({ ...current, salonName: event.target.value }))} placeholder="What is your salon called?" /></Field><Field label="Address line 1"><textarea rows="3" value={profile.addressLine1} onChange={event => setProfile(current => ({ ...current, addressLine1: event.target.value }))} placeholder="Area, street, building" /></Field><Field label="Address line 2" hint="Optional"><input value={profile.addressLine2} onChange={event => setProfile(current => ({ ...current, addressLine2: event.target.value }))} placeholder="Landmark" /></Field><div className="form-two-col"><Field label="City"><input value={profile.city} onChange={event => setProfile(current => ({ ...current, city: event.target.value }))} placeholder="City" /></Field><SelectField label="State" value={profile.state} onChange={event => setProfile(current => ({ ...current, state: event.target.value }))} options={STATE_OPTIONS} placeholder="Select state" /></div><div className="form-two-col"><Field label="Pincode" hint="Optional"><input inputMode="numeric" maxLength="6" value={profile.pincode} onChange={event => setProfile(current => ({ ...current, pincode: event.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="Pincode" /></Field><Field label="Email" hint="Optional"><input type="email" value={profile.email} onChange={event => setProfile(current => ({ ...current, email: event.target.value }))} placeholder="owner@example.com" /></Field></div><div className={cx('registration-location', latitude !== null && longitude !== null && 'ready')}><MapPin size={15} /><span>{latitude !== null && longitude !== null ? `Location ready · ${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}` : locationError || 'Detecting salon location…'}</span><button type="button" onClick={detectLocation} disabled={locationBusy}>{locationBusy ? 'Detecting…' : 'Retry'}</button></div><Button type="submit">Next <ChevronRight size={17} /></Button></form>}{step === 'business' && <form onSubmit={continueBusiness}><label className="field"><span className="field-label">Salon type</span><div className="type-option-grid">{['MALE', 'FEMALE', 'UNISEX'].map(type => <button type="button" key={type} className={business.genderType === type ? 'active' : ''} onClick={() => setBusiness(current => ({ ...current, genderType: type }))}>{type === 'UNISEX' ? 'Unisex' : `${type.charAt(0)}${type.slice(1).toLowerCase()}`}</button>)}</div></label><div className="form-two-col"><Field label="Opens"><input type="time" value={business.openingTime} onChange={event => setBusiness(current => ({ ...current, openingTime: event.target.value }))} /></Field><Field label="Closes"><input type="time" value={business.closingTime} onChange={event => setBusiness(current => ({ ...current, closingTime: event.target.value }))} /></Field></div><Field label="Agent code" hint="Optional · exactly 10 digits"><input inputMode="numeric" maxLength="10" value={business.agentCode} onChange={event => setBusiness(current => ({ ...current, agentCode: event.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="Optional agent code" /></Field><Button type="submit" loading={busy}>Choose a plan <ChevronRight size={17} /></Button></form>}</div></div>;
}
function Brand({ light = false }) {
  return (
    <div className={cx('brand', light && 'brand-light')}>
      <img className="brand-mark" src="/assets/my_naai.png" alt="" decoding="async" />
      {/* Both capitals share .brand-cap, so the "M" and the "N" are always the
          same size. The wordmark used to be "M" at 30px plus "y Naai" at 24px,
          which left the N visibly smaller than the M in every header. */}
      <span className="brand-wordmark" aria-hidden="true">
        <span className="brand-cap">M</span>
        <span className="brand-lower">y&nbsp;</span>
        <span className="brand-cap">N</span>
        <span className="brand-lower">aai</span>
      </span>
      <span className="sr-only">My Naai</span>
    </div>
  );
}

function AppShell({ session, route, navigate, onLogout, onSessionUpdate, notifyInstall }) {
  const isSalon = session.role === 'SALON';
  const confirm = useConfirm();
  // Even on the paywall the partner gets the same in-app confirmation: the
  // notice is the only sign-out control left on that screen.
  const confirmSignOut = async () => { if (await confirm(LOGOUT_CONFIRM)) onLogout?.(); };
  const nav = isSalon ? SALON_NAV : USER_NAV;
  const primaryRoutes = nav.map(item => item.name);
  const utilityRoutes = ['detail', 'services', 'schedule', 'notifications', 'delay', 'about', 'faq', 'terms', 'salonAbout', 'salonFaq', 'salonTerms', 'subscription', 'editProfile', 'bookingRequest'];
  const showBottomNav = primaryRoutes.includes(route.name);
  const [toast, setToast] = useState(null);
  const notify = useCallback((type, message) => { setToast({ type, message }); window.clearTimeout(notify.timer); notify.timer = window.setTimeout(() => setToast(null), 4000); }, []);
  const cachedSubscription = useMemo(() => getSalonSubscriptionState(session), [session]);
  const [subscriptionGate, setSubscriptionGate] = useState(() => {
    if (!isSalon || session.isNewSalon) return 'active';
    // Even a cached active plan is revalidated before a partner screen mounts;
    // expiry can happen while the portal is closed.
    return cachedSubscription.expired ? 'locked' : 'checking';
  });
  const subscriptionGateRef = useRef(subscriptionGate);
  useEffect(() => { subscriptionGateRef.current = subscriptionGate; }, [subscriptionGate]);
  const routeName = useRef(route.name);
  useEffect(() => { routeName.current = route.name; }, [route.name]);
  // Screens read the session through this ref so `handleSessionUpdate` below can
  // keep a stable identity (see its comment).
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // A salon subscription is checked before any partner screen is mounted. This
  // prevents a stale queue/account route from flashing or being usable while the
  // server already considers the plan expired. Customer sessions never enter
  // this gate.
  useEffect(() => {
    if (!isSalon || session.isNewSalon) {
      setSubscriptionGate('active');
      return undefined;
    }
    const cached = getSalonSubscriptionState(session);
    if (cached.expired) {
      setSubscriptionGate('locked');
      return undefined;
    }

    let cancelled = false;
    let expiryTimer;
    setSubscriptionGate('checking');
    const scheduleExpiry = plan => {
      const expiryTime = plan?.expiryDate ? new Date(plan.expiryDate).getTime() : NaN;
      if (!Number.isFinite(expiryTime)) return;
      const delay = expiryTime - Date.now();
      if (delay <= 0) {
        setSubscriptionGate('locked');
        return;
      }
      expiryTimer = window.setTimeout(() => {
        if (!cancelled) setSubscriptionGate('locked');
      }, delay + 1);
    };

    api.salonProfile({ salonId: session.userId })
      .then(response => {
        if (cancelled) return;
        if (isPlanExpiredResponse(response)) {
          setSubscriptionGate('locked');
          return;
        }
        const profile = response?.data?.salon || response?.data || {};
        const state = getSubscriptionState(profile);
        if (state.expired) {
          setSubscriptionGate('locked');
          return;
        }
        scheduleExpiry(state.plan);
        // A profile without subscription fields is treated as unknown rather
        // than expired. The API remains the source of truth for restricted
        // actions and will emit PLAN_EXPIRED if the account is actually blocked.
        setSubscriptionGate('active');
      })
      .catch(error => {
        if (cancelled) return;
        setSubscriptionGate(isPlanExpiredResponse(error) ? 'locked' : 'active');
      });

    return () => {
      cancelled = true;
      if (expiryTimer) window.clearTimeout(expiryTimer);
    };
  }, [isSalon, session.isNewSalon, session.userId]);

  // A server-side PLAN_EXPIRED response can arrive after the initial check (for
  // example exactly at midnight). It is a hard redirect, not a dismissible
  // warning, and the renewal screen is the only salon view left mounted.
  const forceSalonRenewal = useCallback(() => {
    setSubscriptionGate('locked');
    if (route.name !== 'subscription' || route.params?.mode !== 'RENEW' || !flagIsTrue(route.params?.forceRenewal)) {
      navigate('subscription', { mode: 'RENEW', forceRenewal: true }, { replace: true });
    }
  }, [navigate, route.name, route.params]);

  useEffect(() => {
    if (!isSalon) return undefined;
    const onPlanExpired = () => forceSalonRenewal();
    window.addEventListener('mynaai:plan-expired', onPlanExpired);
    return () => window.removeEventListener('mynaai:plan-expired', onPlanExpired);
  }, [forceSalonRenewal, isSalon]);

  // Guarded navigation: when subscription is locked, only the renewal
  // screen is allowed. This prevents any hash manipulation or in-app
  // navigation from escaping the paywall until payment succeeds.
  const safeNavigate = useCallback((screen, params = {}, options = {}) => {
    const targetName = typeof screen === 'object' ? screen.name : screen;
    if (subscriptionGateRef.current === 'locked' && targetName !== 'subscription') {
      // Force back to renewal — do not allow any other screen.
      if (routeName.current !== 'subscription') {
        navigate('subscription', { mode: 'RENEW', forceRenewal: true }, { replace: true });
      }
      return;
    }
    navigate(screen, params, options);
  }, [navigate]);

  useEffect(() => {
    if (!isSalon || subscriptionGate !== 'locked') return;
    if (route.name !== 'subscription' || route.params?.mode !== 'RENEW' || !flagIsTrue(route.params?.forceRenewal)) {
      navigate('subscription', { mode: 'RENEW', forceRenewal: true }, { replace: true });
    }
  }, [isSalon, navigate, route.name, route.params, subscriptionGate]);

  // Foreground web push: FCM hands these messages to the page instead of the OS,
  // so My Naai renders the notification itself, toasts it, and only auto-navigates
  // for time-critical actions (a salon booking request, a delay proposal). An
  // informational message must never yank a customer out of the booking flow.
  // When the subscription is locked, actionable navigation is suppressed — the
  // salon must renew first, even if a booking request arrives.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    setupPush({
      onMessage: payload => {
        if (cancelled) return;
        const message = normalizePushPayload(payload);
        recordForegroundMessage(message);
        // If locked, still show the OS notification but do not auto-navigate
        // away from the renewal paywall.
        const isLocked = subscriptionGateRef.current === 'locked';
        displayNotification({
          title: message.title,
          body: message.body,
          data: message.data,
          // If this browser cannot attach a service-worker notification click,
          // the Notification API fallback still opens the same route.
          onClick: () => {
            if (subscriptionGateRef.current === 'locked') {
              safeNavigate('subscription', { mode: 'RENEW', forceRenewal: true }, { replace: true });
              return;
            }
            const next = getNotificationRoute(message.data, session.role);
            if (next.name && next.name !== routeName.current) safeNavigate(next.name, next.params);
          },
        });
        notify('info', `${message.title}${message.body && message.body !== message.title ? ` — ${message.body}` : ''}`);
        // Time-critical notification: sound the booking buzzer + vibrate, like
        // the mobile app. Informational messages stay silent by design.
        // Suppress buzzer navigation when locked — renewal is the only focus.
        if (isLocked) return;
        if (isActionableNotification(message.type, session.role)) {
          playBuzzer({ type: message.type });
        }
        if (!isActionableNotification(message.type, session.role)) return;
        const next = getNotificationRoute(message.data, session.role);
        if (!next.name || next.name === routeName.current) return;
        safeNavigate(next.name, next.params);
      },
    }).then(result => {
      if (cancelled) result?.unsubscribe?.();
      else unsubscribe = result?.unsubscribe || (() => {});
    }).catch(pushError => {
      if (!cancelled) console.debug(getErrorMessage(pushError, 'Live browser notifications are unavailable.'));
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [safeNavigate, notify, session.role, session.userId]);

  // NOTE: deliberately not keyed on `session`. Screens list this callback in the
  // dependency array of their data loader (SalonAccountScreen, SubscriptionScreen)
  // and then call it from inside that loader. Depending on `session` gave it a new
  // identity on every write, which recreated `load`, re-fired the loader effect,
  // refetched, wrote again — an endless loop that pinned the salon account screen on
  // "Loading salon profile…" while spamming GET /api/salon/profile. The latest
  // session is read from sessionRef instead, so identity stays stable and the
  // handler still sees current data.
  const handleSessionUpdate = useCallback((user = {}, sessionPatch = {}) => {
    onSessionUpdate?.(user, sessionPatch);
    if (!isSalon) return;
    const nextProfile = { ...getSalonSubscriptionProfile(sessionRef.current), ...(user || {}) };
    const explicitlyExpired = flagIsTrue(user?.subscriptionExpired) || flagIsTrue(sessionPatch?.subscriptionExpired);
    const explicitlyActive = flagIsFalse(user?.subscriptionExpired) || flagIsFalse(sessionPatch?.subscriptionExpired);
    const nextState = getSubscriptionState(nextProfile);
    if (explicitlyExpired || nextState.expired) setSubscriptionGate('locked');
    else if (explicitlyActive || nextState.active) setSubscriptionGate('active');
  }, [isSalon, onSessionUpdate]);

  const isSubscriptionLocked = isSalon && subscriptionGate === 'locked';
  const isCheckingSubscription = isSalon && !session.isNewSalon && subscriptionGate === 'checking';
  const isSubscriptionGateScreen = isSubscriptionLocked || isCheckingSubscription;
  const render = () => {
    // When locked, only renewal is allowed — all screens receive safeNavigate
    // so even if they attempt to navigate elsewhere, the paywall holds.
    const navForScreens = isSubscriptionLocked ? safeNavigate : navigate;
    const props = { session, navigate: navForScreens, notify, onSessionUpdate: handleSessionUpdate };
    if (isSalon && session.isNewSalon && route.name !== 'editProfile') return <EditSalonProfileScreen {...props} params={{ ...(route.params || {}), isOnboarding: 'true' }} onLogout={onLogout} />;
    if (!isSalon) {
      if (route.name === 'home') return <HomeScreen {...props} />;
      if (route.name === 'bookings') return <BookingsScreen {...props} />;
      if (route.name === 'products') return <ProductsScreen {...props} />;
      if (route.name === 'account') return <AccountScreen {...props} onLogout={onLogout} />;
      if (route.name === 'detail') return <SalonDetailScreen {...props} params={route.params} />;
      if (route.name === 'services') return <ServicesScreen {...props} params={route.params} />;
      if (route.name === 'schedule') return <ScheduleScreen {...props} params={route.params} />;
      if (route.name === 'notifications') return <NotificationsScreen {...props} />;
      if (route.name === 'delay') return <DelayRequestScreen {...props} params={route.params} />;
      if (['about', 'faq', 'terms'].includes(route.name)) return <InfoScreen type={route.name} navigate={navForScreens} />;
      return <HomeScreen {...props} />;
    }
    if (route.name === 'queue') return <SalonQueueScreen {...props} />;
    if (route.name === 'history') return <SalonHistoryScreen {...props} />;
    if (route.name === 'salonProducts') return <SalonProductsScreen {...props} />;
    if (route.name === 'account') return <SalonAccountScreen {...props} onLogout={onLogout} />;
    if (route.name === 'notifications') return <NotificationsScreen {...props} />;
    if (route.name === 'editProfile') return <EditSalonProfileScreen {...props} params={route.params} onLogout={onLogout} />;
    if (route.name === 'bookingRequest') return <BookingRequestScreen {...props} params={route.params} />;
    if (route.name === 'subscription') return <SubscriptionScreen {...props} params={route.params} />;
    if (route.name === 'salonAbout') return <PartnerInfo type="about" navigate={navForScreens} />;
    if (route.name === 'salonFaq') return <PartnerInfo type="faq" navigate={navForScreens} />;
    if (route.name === 'salonTerms') return <PartnerInfo type="terms" navigate={navForScreens} />;
    return <SalonQueueScreen {...props} />;
  };
  // When plan expired, show ONLY the renewal screen — no queue, no history,
  // no account. After successful payment, handleSessionUpdate flips the gate
  // to active and the full portal is unlocked.
  const gateContent = isSubscriptionLocked
    ? <SubscriptionScreen session={session} navigate={safeNavigate} notify={notify} params={{ mode: 'RENEW', forceRenewal: true }} onSessionUpdate={handleSessionUpdate} onLogout={onLogout} />
    : isCheckingSubscription
      ? <SubscriptionGateLoading />
      : render();
  // Navigation for shell chrome should also respect the paywall.
  const shellNavigate = isSubscriptionLocked ? safeNavigate : navigate;
  return <div className={cx('app-shell', isSalon && 'salon-shell', isSubscriptionGateScreen && 'subscription-gate-shell', !showBottomNav && 'utility-shell')}>
    {!isSubscriptionGateScreen && <Sidebar session={session} nav={nav} route={route} navigate={shellNavigate} onLogout={onLogout} notifyInstall={notifyInstall} />}
    <main className="workspace">
      {!isSubscriptionGateScreen && <div className="mobile-shell-bar"><Brand /><button className="notification-button" aria-label="Notifications" onClick={() => shellNavigate('notifications')}><Bell size={18} /><span className="notification-ping" /></button></div>}
      <div className={cx('workspace-content', (isSubscriptionGateScreen || utilityRoutes.includes(route.name)) && 'utility-content', isSubscriptionGateScreen && 'subscription-gate-content')}>
        {isSubscriptionLocked && (
          <div className="subscription-lock-notice" role="alert">
            <CircleAlert size={17} />
            <span><strong>Your salon subscription has expired.</strong> Renew now to unlock your salon dashboard. Customers do not make payments here.</span>
            <button className="subscription-lock-logout" onClick={confirmSignOut} aria-label="Sign out"><LogOut size={14} /> Sign out</button>
          </div>
        )}
        {!isSubscriptionGateScreen && route.name === 'account' && <NotificationSetupCard notifyInstall={notifyInstall} />}
        {gateContent}
      </div>
    </main>
    {!isSubscriptionGateScreen && showBottomNav && <MobileNav nav={nav} route={route} navigate={shellNavigate} />}
    {toast && <div className="toast-position"><div className={cx('toast', `toast-${toast.type || 'info'}`)} role="status"><span className="toast-mark">{toast.type === 'error' ? '!' : '✓'}</span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} /></button></div></div>}
  </div>;
}

function SubscriptionGateLoading() {
  return <div className="subscription-gate-loading" role="status" aria-live="polite"><div className="subscription-gate-mark"><Store size={22} /></div><h1>Checking your salon subscription</h1><p>One moment while we verify access to your salon dashboard.</p><Spinner label="Checking subscription…" /></div>;
}

function Sidebar({ session, nav, route, navigate, onLogout, notifyInstall }) {
  const isSalon = session.role === 'SALON';
  const confirm = useConfirm();
  const signOut = async () => { if (await confirm(LOGOUT_CONFIRM)) onLogout?.(); };
  return <aside className="sidebar"><Brand /><div className="sidebar-role"><span className="role-mark">{isSalon ? <Store size={15} /> : <Scissors size={15} />}</span><span><small>Signed in as</small><strong>{isSalon ? 'Salon partner' : 'Customer'}</strong></span></div><nav className="sidebar-nav"><button className={route.name === 'notifications' ? 'active' : ''} onClick={() => navigate('notifications')}><Bell size={18} /><span>Notifications</span>{route.name === 'notifications' && <i />}</button>{nav.map(item => <button key={item.name} className={route.name === item.name ? 'active' : ''} onClick={() => navigate(item.name)}><item.icon size={18} /><span>{item.label}</span>{route.name === item.name && <i />}</button>)}</nav><div className="sidebar-bottom">{notifyInstall && <button className="install-side-button" onClick={notifyInstall}><Download size={16} /><span>Install My Naai</span></button>}<div className="sidebar-tip"><Sparkles size={16} /><p>{isSalon ? 'Keep your profile fresh to stand out nearby.' : 'Your next great look is closer than you think.'}</p></div><button className="sidebar-logout" onClick={signOut}><LogOut size={16} /> Sign out</button></div></aside>;
}

function MobileNav({ nav, route, navigate }) { return <nav className="mobile-nav">{nav.map(item => <button key={item.name} className={route.name === item.name ? 'active' : ''} onClick={() => navigate(item.name)}><item.icon size={20} /><span>{item.label.replace('Customer ', '').replace('My ', '')}</span></button>)}</nav>; }

function PartnerInfo({ type, navigate }) { const content = type === 'about' ? SALON_ABOUT_CONTENT : type === 'faq' ? SALON_FAQ_CONTENT : SALON_TERMS_CONTENT; return <div className="screen info-screen"><div className="page-header"><div className="page-header-leading"><button className="icon-btn ghost" onClick={() => navigate(-1)} aria-label="Go back"><ChevronRight size={19} className="rotate-180" /></button><div><span className="eyebrow">{content.eyebrow}</span><h1>{content.title}</h1></div></div></div><div className="info-intro"><Sparkles size={18} /><p>{content.intro || 'Everything you need to know about partnering with My Naai.'}</p></div><div className="info-sections">{content.sections.map(section => <section key={section.title}><h2>{section.title}</h2><p>{section.text}</p></section>)}</div><div className="info-contact"><span className="info-contact-icon"><HelpCircle size={18} /></span><div><strong>Need more help?</strong><p>Call our partner team on 8380017393</p></div><button onClick={() => window.open('tel:8380017393')}><ChevronRight size={17} /></button></div></div>; }
