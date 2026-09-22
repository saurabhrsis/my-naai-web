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
