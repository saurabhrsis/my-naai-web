import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarCheck2,
  ChevronRight,
  CircleAlert,
  CircleUserRound,
  Download,
  HelpCircle,
  History,
  Info,
  LogOut,
  MapPin,
  Menu,
  Package,
  Scissors,
  Sparkles,
  Store,
  UsersRound,
  X,
  ShieldCheck,
} from 'lucide-react';
import { api, clearSession, getToken, isPlanExpiredResponse, isUnknownSalonResponse, setToken } from './lib/api';
import { persistSession, readLocalSession, restoreSession } from './lib/session';
import { closeNotification, deletePushToken, displayNotification, getNotificationRoute, getPushStatus, getPushToken, isActionableNotification, isPushConfigured, normalizePushPayload, recordForegroundMessage, setupPush, watchNotificationPermission } from './lib/push';
import {
  ALERTS_BLOCKED_MESSAGE,
  ALERTS_FINISHING_MESSAGE,
  ALERTS_REQUIRED_MESSAGE,
  ALERTS_UNCONFIGURED_MESSAGE,
  ALERTS_UNSUPPORTED_MESSAGE,
  IOS_ALERTS_REQUIRED_MESSAGE,
  isDeviceTokenError,
  isEmbeddedFrame,
  isIosDevice,
  isIosPwaInstalled,
  isStandalone,
  readPermission,
  requestNotifications,
} from './lib/permissions';
import { InstallAppButton, LoginPermissionCard, NotificationSetupCard, PermissionSheet } from './components/PermissionUI';
import { BuzzerTestCard } from './components/BuzzerTestCard';
import { BOOKING_ALERT_WINDOW_MS, BookingRequestAlert } from './components/BookingRequestAlert';
// The deviceToken rule is shared (lib/apiPayload) so the Alerts & permissions
// card's end-to-end test alert follows the same mobile contract as sign-in.
import { withDeviceToken } from './lib/apiPayload';
import { clearDeviceTokenSync, keepDeviceTokenSynced } from './lib/deviceToken';
import { alertIdentity, claimAlertDelivery, playBuzzer, unlockBuzzer } from './lib/buzzer';
import { resetLiveUpdatesSocket } from './lib/socket';
import { armStoredReminders } from './lib/reminders';
import { popPendingRoute, stashPendingRoute } from './lib/pendingRoute';
import { legacyHashToRoute, parseRoutePath, routeToPath, softNavigate } from './lib/routes';
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
  PartnerScreen,
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
import { Button, Field, Modal, SelectField, Spinner, SurfaceProvider, getBrowserLocation, getErrorMessage, cx } from './components/Shared';

// `label` is the full sidebar/menu wording; `short` is what the bottom bar
// shows when the full one will not fit. Both are written out properly — the bar
// must never derive its text by trimming a prefix off `label` (that is what
// produced a lowercase "bookings" tab).
const USER_NAV = [
  { name: 'home', label: 'Discover', short: 'Discover', icon: Scissors },
  { name: 'bookings', label: 'My bookings', short: 'Bookings', icon: CalendarCheck2 },
  { name: 'products', label: 'Products', short: 'Products', icon: Package },
  { name: 'account', label: 'Account', short: 'Account', icon: CircleUserRound },
];
const SALON_NAV = [
  { name: 'queue', label: 'Customer queue', short: 'Queue', icon: UsersRound },
  { name: 'history', label: 'History', short: 'History', icon: History },
  { name: 'salonProducts', label: 'Products', short: 'Products', icon: Package },
  { name: 'account', label: 'Account', short: 'Account', icon: CircleUserRound },
];

// The stored session is owned by src/lib/session.js, which keeps three copies of
// it: localStorage (the synchronous one every render reads), IndexedDB (the one
// the notification worker reads for Accept/Reject/Delay) and CacheStorage (the
// only one an app installed *after* signing in can still reach on a platform
// that isolates Web Storage, which iOS does). Reading here is deliberately
// forgiving — a session that lost one of its companion keys is repaired rather
// than treated as "please log in again".
function readStoredSession() {
  const stored = readLocalSession();
  if (!stored) return null;
  return { role: stored.role, user: stored.user, userId: stored.userId, isNewSalon: stored.isNewSalon };
}

function saveSession(session) {
  const role = String(session.role || '').toUpperCase();
  const user = session.user || {};
  if (session.token) setToken(session.token);
  // persistSession writes localStorage synchronously (so the very next read in
  // this same tick sees the session) and mirrors the rest in the background.
  const stored = persistSession({ token: session.token || getToken(), role, user, isNewSalon: session.isNewSalon, userId: session.userId });
  const userId = stored?.userId || session.userId || user?.userId || user?.salon?.salonId || user?.salonId || user?.id || '';
  return { ...session, role, user, userId, isNewSalon: Boolean(stored?.isNewSalon || session.isNewSalon) };
}

// History routing (real paths, no hashes, in src/lib/routes.js): `/` is the
// home page, `/salon/<id>` a salon's public page, `/<screen>?<query>` the rest
// — `/privacy-policy` maps to the `privacy` route via segment aliases.
// `navigate` writes paths, `getRouteFromPath` reads them back into
// `{ name, params }`. It runs on first paint (refresh keeps your screen), on
// popstate (browser back/forward) and when another tab rewrites the stored
// session. It also accepts notification deep links — `/bookingRequest?…` for a
// partner, `/delay?…` for a customer — and upgrades legacy `#/...` links in
// place (readLocationRoute), which is why an unknown or role-mismatched screen
// falls back to the role's home instead of rendering a screen the shell has
// no branch for.
const USER_ROUTE_NAMES = ['home', 'bookings', 'products', 'account', 'detail', 'salon', 'services', 'schedule', 'notifications', 'delay', 'about', 'faq', 'terms', 'privacy', 'contact'];
const SALON_ROUTE_NAMES = ['queue', 'history', 'salonProducts', 'account', 'notifications', 'editProfile', 'bookingRequest', 'subscription', 'salonAbout', 'salonFaq', 'salonTerms'];
// Every route a visitor may open WITHOUT an account — salons are browsable
// first, login only appears when they try to book (the client's headline
// ask). The info pages are public too: the site footer links About/FAQ/Terms/
// Privacy and a website's legal pages must never sit behind a login. `login`
// is handled by AppRoot itself, not by the guest shell.
const GUEST_ROUTE_NAMES = ['home', 'salon', 'about', 'faq', 'terms', 'privacy', 'contact', 'partner'];
const PUBLIC_ROUTE_NAMES = [...GUEST_ROUTE_NAMES, 'login'];

function defaultRouteForRole(role) {
  return { name: String(role || '').toUpperCase() === 'SALON' ? 'queue' : 'home', params: {} };
}

// Accepts both the classic `#/<screen>?<query>` shape and the shareable
// per-salon link `#/salon/<id>?<query>` — the id nests in the path so the URL
// reads like a real link someone can paste into WhatsApp.
// parseRoutePath / routeToPath live in src/lib/routes.js (shared, no React
// cycle) and are re-exported here so existing imports keep working.
export { parseRoutePath, routeToPath };

// Read the browser location as a route, with legacy-hash upgrade: an old
// shared `#/salon/<id>` link (or a notification tap written in the hash era)
// still resolves, and the address bar is rewritten to the clean path so
// refreshes and the back button stay consistent.
function readLocationRoute() {
  const path = parseRoutePath(`${window.location.pathname}${window.location.search}`);
  if (!path.name) {
    const legacy = legacyHashToRoute(window.location.hash);
    if (legacy?.name) {
      window.history.replaceState({}, '', routeToPath(legacy.name, legacy.params));
      return legacy;
    }
  }
  return path;
}

export function getRouteFromPath(role) {
  const fallback = defaultRouteForRole(role);
  if (typeof window === 'undefined') return fallback;
  const route = readLocationRoute();
  const roleKey = String(role || '').toUpperCase();
  const knownRoutes = !roleKey ? PUBLIC_ROUTE_NAMES : roleKey === 'SALON' ? SALON_ROUTE_NAMES : USER_ROUTE_NAMES;
  if (!knownRoutes.includes(route.name)) return fallback;
  return route;
}

// Validate a stashed resume path for the role that just logged in (the salon
// deep link a customer was browsing means nothing to a partner account).
export function resolveResumeRoute(role, hash) {
  if (!hash) return null;
  const parsed = parseRoutePath(hash.startsWith('#') ? hash.replace(/^#+/, '') : hash);
  const knownRoutes = String(role || '').toUpperCase() === 'SALON' ? SALON_ROUTE_NAMES : USER_ROUTE_NAMES;
  return knownRoutes.includes(parsed.name) ? parsed : null;
}

// Hand the API whatever token we have — and never hold the visitor hostage to
// it. Alerts are the product's own feature, so they are offered, explained and
// retryable; they are not a toll gate on the way in. If the API still insists on
// a deviceToken, `isDeviceTokenError` recognises the refusal and the alerts
// sheet answers it with one tap plus an automatic retry (see AuthFlow).
// The FCM token the login request carries. The backend stores THIS value and
// sends every notification to it, so it must be the browser's CURRENT token —
// Firebase's getToken() returns the live one (and rotates a dead one), which is
// why a cached FCM_TOKEN is only ever the fallback, never the first choice.
// A slow worker start-up is retried for a few seconds: a login is the one
// moment the server learns the token, so it is worth waiting for.
const LOGIN_TOKEN_ATTEMPTS = 3;
const LOGIN_TOKEN_RETRY_MS = 1000;
async function resolveDeviceToken({ patient = false } = {}) {
  if (!isPushConfigured()) return '';
  const attempts = patient ? LOGIN_TOKEN_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const token = await getPushToken({ requestPermission: false });
      if (token) return token;
    } catch (error) {
      console.debug(getErrorMessage(error, 'Could not read the browser notification token.'));
    }
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, LOGIN_TOKEN_RETRY_MS));
  }
  try { return localStorage.getItem('FCM_TOKEN') || ''; } catch { return ''; }
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
  const [route, setRoute] = useState(() => {
    if (!session) {
      // A first-visit deep link that needs an account goes through login and
      // resumes afterwards; guest routes render the public shell directly.
      // readLocationRoute also upgrades legacy `#/...` share links in place.
      const raw = readLocationRoute();
      if (raw.name && !PUBLIC_ROUTE_NAMES.includes(raw.name)) {
        stashPendingRoute(`${window.location.pathname}${window.location.search}`);
        return { name: 'login', params: {} };
      }
      if (!raw.name) return { name: 'home', params: {} };
      return raw;
    }
    return getRouteFromPath(session.role);
  });
  // Installing the app must not cost the user a sign-in.
  //
  // An installed app is a separate storage container on iOS (Web Storage,
  // IndexedDB and cookies are all per-container), so a device that is signed in
  // in the browser starts the installed app as a stranger — even though the
  // person installed the app *because* they were signed in. The one store both
  // containers share is the CacheStorage the session is mirrored into (see
  // src/lib/session.js), so an installed app that has no local session asks the
  // shared copies before it believes it is signed out.
  //
  // `restoring` is the splash that keeps that lookup from flashing a login form
  // at somebody who is already signed in. It only ever appears inside an
  // installed app with no local session; a browser tab renders immediately,
  // exactly as before.
  const [restoring, setRestoring] = useState(() => !session && isStandalone());
  useEffect(() => {
    if (session) return undefined;
    let cancelled = false;
    const finish = restored => {
      if (cancelled) return;
      setRestoring(false);
      if (!restored) return;
      setSession({ role: restored.role, user: restored.user, userId: restored.userId, isNewSalon: restored.isNewSalon });
      const target = getRouteFromPath(restored.role);
      setRoute(target);
      window.history.replaceState({}, '', routeToPath(target.name, target.params));
    };
    restoreSession().then(finish).catch(() => finish(null));
    // A browser that refuses IndexedDB and CacheStorage must not hold the app
    // hostage: the splash ends either way.
    const timer = window.setTimeout(() => finish(null), 2500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);
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
    // Guests who landed here from a salon page (Book now → login) go straight
    // back to that exact salon; everyone else lands on their role home.
    const resume = resolveResumeRoute(stored.role, popPendingRoute());
    const needsSalonProfile = stored.role === 'SALON' && stored.isNewSalon;
    const nextRoute = needsSalonProfile ? 'editProfile' : resume?.name || (stored.role === 'SALON' ? 'queue' : 'home');
    const nextParams = needsSalonProfile ? { isOnboarding: 'true' } : resume?.params || {};
    setRoute({ name: nextRoute, params: nextParams });
    window.history.replaceState({}, '', routeToPath(nextRoute, nextParams));
  }, []);
  const logout = useCallback(() => { clearDeviceTokenSync(); clearSession(); resetLiveUpdatesSocket(); setSession(null); setRoute({ name: 'home', params: {} }); window.history.replaceState({}, '', '/'); }, []);
  const updateSessionUser = useCallback((user, sessionPatch = {}) => setSession(current => {
    if (!current) return current;
    const nextUser = { ...current.user, ...user };
    const next = { ...current, ...sessionPatch, user: nextUser };
    // Every copy of the session has to stay current, not just localStorage: an
    // app installed later restores the salon profile it finds in the shared
    // cache, and a stale copy would open the installed app with the previous
    // profile (or, after onboarding, without it).
    persistSession(next);
    return next;
  }), []);
  useEffect(() => {
    const onRouteChange = () => {
      // Guests: path edits outside the public routes (notification deep links,
      // a pasted /bookings URL) are remembered and sent through login first.
      if (!readStoredSession()) {
        const raw = readLocationRoute();
        if (!raw.name) { setRoute({ name: 'home', params: {} }); return; }
        if (!PUBLIC_ROUTE_NAMES.includes(raw.name)) {
          stashPendingRoute(`${window.location.pathname}${window.location.search}`);
          setRoute({ name: 'login', params: {} });
          window.history.replaceState({}, '', '/login');
          return;
        }
        setRoute(raw);
        return;
      }
      setRoute(getRouteFromPath(session?.role));
    };
    window.addEventListener('popstate', onRouteChange);
    return () => {
      window.removeEventListener('popstate', onRouteChange);
    };
  }, [session?.role]);
  useEffect(() => {
    if (session?.role !== 'SALON' || !session.isNewSalon || route.name === 'editProfile') return;
    const next = { name: 'editProfile', params: { isOnboarding: 'true' } };
    setRoute(next);
    window.history.replaceState({}, '', '/editProfile?isOnboarding=true');
  }, [route.name, session?.isNewSalon, session?.role]);
  const navigate = useCallback((screen, params = {}, options = {}) => {
    if (screen === -1) { window.history.back(); return; }
    const next = typeof screen === 'object' ? screen : { name: screen, params };
    setRoute(next);
    const path = routeToPath(next.name, next.params);
    if (options.replace) window.history.replaceState({}, '', path); else window.history.pushState({}, '', path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  useEffect(() => {
    const onStorage = event => {
      if (['mynaai', 'mynaaiUser', 'userType', 'isLoggedIn', 'isNewSalon'].includes(event.key)) {
        const next = readStoredSession();
        setSession(next);
        if (next) setRoute(getRouteFromPath(next.role));
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
  // Re-arm per-booking reminders (30 minutes before the slot) that survived a
  // page reload. OS-scheduled reminders (TimestampTrigger browsers) live in
  // the service worker and need nothing here.
  useEffect(() => { armStoredReminders(); }, []);

  // The login page's back affordance in guest mode: return to exactly what
  // the user was browsing (usually a salon page) instead of trapping them at
  // an OTP form when they only came to look.
  const backToBrowse = useCallback(() => {
    // Only ever return to a page a guest may actually see: the stash can hold
    // a gated deep link (someone pasted /bookings), and resuming that would
    // bounce straight back to this same login page and lose the stash.
    const hash = popPendingRoute();
    const parsed = hash ? parseRoutePath(hash) : null;
    const next = parsed && GUEST_ROUTE_NAMES.includes(parsed.name) ? parsed : { name: 'home', params: {} };
    setRoute(next);
    window.history.replaceState({}, '', routeToPath(next.name, next.params));
  }, []);

  if (!session) {
    // An installed app with no local session checks the shared copies first
    // (the block above). Anything else renders immediately, exactly as before.
    if (restoring) return <SessionRestoreSplash />;
    const showLogin = route.name === 'login' || !PUBLIC_ROUTE_NAMES.includes(route.name);
    if (showLogin) return <AuthFlow onComplete={completeAuth} notifyInstall={installPrompt ? install : null} onBrowseBack={backToBrowse} initialRole={String(route.params?.role || '').toUpperCase() === 'SALON' ? 'SALON' : 'USER'} />;
    // /salon-partner (the salon-owner landing page) is where a partner tries
    // the portal before an account exists, so it carries the signed-out buzzer
    // check — reachable on iOS without signing in.
    return <GuestShell route={route} navigate={navigate} notifyInstall={installPrompt ? install : null} showBuzzerCheck={route.name === 'partner'} />;
  }
  return <AppShell session={session} route={route} navigate={navigate} onLogout={logout} onSessionUpdate={updateSessionUser} notifyInstall={installPrompt ? install : null} />;
}

// The pre-login shell: full salon discovery without an account. The header
// keeps login + install one tap away; every account-gated action (booking
// steps, bookmarks) funnels to login with the exact route remembered for
// afterwards. No onboarding slides, no marketing wall — salons first.
export function GuestShell({ route, navigate, notifyInstall, showBuzzerCheck = false, notify: notifyProp = null }) {
  const [toast, setToast] = useState(null);
  // Phones cannot fit four route labels + Install + Login on one row: the row
  // used to overflow and pushed the Login pill half off the screen. The links
  // now fold into a dropdown panel opened from a hamburger, while the brand and
  // the Login pill stay pinned in the bar itself.
  const [menuOpen, setMenuOpen] = useState(false);
  const navbarRef = useRef(null);
  // Tells raised inside the website shell (the signed-out buzzer check, for one)
  // are forwarded to the host page as well as shown as a toast here.
  const notify = useCallback((type, message) => {
    notifyProp?.(type, message);
    setToast({ type, message });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(null), 4000);
  }, [notifyProp]);
  const guestNavigate = useCallback((screen, params = {}, options = {}) => {
    if (screen === -1) { window.history.back(); return; }
    const name = typeof screen === 'object' ? screen.name : screen;
    if (GUEST_ROUTE_NAMES.includes(name)) return navigate(name, params, options);
    if (name !== 'login') {
      // Login is required beyond this point — carry the current salon (or the
      // discovery page) as the resume target unless the caller named one.
      const current = route.name === 'salon' && route.params?.salonId
        ? `/salon/${route.params.salonId}`
        : '/';
      stashPendingRoute(params.returnTo || current);
    } else if (params.returnTo) {
      stashPendingRoute(params.returnTo);
    }
    // Partner CTAs carry { role: 'SALON' } so the pair lands pre-selected on
    // the login page (/login?role=SALON — shareable, bookmarkable).
    return navigate('login', params, options);
  }, [navigate, route.name, route.params?.salonId]);
  // The public page runs as a small website: sticky navbar (logo → home, the
  // three site routes, Install + Login), the routed page, then the footer
  // that each screen renders itself. The navbar link labels match the hashes
  // (#/, #/about, #/contact) so deep links and clicks resolve identically.
  const currentPage = route.name === 'salon' ? '' : route.name;
  const siteLinks = [
    { name: 'home', label: 'Home' },
    { name: 'about', label: 'About' },
    // Owners find their route straight from the navbar — no hunting.
    { name: 'partner', label: 'Salon partner' },
    { name: 'contact', label: 'Contact' },
  ];
  const goToSitePage = name => { setMenuOpen(false); guestNavigate(name); };
  // A dropdown that outlives the tap is a trap: close it on navigation (any
  // route change, including back/forward), on Escape, and on any tap outside
  // the header. No scroll lock — the panel is short and the page stays usable.
  useEffect(() => { setMenuOpen(false); }, [route.name, route.params?.salonId]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = event => { if (event.key === 'Escape') setMenuOpen(false); };
    const onPointerDown = event => { if (!navbarRef.current?.contains(event.target)) setMenuOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDown); };
  }, [menuOpen]);
  return <div className="guest-shell">
    <header className={cx('site-navbar', menuOpen && 'menu-open')} ref={navbarRef}>
      <button type="button" className="site-navbar-brand" onClick={() => goToSitePage('home')} aria-label="My Naai — home"><Brand /></button>
      <nav className="site-nav-links" id="site-nav-links" aria-label="Site navigation">
        {siteLinks.map(link => (
          <button key={link.name} type="button" className={cx(currentPage === link.name && 'active')} aria-current={currentPage === link.name ? 'page' : undefined} onClick={() => goToSitePage(link.name)}>{link.label}</button>
        ))}
      </nav>
      <div className="site-navbar-actions">
        <InstallAppButton onInstall={notifyInstall} />
        <button className="guest-login-button" onClick={() => guestNavigate('login')}><CircleUserRound size={15} /> Login</button>
        <button
          type="button"
          className="site-nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="site-nav-links"
          aria-label={menuOpen ? 'Close site menu' : 'Open site menu'}
          onClick={() => setMenuOpen(open => !open)}
        >
          {menuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
    </header>
    <main className="guest-content">
      {route.name === 'partner'
        ? <PartnerScreen navigate={guestNavigate} showBuzzerCheck={showBuzzerCheck} />
        : route.name === 'salon'
          ? <SalonDetailScreen session={null} params={route.params} navigate={guestNavigate} notify={notify} />
          : ['about', 'faq', 'terms', 'privacy', 'contact'].includes(route.name)
            ? <InfoScreen type={route.name} navigate={guestNavigate} />
            : <HomeScreen session={null} navigate={guestNavigate} notify={notify} />}
      {/* The signed-out buzzer check lives on the page a tester can actually
          reach before an account exists — no login wall on iOS. */}
      {showBuzzerCheck && route.name !== 'partner' && <div className="guest-buzzer-test"><BuzzerTestCard notify={notify} /></div>}
    </main>
    {toast && <div className="toast-position"><div className={cx('toast', `toast-${toast.type || 'info'}`)} role="status"><span className="toast-mark">{toast.type === 'error' ? '!' : '✓'}</span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} /></button></div></div>}
  </div>;
}

function AuthFlow({ onComplete, notifyInstall, onBrowseBack = null, initialRole = 'USER' }) {
  // No splash view anymore — discovery is public and login is only shown when
  // the visitor actually needs an account, so the auth flow always opens here.
  const [view, setView] = useState('login');
  const [role, setRole] = useState(initialRole === 'SALON' ? 'SALON' : 'USER');
  const [salonAuthMode, setSalonAuthMode] = useState('login');
  const [salonRegistrationData, setSalonRegistrationData] = useState(null);
  const [step, setStep] = useState('phone');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [pushToken, setPushToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [alertSheet, setAlertSheet] = useState({ open: false, state: 'needs-permission', required: false });
  // A refused sign-in (the API asked for a deviceToken) is retried automatically
  // the moment the alerts sheet lands a token, so the visitor taps Allow once and
  // their OTP request just continues — no "now press Continue again".
  const retryAfterAlerts = useRef(null);
  // A visitor who dismissed the alerts card must not have the browser popup
  // fired at them by the Continue tap a moment later.
  const alertsDeclined = useRef(false);

  // The browser token, obtained without ever blocking the visitor.
  //
  // Gesture-safe by construction: Safari drops a permission popup that happens
  // after an `await`, so everything before the ask is synchronous — a cached
  // token from localStorage, the static `Notification.permission` snapshot, and
  // the sync install/frame gates. No `await` runs before `requestNotifications()`
  // is invoked, which is what keeps the submit tap's gesture alive so the Allow
  // popup actually appears. (An earlier version awaited a token mint and a live
  // permission read first, and the popup never showed — the "try again and not
  // getting any" report.)
  //
  //   1. A token already in hand (state or localStorage) → use it.
  //   2. Permission never asked → THIS IS THE ASK. The submit tap is the user
  //      gesture the browser wants, so its own Allow popup opens right here.
  //      The login page explains what alerts are for before this point, so the
  //      popup is never a surprise.
  //   3. Permission already granted but the token is missing (a slow worker, a
  //      reinstall) → mint it silently.
  //   4. Blocked, unsupported or an iPhone that needs the Home Screen install →
  //      no popup can help. Return '' and let sign-in continue; if the API
  //      insists on a token, the alerts sheet answers it with the exact fix.
  const prepareDeviceToken = useCallback(async ({ fresh = false } = {}) => {
    if (!isPushConfigured()) return '';
    if (pushToken && !fresh) return pushToken;
    if (alertsDeclined.current) return '';
    // Sync gates first — no await before the ask, so the gesture survives.
    if ((isIosDevice() && !isIosPwaInstalled()) || isEmbeddedFrame()) return '';
    const snapshot = (typeof Notification !== 'undefined' && Notification.permission) || 'default';
    if (snapshot === 'denied') return '';
    if (snapshot === 'default') {
      const granted = await requestNotifications();
      if (granted !== 'granted') return '';
      const token = await resolveDeviceToken({ patient: true });
      if (token) setPushToken(token);
      return token || '';
    }
    // Snapshot says granted (or the browser has no snapshot to give): mint the
    // LIVE token. The banked FCM_TOKEN is only used when Firebase cannot answer
    // right now — sending a stale token here is exactly how a salon ends up
    // with permission granted and no notifications.
    const token = await resolveDeviceToken();
    if (token) setPushToken(token);
    return token || '';
  }, [pushToken]);

  // Sign-in could not continue without a deviceToken. Say why in one line, show
  // the alerts sheet (which carries the exact fix for this device), and remember
  // the action so it runs itself as soon as alerts are on.
  const requireAlertsFor = async (retry, message = ALERTS_REQUIRED_MESSAGE) => {
    let state = 'needs-permission';
    try {
      const status = await getPushStatus();
      state = status.state;
      // Alerts are already on and a token exists: the refusal was stale (a
      // rotated token, a retry that ran before the mint finished). Bank it and
      // retry immediately instead of showing a sheet that says "turn alerts on".
      if (status.state === 'enabled' && status.token) {
        setPushToken(status.token);
        retry();
        return;
      }
    } catch (statusError) {
      console.debug(getErrorMessage(statusError, 'Could not read the notification status.'));
    }
    retryAfterAlerts.current = retry;
    setAlertSheet({ open: true, state, required: true });
    setError(
      state === 'denied' ? ALERTS_BLOCKED_MESSAGE
        // Permission granted, token still minting: telling the user to "turn on
        // booking alerts … choose Allow" would contradict the pop-up they just
        // answered.
        : state === 'unavailable' ? ALERTS_FINISHING_MESSAGE
          : state === 'unconfigured' ? ALERTS_UNCONFIGURED_MESSAGE
            : state === 'unsupported' ? ALERTS_UNSUPPORTED_MESSAGE
              : isIosDevice() && !isIosPwaInstalled() ? IOS_ALERTS_REQUIRED_MESSAGE
                : message,
    );
  };

  const handleAlertsGranted = (token) => {
    if (token) setPushToken(token);
    setError('');
    const retry = retryAfterAlerts.current;
    retryAfterAlerts.current = null;
    if (retry) retry();
  };

  const requestOtp = async event => {
    event.preventDefault();
    if (!/^\d{10}$/.test(mobile)) return setError('Enter a valid 10-digit mobile number.');
    setBusy(true);
    setError('');
    try {
      // Alerts are offered with the login card above; the submit tap is the last
      // natural place to ask (its gesture is fresh), and a "no" never stops the
      // OTP — the API decides whether it really needs a deviceToken.
      const deviceToken = await prepareDeviceToken();
      setPushToken(deviceToken);
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
      // The API refused because this device has no alerts token: answer with the
      // one-tap sheet (and retry this exact request once alerts are on) instead
      // of a dead-end error line.
      if (isDeviceTokenError(requestError)) await requireAlertsFor(() => requestOtp({ preventDefault() {} }));
      else setError(getErrorMessage(requestError, 'Could not send OTP. Please try again.'));
    } finally { setBusy(false); }
  };

  const verify = async event => {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit OTP.');
    setBusy(true); setError('');
    try {
      // The verify call is what the server stores the token from. Re-read the
      // live token here rather than trusting the one banked at the OTP step.
      const deviceToken = (await prepareDeviceToken({ fresh: true })) || pushToken;
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
    } catch (verifyError) {
      if (isDeviceTokenError(verifyError)) await requireAlertsFor(() => verify({ preventDefault() {} }));
      else setError(getErrorMessage(verifyError, 'That code did not work. Please try again.'));
    } finally { setBusy(false); }
  };

  const createAccount = async event => {
    event.preventDefault();
    if (!name.trim()) return setError('Tell us your name to finish setting up.');
    setBusy(true); setError('');
    try {
      const deviceToken = (await prepareDeviceToken({ fresh: true })) || pushToken;
      setPushToken(deviceToken);
      const response = await api.userOnBoard(withDeviceToken({ phoneNumber: mobile, fullName: name.trim() }, deviceToken));
      if (response?.status !== 'SUCCESS') throw new Error(response?.message || 'Could not create account.');
      if (!response.data?.token) throw new Error('Your account was created, but no login session was returned. Please try again.');
      onComplete({ role: 'USER', token: response.data.token, user: response.data, userId: response.data?.userId });
    } catch (createError) {
      if (isDeviceTokenError(createError)) await requireAlertsFor(() => createAccount({ preventDefault() {} }));
      else setError(getErrorMessage(createError, 'Could not create your account.'));
    } finally { setBusy(false); }
  };


  if (view === 'register') return <SalonRegistration initialData={salonRegistrationData} onBack={() => { setSalonRegistrationData(null); setView('login'); }} onComplete={onComplete} notifyInstall={notifyInstall} />;

  return <div className="auth-page login-page"><div className="auth-visual"><div className="auth-visual-image" /><div className="auth-image-shade" /><div className="auth-visual-content"><Brand light /><div><span className="eyebrow">SALON & GROOMING, REIMAGINED</span><h1>Less waiting.<br /><em>More you.</em></h1><p>Book a great salon nearby and make the time yours.</p></div><div className="visual-quote"><span></span><p>Your time is valuable. We’re here to give it back.</p></div></div></div><div className="auth-form-panel"><div className="mobile-auth-brand"><Brand /></div><div className="auth-form-wrap">{onBrowseBack && <button className="login-back" onClick={onBrowseBack}><ChevronRight size={15} className="rotate-180" /> Browse salons</button>}<span className="eyebrow">WELCOME TO MY NAAI</span><span className="login-hero-badge"><Sparkles size={12} /> {role === 'USER' ? 'Customer login' : 'Salon partner'}</span><h1>{step === 'phone' ? role === 'USER' ? 'Login to book your favorite salon' : 'Grow your salon with My Naai' : step === 'new-user' ? 'One last thing.' : 'Check your phone.'}</h1><p className="auth-subtitle">{step === 'phone' ? role === 'USER' ? 'Sign in and book your next visit.' : 'Sign in and never miss a booking.' : step === 'new-user' ? `Let\u2019s create your My Naai profile for +91 ${mobile}.` : `Enter the 6-digit code sent to +91 ${mobile}.`}</p>{step === 'phone' && <LoginPermissionCard className="login-perm-card" onToken={token => { if (token) { setPushToken(token); alertsDeclined.current = false; } }} onDismiss={() => { alertsDeclined.current = true; }} />}{step === 'phone' && <BuzzerTestCard className="login-buzzer-card" />}{step === 'phone' && <div className="login-actions"><InstallAppButton onInstall={notifyInstall} /></div>}{step === 'phone' && <div className="role-switch"><button className={role === 'USER' ? 'active' : ''} onClick={() => { setRole('USER'); setError(''); }}><CircleUserRound size={16} /> Customer</button><button className={role === 'SALON' ? 'active' : ''} onClick={() => { setRole('SALON'); setError(''); }}><Store size={16} /> Salon partner</button></div>}{error && <div className="form-error" role="alert"><Info size={16} />{error}</div>}{step === 'phone' && <form onSubmit={requestOtp}><Field label="Mobile number"><div className="phone-input"><span>+91</span><input inputMode="numeric" autoComplete="tel" maxLength="10" value={mobile} onChange={event => setMobile(event.target.value.replace(/\D/g, ''))} placeholder="Enter 10-digit number" autoFocus /></div></Field><Button type="submit" loading={busy}>Continue with OTP <ChevronRight size={17} /></Button></form>}{step === 'otp' && <form onSubmit={verify}><Field label="One-time password"><input className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ''))} placeholder="· · · · · ·" autoFocus /></Field><Button type="submit" loading={busy}>Verify code <ChevronRight size={17} /></Button><button className="resend-link" type="button" onClick={requestOtp}>Resend code</button><button className="back-form-link" type="button" onClick={() => { setStep('phone'); setOtp(''); setError(''); }}>Use a different number</button></form>}{step === 'new-user' && <form onSubmit={createAccount}><Field label="Your name"><input value={name} onChange={event => setName(event.target.value)} placeholder="How should we call you?" autoFocus /></Field><Button type="submit" loading={busy}>Create my account <ChevronRight size={17} /></Button></form>}</div><p className="auth-legal">By continuing, you agree to My Naai’s <button type="button" onClick={() => softNavigate('/terms')}>Terms &amp; Conditions</button> and <button type="button" onClick={() => softNavigate('/privacy-policy')}>Privacy Policy</button>.</p></div>
      <PermissionSheet
        open={alertSheet.open}
        state={alertSheet.state}
        required={alertSheet.required}
        onClose={() => { setAlertSheet(current => ({ ...current, open: false })); retryAfterAlerts.current = null; }}
        onGranted={handleAlertsGranted}
      />
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
  const [locationAllowed, setLocationAllowed] = useState(false);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registrationPushToken, setRegistrationPushToken] = useState(pushToken);
  const latestTokenRef = React.useRef(pushToken || '');
  const [error, setError] = useState('');
  useEffect(() => { latestTokenRef.current = registrationPushToken || pushToken || latestTokenRef.current; }, [registrationPushToken, pushToken]);
  // The salon pin is required, so it is asked in context — with a labelled tap
  // and never an automatic popup on arrival (that popup is what users answered
  // "Block" to). A device that has already granted location is filled in quietly.
  const detectLocation = useCallback(async () => {
    setLocationBusy(true);
    setLocationError('');
    try {
      const permission = await readPermission('location');
      if (permission === 'denied' || permission === 'unsupported') {
        setLocationError('Location is blocked for this site — open the steps and switch Location to Allow.');
        setLocationSheetOpen(true);
        return null;
      }
      const current = await getBrowserLocation();
      if (current) setLocationAllowed(true);
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
    if (latitude !== null || longitude !== null) return;
    readPermission('location').then(state => { if (state === 'granted') detectLocation(); });
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
      // Alerts are strongly recommended for a salon (the buzzer), but a blocked
      // browser must never trap a partner mid-signup: the plan step carries the
      // alerts card, and the API is the final judge.
      const token = await resolveDeviceToken();
      latestTokenRef.current = token || latestTokenRef.current;
      setRegistrationPushToken(token || registrationPushToken || pushToken);
      setStep('plans');
    } catch (businessError) {
      setError(getErrorMessage(businessError, 'We could not finish setup. Please try again.'));
    } finally { setBusy(false); }
  };
  if (step === 'plans') {
    const effectiveToken = registrationPushToken || latestTokenRef.current || pushToken;
    return <SubscriptionScreen params={{ registrationData: { ...profile, phoneNumber: mobile, tempToken, genderType: business.genderType, agentCode: business.agentCode, deviceToken: effectiveToken, latitude: Number(latitude), longitude: Number(longitude), businessHours: { openingTime: `${business.openingTime}:00`, closingTime: `${business.closingTime}:00`, breakStartTime: null, breakEndTime: null }, services: DEFAULT_SERVICES[business.genderType.toLowerCase()] || [] }, onBack }} notify={(type, message) => setError(message)} onAuthComplete={onComplete} />;
  }
  const title = step === 'profile' ? 'Tell us about you.' : 'Set up your day.';
  return <div className="auth-page registration-page"><div className="registration-back"><button className="icon-btn ghost" onClick={step === 'profile' ? onBack : () => setStep('profile')} aria-label="Go back"><ChevronRight size={19} className="rotate-180" /></button><Brand />{notifyInstall && <button className="install-auth-button registration-install-button" onClick={notifyInstall}><Download size={14} /> Install app</button>}</div><div className="registration-card"><div className="registration-progress"><span className="active" /><span className={step === 'business' ? 'active' : ''} /><span /><span /></div><span className="eyebrow">SALON PARTNER · STEP {step === 'profile' ? '2' : '3'} OF 3</span><h1>{title}</h1><p className="auth-subtitle">{step === 'profile' ? 'A few details help customers find you.' : 'Tell us when you are ready for your next customer.'}</p><NotificationSetupCard compact />{error && <div className="form-error"><Info size={16} />{error}</div>}{step === 'profile' && <form onSubmit={continueProfile}><Field label="Mobile number"><div className="phone-input"><span>+91</span><input inputMode="numeric" value={mobile} readOnly aria-label="Registered mobile number" /></div></Field><Field label="Owner name"><input value={profile.ownerName} onChange={event => setProfile(current => ({ ...current, ownerName: event.target.value }))} placeholder="Your full name" autoFocus /></Field><Field label="Salon name"><input value={profile.salonName} onChange={event => setProfile(current => ({ ...current, salonName: event.target.value }))} placeholder="What is your salon called?" /></Field><Field label="Address line 1"><textarea rows="3" value={profile.addressLine1} onChange={event => setProfile(current => ({ ...current, addressLine1: event.target.value }))} placeholder="Area, street, building" /></Field><Field label="Address line 2" hint="Optional"><input value={profile.addressLine2} onChange={event => setProfile(current => ({ ...current, addressLine2: event.target.value }))} placeholder="Landmark" /></Field><div className="form-two-col"><Field label="City"><input value={profile.city} onChange={event => setProfile(current => ({ ...current, city: event.target.value }))} placeholder="City" /></Field><SelectField label="State" value={profile.state} onChange={event => setProfile(current => ({ ...current, state: event.target.value }))} options={STATE_OPTIONS} placeholder="Select state" /></div><div className="form-two-col"><Field label="Pincode" hint="Optional"><input inputMode="numeric" maxLength="6" value={profile.pincode} onChange={event => setProfile(current => ({ ...current, pincode: event.target.value.replace(/\D/g, '').slice(0, 6) }))} placeholder="Pincode" /></Field><Field label="Email" hint="Optional"><input type="email" value={profile.email} onChange={event => setProfile(current => ({ ...current, email: event.target.value }))} placeholder="owner@example.com" /></Field></div><div className={cx('registration-location', latitude !== null && longitude !== null && 'ready')}><MapPin size={15} /><span>{latitude !== null && longitude !== null ? `Location ready · ${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}` : locationError || (locationAllowed ? 'Detecting salon location…' : 'Allow location so customers can find your salon nearby.')}</span><button type="button" onClick={detectLocation} disabled={locationBusy}>{locationBusy ? 'Detecting…' : locationAllowed ? 'Retry' : 'Allow location'}</button></div><PermissionSheet
          open={locationSheetOpen}
          kind="location"
          state="denied"
          onClose={() => setLocationSheetOpen(false)}
          onGranted={() => { setLocationSheetOpen(false); detectLocation(); }}
        /><Button type="submit">Next <ChevronRight size={17} /></Button></form>}{step === 'business' && <form onSubmit={continueBusiness}><label className="field"><span className="field-label">Salon type</span><div className="type-option-grid">{['MALE', 'FEMALE', 'UNISEX'].map(type => <button type="button" key={type} className={business.genderType === type ? 'active' : ''} onClick={() => setBusiness(current => ({ ...current, genderType: type }))}>{type === 'UNISEX' ? 'Unisex' : `${type.charAt(0)}${type.slice(1).toLowerCase()}`}</button>)}</div></label><div className="form-two-col"><Field label="Opens"><input type="time" value={business.openingTime} onChange={event => setBusiness(current => ({ ...current, openingTime: event.target.value }))} /></Field><Field label="Closes"><input type="time" value={business.closingTime} onChange={event => setBusiness(current => ({ ...current, closingTime: event.target.value }))} /></Field></div><Field label="Agent code" hint="Optional · exactly 10 digits"><input inputMode="numeric" maxLength="10" value={business.agentCode} onChange={event => setBusiness(current => ({ ...current, agentCode: event.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="Optional agent code" /></Field><Button type="submit" loading={busy}>Choose a plan <ChevronRight size={17} /></Button></form>}</div></div>;
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
  const utilityRoutes = ['detail', 'salon', 'services', 'schedule', 'notifications', 'delay', 'about', 'faq', 'terms', 'salonAbout', 'salonFaq', 'salonTerms', 'subscription', 'editProfile', 'bookingRequest'];
  const showBottomNav = primaryRoutes.includes(route.name);
  const [toast, setToast] = useState(null);
  const notify = useCallback((type, message) => { setToast({ type, message }); window.clearTimeout(notify.timer); notify.timer = window.setTimeout(() => setToast(null), 4000); }, []);
  // A new booking request is the one alert that asks for a decision, so it is
  // the one alert drawn as a card with buttons (and a countdown) instead of a
  // toast that disappears. See src/components/BookingRequestAlert.jsx.
  const [bookingAlert, setBookingAlert] = useState(null);
  // Booking request ids this shell has already surfaced (push, relay or poll).
  const seenRequestIds = useRef(new Set());
  const dismissBookingAlert = useCallback(() => setBookingAlert(null), []);
  const resolveBookingAlert = useCallback(() => {
    setBookingAlert(null);
    navigate('queue');
  }, [navigate]);
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
        // A foreground FCM message is the page's acknowledgement to the
        // service worker. Without this handshake Safari/iPadOS can suspend
        // onMessage and the worker has no way to know whether it is safe to
        // suppress the system notification fallback.
        try {
          const alertId = alertIdentity(message.data, message.type);
          const ack = { type: 'MYNAAI_PUSH_ACK', alertId };
          if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage(ack);
          else navigator.serviceWorker?.ready?.then(registration => registration.active?.postMessage(ack)).catch(() => {});
        } catch { /* notification delivery continues even without SW control */ }
        // An FCM message handed to this page is a live delivery: the arrival
        // stamp is now. The id is what makes a single alert ring once even when
        // the worker's broadcast and this handler both see it, and it is what
        // lets a second delivery of the same alert (a restored tab, a repeated
        // message) be recognised as one alert instead of a new one — see
        // claimAlertDelivery in src/lib/buzzer.js.
        const alertId = alertIdentity(message.data, message.type);
        const arrivedAt = Date.now();
        const actionable = isActionableNotification(message.type, session.role);
        // The arrival gate first, before anything is shown: a repeated or stale
        // delivery of one alert is not a new alert, and handling it again would
        // be a second banner, a second toast and a second navigation.
        if (!claimAlertDelivery({ alertId, sentAt: arrivedAt })) return;
        // …and then every notification makes a sound — not only the ones with
        // buttons. The buzzer picks its own sound from the type (the piercing
        // one for a booking request, the softer one for everything else), and
        // when this page cannot make a sound at all — audio never unlocked, a
        // muted tab — the device still does: the notification raised below
        // carries the system alert sound. The ring is therefore never allowed to
        // decide whether the alert is *shown*.
        playBuzzer({ type: message.type, alertId, sentAt: arrivedAt, claimed: true });
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
        // The Notifications tab refreshes its list on this, so a request that
        // arrives while the salon is looking at it appears with its countdown
        // and Accept / Reject / Delay buttons without a pull-to-refresh.
        try { window.dispatchEvent(new CustomEvent('mynaai:notification', { detail: { type: message.type, data: message.data } })); } catch { /* ignore */ }
        // A new booking request gets the actionable card: the mobile app's 60
        // seconds, the three answers, on whatever screen the salon is on. While
        // the plan is locked the card stays away — renewal is the only action
        // that screen allows, and the OS notification above still says a request
        // came in.
        if (String(session.role).toUpperCase() === 'SALON' && message.type === 'BOOKING_REQUEST') seenRequestIds.current.add(String(message.data.bookingRequestId || message.data.bookingId || ''));
        if (!isLocked && String(session.role).toUpperCase() === 'SALON' && message.type === 'BOOKING_REQUEST' && !isOnBookingRequestScreen(message.data.bookingRequestId)) {
          setBookingAlert({ data: message.data, sentAt: arrivedAt });
        }
        // Time-critical notification: the buzzer + vibration were already
        // sounded above, at the instant this message arrived — never here, where
        // it would be a second ring for the same alert. Informational messages
        // stay silent by design.
        // Suppress buzzer navigation when locked — renewal is the only focus.
        if (isLocked) return;
        if (!actionable) return;
        // On the Notifications tab the request is already in front of the salon
        // with its own Accept / Reject / Delay buttons (and the alert card is
        // docked below); yanking them to another screen would only lose the
        // list they were reading.
        if (routeName.current === 'notifications' && String(session.role).toUpperCase() === 'SALON' && message.type === 'BOOKING_REQUEST') return;
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

  // The server can only notify a token it knows. Sign-in sends one, but a token
  // allowed or rotated AFTER sign-in — the common web case — never reached the
  // API before, which is the "permission granted, no notification" report.
  useEffect(() => keepDeviceTokenSynced(sessionRef.current), [session.role, session.userId]);

  // A booking request that arrived while this app was in the background never
  // reached the handler above — Firebase hands a foreground message only to a
  // visible page. The worker rings the hidden tabs itself, with an arrival
  // envelope (alertId + sentAt), and that same message is what raises the
  // actionable card here: the salon switches back to the app and finds the
  // request waiting with whatever is left of its minute.
  useEffect(() => {
    if (String(session.role).toUpperCase() !== 'SALON') return undefined;
    const onDelivery = payload => {
      const data = payload?.data || {};
      const type = String(payload?.notificationType || data.type || '').toUpperCase();
      if (type !== 'BOOKING_REQUEST') return;
      const sentAt = Number(payload?.sentAt) || 0;
      // Only a live alert opens the card. A relay delivered late — a queued
      // channel message, a tab that was still loading — is not news any more.
      if (!sentAt || Date.now() - sentAt > BOOKING_ALERT_WINDOW_MS) return;
      seenRequestIds.current.add(String(data.bookingRequestId || data.bookingId || ''));
      if (isOnBookingRequestScreen(data.bookingRequestId)) return;
      setBookingAlert({ data, sentAt });
    };
    const onMessage = event => { if (event?.data?.type === 'MYNAAI_PLAY_BUZZER') onDelivery(event.data); };
    try { navigator.serviceWorker?.addEventListener('message', onMessage); } catch { /* no service worker */ }
    let channel = null;
    try {
      channel = new BroadcastChannel('mynaai-notifications');
      channel.addEventListener('message', onMessage);
    } catch { /* BroadcastChannel unsupported */ }
    return () => {
      try { navigator.serviceWorker?.removeEventListener('message', onMessage); } catch { /* ignore */ }
      try { channel?.close(); } catch { /* ignore */ }
    };
  }, [session.role]);

  // Belt and braces: the card above is raised by a push message. When that
  // message never reaches the page — a suspended tab, a throttled background
  // worker, a browser that drops foreground messages — the request still sits
  // in the salon's notification list. Poll that list while the app is visible
  // and raise the SAME card for a request that is still inside its minute and
  // has not already been handled here. It is a safety net, not the main path,
  // so it runs every 15 s, only for salons, and never while the plan is locked.
  useEffect(() => {
    if (!isSalon || !session.userId) return undefined;
    let cancelled = false;
    let timer = 0;
    const check = async () => {
      if (cancelled || document.visibilityState !== 'visible' || subscriptionGateRef.current === 'locked') return;
      try {
        const response = await api.salonNotificationList({ salonId: session.userId, page: 1 });
        const items = Array.isArray(response?.data) ? response.data : (response?.data?.notifications || response?.data?.notificationList || response?.data?.list || response?.data?.items || []);
        for (const item of items) {
          const type = String(item?.type || item?.notificationType || '').toUpperCase();
          if (type !== 'BOOKING_REQUEST') continue;
          const id = String(item.bookingRequestId || item.bookingId || item.booking_request_id || '');
          if (!id || seenRequestIds.current.has(id)) continue;
          const created = item.createdAt || item.created_at || item.timestamp || item.sentAt;
          let createdMs = created ? new Date(created).getTime() : 0;
          if (createdMs > 0 && createdMs < 1e12) createdMs *= 1000;
          if (!createdMs || Date.now() - createdMs > BOOKING_ALERT_WINDOW_MS) { seenRequestIds.current.add(id); continue; }
          seenRequestIds.current.add(id);
          if (routeName.current === 'notifications' || isOnBookingRequestScreen(id)) continue;
          if (!claimAlertDelivery({ alertId: `BOOKING_REQUEST:${id}`, sentAt: createdMs })) continue;
          playBuzzer({ type: 'BOOKING_REQUEST', alertId: `BOOKING_REQUEST:${id}`, sentAt: createdMs, claimed: true });
          setBookingAlert({ data: { ...item, type: 'BOOKING_REQUEST', bookingRequestId: id }, sentAt: createdMs });
          break;
        }
      } catch { /* the push path is still the main one */ }
    };
    const schedule = () => { timer = window.setInterval(check, 15000); };
    check();
    schedule();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [isSalon, session.userId]);

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
      if (route.name === 'detail' || route.name === 'salon') return <SalonDetailScreen {...props} params={route.params} />;
      if (route.name === 'services') return <ServicesScreen {...props} params={route.params} />;
      if (route.name === 'schedule') return <ScheduleScreen {...props} params={route.params} />;
      if (route.name === 'notifications') return <NotificationsScreen {...props} />;
      if (route.name === 'delay') return <DelayRequestScreen {...props} params={route.params} />;
      // Inside the signed-in shell the info pages keep an in-app back control;
      // the website versions (GuestShell) render without one.
      if (['about', 'faq', 'terms', 'privacy', 'contact'].includes(route.name)) return <InfoScreen type={route.name} navigate={navForScreens} showBack />;
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
  // Everything below is the APP, not the website: the screens shared with the
  // public site (home, salon page, About/FAQ/Terms/Privacy, Contact) drop their
  // marketing footer and review carousel here. See SurfaceProvider in Shared.jsx.
  return <SurfaceProvider value="app"><div className={cx('app-shell', isSalon && 'salon-shell', isSubscriptionGateScreen && 'subscription-gate-shell', !showBottomNav && 'utility-shell')}>
    {!isSubscriptionGateScreen && <Sidebar session={session} nav={nav} route={route} navigate={shellNavigate} onLogout={onLogout} notifyInstall={notifyInstall} />}
    <main className="workspace">
      {!isSubscriptionGateScreen && <MobileShellBar
        session={session}
        nav={nav}
        route={route}
        navigate={shellNavigate}
        onLogout={onLogout}
        notifyInstall={notifyInstall}
      />}
      <div className={cx('workspace-content', (isSubscriptionGateScreen || utilityRoutes.includes(route.name)) && 'utility-content', isSubscriptionGateScreen && 'subscription-gate-content')}>
        {isSubscriptionLocked && (
          <div className="subscription-lock-notice" role="alert">
            <CircleAlert size={17} />
            <span><strong>Your salon subscription has expired.</strong> Renew now to unlock your salon dashboard. Customers do not make payments here.</span>
            <button className="subscription-lock-logout" onClick={confirmSignOut} aria-label="Sign out"><LogOut size={14} /> Sign out</button>
          </div>
        )}
        {gateContent}
      </div>
    </main>
    {!isSubscriptionGateScreen && showBottomNav && <MobileNav nav={nav} route={route} navigate={shellNavigate} />}
    <div className="alert-dock">
      {toast && <div className={cx('toast', `toast-${toast.type || 'info'}`)} role="status"><span className="toast-mark">{toast.type === 'error' ? '!' : '✓'}</span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss"><X size={15} /></button></div>}
      {isSalon && bookingAlert && <BookingRequestAlert key={`${bookingAlert.data?.bookingRequestId || ''}:${bookingAlert.sentAt}`} alert={bookingAlert} notify={notify} navigate={shellNavigate} onDone={resolveBookingAlert} onDismiss={dismissBookingAlert} />}
    </div>
  </div></SurfaceProvider>;
}

// The one moment My Naai shows a splash before its shell: an *installed* app
// starting with no session of its own, while it looks for the account the
// browser (or the previous container) already signed in. It resolves in
// milliseconds; without it the user sees a login form, taps nothing, and is let
// into the app a moment later — which reads as "it logged me out".
// Is the salon already looking at this very request? The request screen shows
// the same details, the same countdown and the same three answers, so a card on
// top of it would be a second copy of one alert — and answering the card would
// also navigate away from the screen the owner deliberately opened.
function isOnBookingRequestScreen(bookingRequestId) {
  if (typeof window === 'undefined') return false;
  try {
    if (!window.location.pathname.endsWith('/bookingRequest')) return false;
    const showing = new URLSearchParams(window.location.search).get('bookingRequestId') || '';
    return !showing || !bookingRequestId || showing === String(bookingRequestId);
  } catch {
    return false;
  }
}

function SessionRestoreSplash() {
  return <div className="subscription-gate-loading" role="status" aria-live="polite">
    <div className="subscription-gate-mark"><Sparkles size={22} /></div>
    <h1>Welcome back to My Naai</h1>
    <p>Checking the account already signed in on this device…</p>
    <Spinner label="Restoring your session…" />
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

// The in-app top bar for phones and tablets (the sidebar takes over at 1024px).
//
// It used to be a brand + a bell and nothing else, which left two holes:
//   1. No menu. Below 1024px there is no sidebar, and the bottom nav only
//      renders on the four primary routes — so every utility screen (salon
//      detail, schedule, notifications, subscription, the profile editor…) had
//      NO navigation at all on an iPad. The hamburger fixes that: every route,
//      Sign out and Install now live one tap away at every width.
//   2. The bell had no real hit area and no accessible state.
// `.mobile-menu-button` existed in the stylesheet for this control but was
// never rendered — this is that button, finally wired up.
function MobileShellBar({ session, nav, route, navigate, onLogout, notifyInstall }) {
  const isSalon = session.role === 'SALON';
  const [menuOpen, setMenuOpen] = useState(false);
  const barRef = useRef(null);
  const confirm = useConfirm();
  // Close on navigation (including browser back/forward), on Escape and on any
  // tap outside the bar — a drawer that outlives its tap is a trap.
  useEffect(() => { setMenuOpen(false); }, [route.name, route.params?.salonId]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = event => { if (event.key === 'Escape') setMenuOpen(false); };
    const onPointerDown = event => { if (!barRef.current?.contains(event.target)) setMenuOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDown); };
  }, [menuOpen]);
  const go = name => { setMenuOpen(false); navigate(name); };
  const signOut = async () => { setMenuOpen(false); if (await confirm(LOGOUT_CONFIRM)) onLogout?.(); };
  const notificationsActive = route.name === 'notifications';
  return <div className={cx('mobile-shell-bar', menuOpen && 'menu-open')} ref={barRef}>
    <Brand />
    <div className="mobile-shell-actions">
      <button
        className={cx('notification-button', notificationsActive && 'active')}
        aria-label="Notifications"
        aria-current={notificationsActive ? 'page' : undefined}
        onClick={() => go('notifications')}
      >
        <Bell size={18} />
        <span className="notification-ping" />
      </button>
      <button
        type="button"
        className="mobile-menu-button"
        aria-expanded={menuOpen}
        aria-controls="app-shell-menu"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        onClick={() => setMenuOpen(open => !open)}
      >
        {menuOpen ? <X size={19} /> : <Menu size={19} />}
      </button>
    </div>
    <nav className="mobile-shell-menu" id="app-shell-menu" aria-label="App navigation">
      <span className="mobile-shell-menu-role">{isSalon ? <Store size={14} /> : <Scissors size={14} />}{isSalon ? 'Salon partner' : 'Customer'}</span>
      {nav.map(item => (
        <button key={item.name} className={cx(route.name === item.name && 'active')} aria-current={route.name === item.name ? 'page' : undefined} onClick={() => go(item.name)}>
          <item.icon size={18} /><span>{item.label}</span>
        </button>
      ))}
      <button className={cx(notificationsActive && 'active')} aria-current={notificationsActive ? 'page' : undefined} onClick={() => go('notifications')}>
        <Bell size={18} /><span>Notifications</span>
      </button>
      {notifyInstall && <button onClick={() => { setMenuOpen(false); notifyInstall(); }}><Download size={18} /><span>Install My Naai</span></button>}
      <button className="mobile-shell-menu-logout" onClick={signOut}><LogOut size={18} /><span>Sign out</span></button>
    </nav>
  </div>;
}

// Bottom-bar labels are SHORT versions of the sidebar labels, not string
// surgery on them. The old code did `.replace('Customer ', '').replace('My ', '')`
// on the nav label, which chopped the capital off the front of the word and
// shipped a lowercase "bookings" / "queue" sitting next to "Discover",
// "Products" and "Account" — visible on every phone and tablet. Each nav entry
// now carries its own `short` label and the bar just renders it.
function MobileNav({ nav, route, navigate }) { return <nav className="mobile-nav">{nav.map(item => <button key={item.name} className={route.name === item.name ? 'active' : ''} aria-current={route.name === item.name ? 'page' : undefined} onClick={() => navigate(item.name)}><item.icon size={20} /><span>{item.short || item.label}</span></button>)}</nav>; }

function PartnerInfo({ type, navigate }) { const content = type === 'about' ? SALON_ABOUT_CONTENT : type === 'faq' ? SALON_FAQ_CONTENT : SALON_TERMS_CONTENT; return <div className="screen info-screen"><div className="page-header"><div className="page-header-leading"><button className="icon-btn ghost" onClick={() => navigate(-1)} aria-label="Go back"><ChevronRight size={19} className="rotate-180" /></button><div><span className="eyebrow">{content.eyebrow}</span><h1>{content.title}</h1></div></div></div><div className="info-intro"><Sparkles size={18} /><p>{content.intro || 'Everything you need to know about partnering with My Naai.'}</p></div><div className="info-sections">{content.sections.map(section => <section key={section.title}><h2>{section.title}</h2><p>{section.text}</p></section>)}</div><div className="info-contact"><span className="info-contact-icon"><HelpCircle size={18} /></span><div><strong>Need more help?</strong><p>Call our partner team on 8380017393</p></div><button onClick={() => window.open('tel:8380017393')}><ChevronRight size={17} /></button></div></div>; }
