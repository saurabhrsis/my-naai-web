import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ASK_CHOICES,
  androidAppNotificationHint,
  browserLabel,
  detectBrowser,
  isDeviceTokenError,
  isIosPwaInstalled,
  permissionSteps,
  readAskChoice,
  readPermission,
  rememberAskChoice,
  requestNotifications,
  watchPermission,
} from './permissions';

// The permission plumbing behind every "I allowed it but the app still says
// blocked" report. These tests pin the three guarantees the UI relies on:
//   1. the LIVE permission is what is read (the static snapshot lies after a
//      user flips the setting back on in browser settings);
//   2. the browser API is called synchronously inside `requestNotifications()`,
//      so Safari keeps the user gesture and actually shows its popup;
//   3. a deviceToken refusal from the API is recognisable, and an auth-token
//      error is NOT mistaken for one.
describe('permissions', () => {
  const originalNotification = globalThis.Notification;
  const originalPermissions = navigator.permissions;

  const setLivePermission = state => {
    // The Permissions API is what the browser's own settings UI writes to.
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(async () => ({ state, onchange: null })) },
    });
  };

  beforeEach(() => {
    delete navigator.permissions;
    localStorage.clear();
  });

  afterEach(() => {
    if (originalNotification) globalThis.Notification = originalNotification;
    else delete globalThis.Notification;
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: originalPermissions });
    vi.restoreAllMocks();
  });

  describe('readPermission', () => {
    it('prefers the live Permissions API value and maps prompt to default', async () => {
      setLivePermission('prompt');
      globalThis.Notification = { permission: 'denied' };
      expect(await readPermission('notifications')).toBe('default');
    });

    it('reports the live granted state even when the static snapshot still says denied', async () => {
      // The exact case that used to strand users: they unblocked the site in
      // browser settings, the page kept the stale "denied" snapshot, and every
      // alert control stayed stuck until a reload.
      setLivePermission('granted');
      globalThis.Notification = { permission: 'denied' };
      expect(await readPermission('notifications')).toBe('granted');
    });

    it('falls back to the static snapshot when the Permissions API is missing', async () => {
      globalThis.Notification = { permission: 'granted' };
      expect(await readPermission('notifications')).toBe('granted');
    });

    it('falls back when the Permissions API query rejects', async () => {
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: { query: vi.fn(async () => { throw new Error('Not supported'); }) },
      });
      globalThis.Notification = { permission: 'default' };
      expect(await readPermission('notifications')).toBe('default');
    });

    it('reports unsupported when the browser has no Notification API at all', async () => {
      delete globalThis.Notification;
      expect(await readPermission('notifications')).toBe('unsupported');
    });
  });

  describe('requestNotifications', () => {
    it('calls the browser API synchronously so the tap gesture survives', () => {
      // Safari drops a requestPermission() that happens after an await. The
      // promise below must already have called the stub before this line runs.
      const requestPermission = vi.fn(() => Promise.resolve('granted'));
      globalThis.Notification = { permission: 'default', requestPermission };
      const pending = requestNotifications();
      expect(requestPermission).toHaveBeenCalledTimes(1);
      return pending;
    });

    it('answers with what the browser recorded, not the stale snapshot', async () => {
      setLivePermission('granted');
      globalThis.Notification = { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('default')) };
      expect(await requestNotifications()).toBe('granted');
    });

    it('reports a refusal and a dismissal distinctly', async () => {
      globalThis.Notification = { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('denied')) };
      expect(await requestNotifications()).toBe('denied');
      globalThis.Notification = { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('default')) };
      expect(await requestNotifications()).toBe('default');
    });

    it('handles the legacy callback-only Safari form', async () => {
      globalThis.Notification = {
        permission: 'default',
        requestPermission: vi.fn(() => undefined),
      };
      expect(await requestNotifications()).toBe('default');
    });
  });

  describe('watchPermission', () => {
    it('calls back on a live change and detaches on unsubscribe', async () => {
      const status = { state: 'denied', onchange: null };
      Object.defineProperty(navigator, 'permissions', {
        configurable: true,
        value: { query: vi.fn(async () => status) },
      });
      const handler = vi.fn();
      const unsubscribe = watchPermission('notifications', handler);
      await Promise.resolve();
      expect(typeof status.onchange).toBe('function');

      status.state = 'granted';
      status.onchange();
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      expect(status.onchange).toBeNull();
    });

    it('returns a no-op unsubscribe when the Permissions API is unavailable', () => {
      expect(typeof watchPermission('location', () => {})).toBe('function');
    });
  });

  describe('ask memory', () => {
    it('remembers and clears what the visitor chose', () => {
      expect(readAskChoice('location')).toBe('');
      rememberAskChoice('location', ASK_CHOICES.never);
      expect(readAskChoice('location')).toBe('never');
      rememberAskChoice('location', '');
      expect(readAskChoice('location')).toBe('');
    });
  });

  describe('permissionSteps', () => {
    it('always gives short steps that name the right permission', () => {
      ['chrome-android', 'chrome-desktop', 'samsung', 'firefox', 'edge', 'opera', 'ios-safari', 'ios-chrome', 'safari-desktop', 'other'].forEach(browser => {
        const notificationSteps = permissionSteps(browser, 'notifications');
        const locationSteps = permissionSteps(browser, 'location');
        expect(notificationSteps.length).toBeLessThanOrEqual(3);
        expect(locationSteps.length).toBeLessThanOrEqual(3);
        expect(notificationSteps.join(' ')).toMatch(/Notification|notification|Allow/);
        expect(locationSteps.join(' ')).toMatch(/Location|location|Allow/);
      });
    });

    it('sends iPhone users to the Home Screen instead of a popup that never appears', () => {
      expect(permissionSteps('ios-safari', 'notifications').join(' ')).toContain('Home Screen');
    });

    it('names the Android app-level setting only on Android browsers', () => {
      expect(androidAppNotificationHint('chrome-android')).toContain('Android Settings');
      expect(androidAppNotificationHint('samsung')).toContain('Android Settings');
      expect(androidAppNotificationHint('chrome-desktop')).toBe('');
    });
  });

  describe('detectBrowser', () => {
    const withUserAgent = (agent, run) => {
      const spy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
      try {
        run();
      } finally {
        spy.mockRestore();
      }
    };

    it('names the browser a blocked user has to open settings in', () => {
      withUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', () => {
        expect(detectBrowser()).toBe('chrome-android');
        expect(browserLabel('chrome-android')).toBe('Chrome on Android');
      });
      withUserAgent('Mozilla/5.0 (Linux; Android 13) SamsungBrowser/23.0 Chrome/115 Mobile Safari/537.36', () => {
        expect(detectBrowser()).toBe('samsung');
      });
      withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1', () => {
        expect(detectBrowser()).toBe('ios-safari');
      });
    });

    it('treats an installed iOS web app as installed', () => {
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = () => ({ matches: true });
      const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1');
      expect(isIosPwaInstalled()).toBe(true);
      agent.mockRestore();
      window.matchMedia = originalMatchMedia;
    });
  });

  describe('isDeviceTokenError', () => {
    it('recognises the API refusing for a missing device token', () => {
      expect(isDeviceTokenError({ data: { message: '"deviceToken" is required' } })).toBe(true);
      expect(isDeviceTokenError(new Error('device token is missing'))).toBe(true);
      expect(isDeviceTokenError({ message: 'deviceToken must not be empty' })).toBe(true);
    });

    it('never mistakes an auth/session error for one', () => {
      expect(isDeviceTokenError(new Error('Invalid token'))).toBe(false);
      expect(isDeviceTokenError(new Error('Session token expired'))).toBe(false);
      expect(isDeviceTokenError(new Error('Invalid OTP'))).toBe(false);
      expect(isDeviceTokenError(undefined)).toBe(false);
    });
  });
});
