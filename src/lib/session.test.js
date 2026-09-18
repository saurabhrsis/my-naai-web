import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SESSION_CACHE,
  SESSION_CACHE_URL,
  clearStoredSession,
  persistSession,
  readLocalSession,
  restoreSession,
  setNotificationApiBase,
  writeLocalSession,
} from './session';

// A tiny stand-in for CacheStorage: the module only ever uses open/put/match/
// delete, and this is the channel that carries a session from the browser into
// an app installed afterwards (the one thing iOS shares between the two).
function fakeCaches(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    open: vi.fn(async name => ({
      put: async (url, response) => { store.set(`${name}|${url}`, response); },
      match: async url => store.get(`${name}|${url}`) || undefined,
      delete: async url => store.delete(`${name}|${url}`),
    })),
  };
}

class FakeResponse {
  constructor(body) { this.body = body; }
  async json() { return JSON.parse(this.body); }
}

const SESSION = { token: 'jwt-token', role: 'SALON', user: { salonName: 'Fade Room', salonId: 'salon-1' } };

let caches;
const originalCaches = globalThis.caches;
const originalResponse = globalThis.Response;

beforeEach(() => {
  localStorage.clear();
  caches = fakeCaches();
  globalThis.caches = caches;
  globalThis.Response = FakeResponse;
  setNotificationApiBase('https://backend.mynaai.in');
});

afterEach(() => {
  localStorage.clear();
  if (originalCaches === undefined) delete globalThis.caches; else globalThis.caches = originalCaches;
  if (originalResponse === undefined) delete globalThis.Response; else globalThis.Response = originalResponse;
});

describe('the local (synchronous) copy', () => {
  it('round-trips a session and reads it back the way every screen does', () => {
    expect(writeLocalSession(SESSION)).toBe(true);
    const read = readLocalSession();
    expect(read.token).toBe('jwt-token');
    expect(read.role).toBe('SALON');
    expect(read.user.salonName).toBe('Fade Room');
    expect(read.userId).toBe('salon-1');
  });

  it('repairs a session that lost its companion flags instead of asking for a login', () => {
    // Storage pressure, a partial write, an older build: the token and the role
    // are what prove the session. `isLoggedIn` going missing must never cost a
    // user their session.
    localStorage.setItem('mynaai', JSON.stringify({ token: 'jwt-token' }));
    localStorage.setItem('userType', 'USER');
    expect(localStorage.getItem('isLoggedIn')).toBeNull();

    const read = readLocalSession();
    expect(read.role).toBe('USER');
    expect(localStorage.getItem('isLoggedIn')).toBe('true');
  });

  it('is not fooled into thinking a bare profile is a session', () => {
    localStorage.setItem('mynaaiUser', JSON.stringify({ userId: 'user-1' }));
    expect(readLocalSession()).toBeNull();
  });
});

describe('the shared copies', () => {
  it('mirrors the session into the shared cache an installed app reads', async () => {
    await persistSession(SESSION);
    const stored = caches.store.get(`${SESSION_CACHE}|${SESSION_CACHE_URL}`);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored.body).token).toBe('jwt-token');
  });

  it('restores a session from the cache when localStorage is empty (the iOS install case)', async () => {
    // Safari signs in, the cache mirror is written, and then the user installs
    // the app. The installed app's localStorage starts empty — the cache is
    // shared, so this is where the session comes back from.
    await persistSession(SESSION);
    localStorage.clear();

    const restored = await restoreSession();
    expect(restored.token).toBe('jwt-token');
    expect(restored.role).toBe('SALON');
    // …and the fast copy is rewritten, so the next read is synchronous again.
    expect(readLocalSession().token).toBe('jwt-token');
  });

  it('finds nothing on a device that never signed in', async () => {
    expect(await restoreSession()).toBeNull();
    expect(readLocalSession()).toBeNull();
  });

  it('forgets every copy on sign-out — an installed app must not resurrect it', async () => {
    await persistSession(SESSION);
    await clearStoredSession();

    expect(readLocalSession()).toBeNull();
    expect(localStorage.getItem('mynaai')).toBeNull();
    expect(caches.store.get(`${SESSION_CACHE}|${SESSION_CACHE_URL}`)).toBeUndefined();
    expect(await restoreSession()).toBeNull();
  });

  it('ignores an unrelated cached response', async () => {
    globalThis.caches = fakeCaches({ [`${SESSION_CACHE}|${SESSION_CACHE_URL}`]: new FakeResponse('{"nonsense":true}') });
    expect(await restoreSession()).toBeNull();
  });
});

describe('storage that refuses to cooperate', () => {
  it('still returns the session for this visit when the browser blocks writes', () => {
    const throwOnWrite = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', { value: throwOnWrite, configurable: true });
    try {
      expect(() => writeLocalSession(SESSION)).not.toThrow();
      expect(writeLocalSession(SESSION)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
    }
  });

  it('survives a browser without IndexedDB or CacheStorage', async () => {
    delete globalThis.caches;
    // jsdom's IndexedDB stub (`{ open: vi.fn() }`) makes `open()` return
    // undefined — the guard in session.js has to treat that as "no IndexedDB"
    // rather than throwing out of the sign-in path.
    await expect(persistSession(SESSION)).resolves.toMatchObject({ token: 'jwt-token' });
    expect(readLocalSession().token).toBe('jwt-token');
  });
});
