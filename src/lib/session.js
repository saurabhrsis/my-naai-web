// The durable My Naai session store.
//
// Why this exists — the install problem
// -------------------------------------
// "I signed in, installed the app, and it asked me to sign in again."
//
// A session lives in localStorage, and localStorage belongs to ONE browser
// container. On Android and desktop an installed PWA *is* the same container as
// the browser (a WebAPK shares Chrome's profile), so the sign-in carries over by
// itself. On iOS it does not: an app added to the Home Screen gets its own Web
// Storage, its own IndexedDB and its own cookie jar, so the installed app starts
// as a brand-new visitor even though Safari is signed in.
//
// The one thing iOS *does* share between Safari and an installed web app is the
// service-worker registration and the CacheStorage that goes with it (WebKit has
// shared both since iOS 14). So the session is written to three places:
//
//   · localStorage  — the fast, synchronous copy every screen reads;
//   · CacheStorage  — the copy that survives the browser→installed-app
//                     container switch on iOS, which is what makes "install and
//                     stay signed in" work there;
//   · IndexedDB     — the copy the notification service worker reads for the
//                     Accept / Reject / Delay actions, plus a third safety net
//                     for a browser that dropped one of the other two.
//
// On boot the app asks localStorage first, then IndexedDB, then the cache, and
// adopts whatever it finds — re-writing localStorage, IndexedDB and the cache so
// the next read is the fast synchronous one again. Signing out clears all three,
// so an installed app can never resurrect a session the user ended.
//
// Nothing here is allowed to throw. Safari in private mode (and a browser with
// storage full or disabled) throws on localStorage writes, and the old code let
// that exception escape the sign-in handler — the user saw "could not sign you
// in" and was asked to log in again, which is the very report this module fixes.

import { flagIsFalse, flagIsTrue } from './flags';

// The keys the rest of the portal already reads (kept exactly as they are so
// every screen, the SW's IndexedDB mirror and older builds stay compatible).
export const SESSION_TOKEN_KEY = 'mynaai';
export const SESSION_USER_KEY = 'mynaaiUser';
export const SESSION_ROLE_KEY = 'userType';
export const SESSION_LOGGED_IN_KEY = 'isLoggedIn';
export const SESSION_NEW_SALON_KEY = 'isNewSalon';
export const SESSION_KEYS = [SESSION_TOKEN_KEY, SESSION_USER_KEY, SESSION_LOGGED_IN_KEY, SESSION_ROLE_KEY, SESSION_NEW_SALON_KEY];

// CacheStorage: the cross-container channel. The entry is never fetched over the
// network — it is a synthetic URL we put and read ourselves, so the worker's
// fetch handler never sees it.
export const SESSION_CACHE = 'mynaai-session-v1';
export const SESSION_CACHE_URL = '/__mynaai/session';

// IndexedDB: shared with the notification worker. `auth` holds the token the
// worker posts to the API from a notification action; `session` holds the whole
// session so a container that lost localStorage can recover the account too.
export const AUTH_DB_NAME = 'mynaai-notification-actions';
export const AUTH_DB_STORE = 'auth';
export const AUTH_DB_ID = 'auth';
export const SESSION_DB_ID = 'session';

function localStore() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // A browser that blocks storage access entirely.
    return null;
  }
}

function readStoredToken(store) {
  const value = store.getItem(SESSION_TOKEN_KEY);
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return parsed?.token || '';
  } catch {
    // Some older builds wrote the bare token string.
    return value;
  }
}

function readStoredUser(store) {
  try {
    const parsed = JSON.parse(store.getItem(SESSION_USER_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// A session is a token plus the role it belongs to. Nothing else is required:
// the companion flags are a convenience the app repairs, never a gate. Reading
// them as a gate is what sent a signed-in user back to the OTP screen when one
// of the five keys had failed to write.
export function normalizeSession(value) {
  if (!value || typeof value !== 'object') return null;
  const token = String(value.token || '');
  const role = String(value.role || '').toUpperCase();
  if (!token || !role) return null;
  const user = value.user && typeof value.user === 'object' ? value.user : {};
  const userId = value.userId || user.userId || user.salon?.salonId || user.salonId || user.id || '';
  const incompleteSalon = role === 'SALON'
    && (flagIsTrue(user.isNewSalon) || flagIsFalse(user.profileCompleted) || flagIsFalse(user.salon?.profileCompleted));
  return { token, role, user, userId, isNewSalon: Boolean(value.isNewSalon) || incompleteSalon };
}

// The synchronous read every render path uses.
export function readLocalSession() {
  const store = localStore();
  if (!store) return null;
  const session = normalizeSession({
    token: readStoredToken(store),
    role: store.getItem(SESSION_ROLE_KEY),
    user: readStoredUser(store),
    isNewSalon: store.getItem(SESSION_NEW_SALON_KEY) === 'true',
  });
  if (!session) return null;
  // A session that lost one of its companion keys (a partial write, storage
  // pressure, an older build) is still a session. Put the missing keys back so
  // every other reader in the app agrees this device is signed in.
  if (store.getItem(SESSION_LOGGED_IN_KEY) !== 'true' || !store.getItem(SESSION_ROLE_KEY)) {
    writeLocalSession(session);
  }
  return session;
}

// Never throws: a browser that refuses the write still keeps the session for
// this page's lifetime through the caller's React state.
export function writeLocalSession(session) {
  const normalized = normalizeSession(session);
  if (!normalized) return false;
  const store = localStore();
  if (!store) return false;
  try {
    store.setItem(SESSION_TOKEN_KEY, JSON.stringify({ token: normalized.token }));
    store.setItem(SESSION_USER_KEY, JSON.stringify(normalized.user || {}));
    store.setItem(SESSION_ROLE_KEY, normalized.role);
    store.setItem(SESSION_LOGGED_IN_KEY, 'true');
    store.setItem(SESSION_NEW_SALON_KEY, normalized.isNewSalon ? 'true' : 'false');
    return true;
  } catch (error) {
    console.debug('My Naai could not save the session to this browser\'s storage; you stay signed in for this visit only.', error);
    return false;
  }
}

export function clearLocalSession() {
  const store = localStore();
  if (!store) return;
  try {
    SESSION_KEYS.forEach(key => store.removeItem(key));
  } catch {
    // ignore
  }
}

function openAuthDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB?.open) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    let request;
    try {
      request = indexedDB.open(AUTH_DB_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }
    // jsdom and a browser with storage disabled both hand back something that
    // is not a request object; treat that as "no IndexedDB" instead of
    // throwing a TypeError out of the sign-in path.
    if (!request || typeof request !== 'object' || !('onsuccess' in request || 'onerror' in request)) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTH_DB_STORE)) db.createObjectStore(AUTH_DB_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(mode, run) {
  return openAuthDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(AUTH_DB_STORE, mode);
    const request = run(tx.objectStore(AUTH_DB_STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// The API base travels with the mirrored token so the worker can post an
// Accept/Reject/Delay to the same server this build talks to (a staging build
// must not silently call production). `src/lib/api.js` owns that value and hands
// it over at import time — the other way round would be an import cycle.
let notificationApiBase = '';
export function setNotificationApiBase(value) {
  notificationApiBase = String(value || '');
}

// The notification worker cannot read localStorage, so the token it needs to
// perform Accept/Reject/Delay from a closed app is mirrored here (same origin).
export async function writeNotificationAuth(token, apiBaseUrl = notificationApiBase) {
  if (!token) return;
  try {
    await withStore('readwrite', store => store.put({ id: AUTH_DB_ID, token, apiBaseUrl }));
  } catch {
    // Non-fatal: the action buttons fall back to the in-app screen.
  }
}

export async function clearNotificationAuth() {
  try {
    await withStore('readwrite', store => store.delete(AUTH_DB_ID));
  } catch {
    // ignore
  }
}

function writeIndexedDbSession(session) {
  return withStore('readwrite', store => store.put({
    id: SESSION_DB_ID,
    token: session.token,
    role: session.role,
    user: session.user,
    isNewSalon: session.isNewSalon,
    savedAt: Date.now(),
  }));
}

async function readIndexedDbSession() {
  try {
    const record = await withStore('readonly', store => store.get(SESSION_DB_ID));
    return normalizeSession(record);
  } catch {
    return null;
  }
}

function cacheApi() {
  try {
    return typeof caches !== 'undefined' && caches?.open ? caches : null;
  } catch {
    return null;
  }
}

async function writeCacheSession(session) {
  const api = cacheApi();
  if (!api) return;
  try {
    const cache = await api.open(SESSION_CACHE);
    await cache.put(SESSION_CACHE_URL, new Response(JSON.stringify(session), {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch {
    // CacheStorage is a bonus channel: a browser that refuses it still has the
    // other two copies.
  }
}

async function readCacheSession() {
  const api = cacheApi();
  if (!api) return null;
  try {
    const cache = await api.open(SESSION_CACHE);
    const response = await cache.match(SESSION_CACHE_URL);
    if (!response) return null;
    return normalizeSession(await response.json());
  } catch {
    return null;
  }
}

// Called on every sign-in and every profile write: the session has to be in the
// shared copies *before* the user installs the app, because the installed app
// cannot go back and ask the browser for them.
export async function persistSession(session) {
  const normalized = normalizeSession(session);
  if (!normalized) return null;
  writeLocalSession(normalized);
  await Promise.all([
    writeIndexedDbSession(normalized).catch(() => {}),
    writeCacheSession(normalized),
    writeNotificationAuth(normalized.token),
  ]);
  return normalized;
}

// Adopt a session found outside localStorage (an installed iOS app reading the
// cache Safari wrote, or a browser that lost one of its three copies).
export async function adoptSession(session) {
  const normalized = normalizeSession(session);
  if (!normalized) return null;
  writeLocalSession(normalized);
  await Promise.all([
    writeIndexedDbSession(normalized).catch(() => {}),
    writeCacheSession(normalized),
    writeNotificationAuth(normalized.token).catch(() => {}),
  ]);
  return normalized;
}

// The boot lookup: IndexedDB first (fast, already used by the worker), then the
// shared cache. Returns null when this really is a device with no session.
export async function restoreSession() {
  const fromIndexedDb = await readIndexedDbSession();
  if (fromIndexedDb) return adoptSession(fromIndexedDb);
  const fromCache = await readCacheSession();
  if (fromCache) return adoptSession(fromCache);
  return null;
}

export async function clearStoredSession() {
  clearLocalSession();
  await Promise.all([
    withStore('readwrite', store => store.delete(SESSION_DB_ID)).catch(() => {}),
    clearNotificationAuth(),
    (async () => {
      const api = cacheApi();
      if (!api) return;
      try {
        const cache = await api.open(SESSION_CACHE);
        await cache.delete(SESSION_CACHE_URL);
      } catch {
        // ignore
      }
    })(),
  ]);
}
