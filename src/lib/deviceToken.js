import { api } from './api';
import * as push from './push';
import { clearLoginToken, clearSyncedStamp, readDeviceTokenSync as readSyncRecord, readLoginToken, readSyncedStamp, syncStamp, writeLoginToken, writeSyncedStamp } from './deviceTokenSync';

// The event lib/push fires when a token lands (its PUSH_TOKEN_EVENT). Read
// lazily, and by name, so a test that mocks lib/push partially still works.
const TOKEN_EVENT = 'mynaai:push-token';

// Keeping the server's copy of this browser's FCM token current.
//
// The API learns a device token in exactly one place today: the `deviceToken`
// field of OTP login / onboarding. That is fine on a phone, where the token
// exists before anyone signs in. In a browser it is the common failure behind
// "permission is granted but no notification arrives":
//
//   · the salon signed in first and allowed notifications afterwards (from the
//     Account card, or the browser's own prompt) — the server has no token;
//   · the token rotated (Firebase does this; a re-installed PWA does too) — the
//     server keeps sending to a token that no longer exists;
//   · the salon signed in on the laptop, so the server's one token is the
//     laptop's, and the phone in the shop hears nothing.
//
// This module posts the live token to the server whenever it changes for the
// signed-in account, so the next booking request reaches THIS device. The
// endpoint is the one docs/FIREBASE-WEB-PUSH.md §4 asks the backend for
// (`backend/registerDevice.js` is the drop-in handler). A server that does not
// have it yet answers 404, which is remembered for the session so the portal
// does not keep knocking — and nothing here ever blocks the UI or shows an
// error the user cannot act on.

const UNSUPPORTED_KEY = 'mynaai:register-device-unsupported';

const readSynced = readSyncedStamp;
const writeSynced = writeSyncedStamp;

function endpointUnsupported() {
  try { return sessionStorage.getItem(UNSUPPORTED_KEY) === '1'; } catch { return false; }
}

function rememberUnsupported() {
  try { sessionStorage.setItem(UNSUPPORTED_KEY, '1'); } catch { /* storage blocked */ }
}

export { syncStamp };
// The last sync this browser completed, for the diagnostics card.
export const readDeviceTokenSync = readSyncRecord;
export function clearDeviceTokenSync() {
  clearSyncedStamp();
  clearLoginToken();
}

// Called by the auth flow with the token that was actually put in the login
// request. Nothing else may write this: it is the server's copy, as far as
// this browser knows.
export function rememberLoginToken(session, token) {
  writeLoginToken(token);
  if (session && token) writeSyncedStamp(syncStamp(session, token));
}

// Fired on `window` when this device's token no longer matches the one the
// backend has, and the quiet re-sync could not fix it. The shell signs the
// user out with an explanation so the next login registers the new token.
export const TOKEN_CHANGED_EVENT = 'mynaai:device-token-changed';

// Has the server been told about THIS token for THIS account? True when the
// login carried it, or a later sync succeeded.
export function serverHasToken(session, token) {
  if (!token) return true; // nothing to compare — the permission path reports that
  if (readLoginToken() === token) return true;
  return readSyncedStamp() === syncStamp(session, token);
}

// The one decision this module makes: the live token is not the one the
// backend has. A browser tab → installed app move is the textbook case: the
// PWA has its own push subscription, so its token is new, while the session
// it inherited still points the backend at the old browser token.
//
// The backend only reliably learns a token at login, so when we KNOW the
// token changed (a login token was banked and the live one differs), the
// answer is a fresh login — not a profile update whose effect we cannot
// verify. Guard rails, so this can never lock anyone out:
//   · no banked login token (a session from before this shipped, or a login
//     that could not read a token yet) → never sign out; just sync quietly;
//   · at most ONE sign-out per token, remembered in storage, so a login that
//     again cannot read the token cannot loop;
//   · nothing here depends on the network, so being offline changes nothing.
const RELOGIN_ASKED_KEY = 'mynaai:relogin-asked-for-token';

function reloginAskedFor(token) {
  try { return localStorage.getItem(RELOGIN_ASKED_KEY) === token; } catch { return false; }
}

function rememberReloginAsked(token) {
  try { localStorage.setItem(RELOGIN_ASKED_KEY, token); } catch { /* storage blocked */ }
}

// While the salon is answering a booking request (the 60-second card or the
// request screen) a sign-out would cost them the booking. The shell holds the
// re-login until that is over; the next focus/token event re-checks.
let reloginHeld = false;
export function holdRelogin(held) { reloginHeld = Boolean(held); }

async function reconcileToken(session, token, { notifyChange }) {
  if (serverHasToken(session, token)) return 'ok';
  const previous = readLoginToken();
  if (previous && previous !== token && !reloginAskedFor(token)) {
    if (reloginHeld) return 'held';
    rememberReloginAsked(token);
    notifyChange?.({ token, previous, reason: 'token-changed' });
    return 'changed';
  }
  // No baseline to compare with (or we already asked once for this token):
  // hand the token over quietly and leave the user signed in either way.
  await syncDeviceToken(session, token, { force: true });
  return 'synced';
}

// Send `token` for `session` unless the server already has exactly that pair.
// Resolves to 'synced' | 'skipped' | 'unsupported' | 'failed'.
export async function syncDeviceToken(session, token, { force = false } = {}) {
  if (!session?.userId || !token) return 'skipped';
  const stamp = syncStamp(session, token);
  if (!force && readSynced() === stamp) return 'skipped';
  const role = String(session.role || '').toUpperCase();
  const ok = response => !response?.status || response.status === 'SUCCESS';
  // 1. The dedicated endpoint, when the backend has it.
  if (!endpointUnsupported()) {
    try {
      const response = await api.registerDevice({ deviceToken: token, platform: 'web', userType: role, userId: session.userId });
      if (ok(response)) { writeSynced(stamp); return 'synced'; }
    } catch (error) {
      if (error?.status === 404 || error?.status === 405) rememberUnsupported();
      else return 'failed';
    }
  }
  // 2. The profile-update endpoints the mobile app already uses. Both write
  //    whatever columns they are given, including `deviceToken` — the same
  //    column login writes — so this keeps the server current on a backend
  //    that has not added register-device yet.
  try {
    const response = role === 'SALON'
      ? await api.updateSalonProfile({ salonId: session.userId, deviceToken: token })
      : await api.updateProfile({ userId: session.userId, deviceToken: token });
    if (!ok(response)) return 'failed';
    writeSynced(stamp);
    return 'synced';
  } catch {
    return 'failed';
  }
}

// Called once per signed-in session: mints (or reads) the token when the
// permission is already granted and syncs it, then keeps syncing whenever the
// token changes while the session lives. Returns an unsubscribe function.
export function keepDeviceTokenSynced(session) {
  let configured = false;
  try { configured = Boolean(push.isPushConfigured?.()); } catch { configured = false; }
  if (typeof window === 'undefined' || !configured || !session?.userId) return () => {};
  let cancelled = false;
  const notifyChange = detail => {
    try { window.dispatchEvent(new CustomEvent(TOKEN_CHANGED_EVENT, { detail })); } catch { /* ignore */ }
  };
  const sync = token => { if (!cancelled && token) reconcileToken(session, token, { notifyChange }).catch(() => {}); };
  const onToken = event => sync(event?.detail?.token);
  window.addEventListener(TOKEN_EVENT, onToken);
  const mint = async () => {
    try {
      if (typeof push.readNotificationPermission === 'function' && (await push.readNotificationPermission()) !== 'granted') return;
      const token = typeof push.getPushToken === 'function' ? await push.getPushToken({ requestPermission: false }) : '';
      sync(token);
    } catch { /* the quiet retries in lib/push announce the token later */ }
  };
  mint();
  // Tokens can rotate while the tab sits open for days in a salon; re-check
  // whenever the app comes back to the front.
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    mint();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    cancelled = true;
    window.removeEventListener(TOKEN_EVENT, onToken);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
