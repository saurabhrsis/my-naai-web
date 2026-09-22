// The record of the last (account, token) pair this browser handed the server.
// Split from deviceToken.js so lib/push (diagnostics) can read it without
// importing the API client — deviceToken.js imports push, so the other way
// round would be a cycle.
const SYNC_KEY = 'FCM_TOKEN_SYNCED';

export function syncStamp(session, token) {
  return `${String(session?.role || '').toUpperCase()}:${session?.userId || ''}:${token || ''}`;
}

export function readSyncedStamp() {
  try { return localStorage.getItem(SYNC_KEY) || ''; } catch { return ''; }
}

export function writeSyncedStamp(value) {
  try { localStorage.setItem(SYNC_KEY, value); } catch { /* storage blocked */ }
}

export function clearSyncedStamp() {
  try { localStorage.removeItem(SYNC_KEY); } catch { /* storage blocked */ }
}

export function readDeviceTokenSync() {
  const value = readSyncedStamp();
  if (!value) return null;
  const [role, userId, ...rest] = value.split(':');
  return { role, userId, token: rest.join(':') };
}

// The token the backend was handed AT LOGIN (verify / onboard / create-salon)
// for this session. This is the one the server sends to, so it is the value
// every later comparison is made against.
const LOGIN_KEY = 'FCM_TOKEN_LOGIN';

export function writeLoginToken(token) {
  try { if (token) localStorage.setItem(LOGIN_KEY, String(token)); else localStorage.removeItem(LOGIN_KEY); } catch { /* storage blocked */ }
}

export function readLoginToken() {
  try { return localStorage.getItem(LOGIN_KEY) || ''; } catch { return ''; }
}

export function clearLoginToken() {
  try { localStorage.removeItem(LOGIN_KEY); } catch { /* storage blocked */ }
}
