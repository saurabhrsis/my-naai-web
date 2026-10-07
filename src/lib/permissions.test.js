import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ASK_CHOICES,
  androidAppNotificationHint,
  androidLocationHint,
  browserLabel,
  buzzerHint,
  detectAndroidVendor,
  detectBrowser,
  alertsPromptFallback,
  canAskForAlerts,
  clearPendingAsk,
  detectInAppBrowser,
  frameAllowsFeature,
  hiddenPromptHint,
  inAppBrowserHint,
  isCrossOriginEmbeddedFrame,
  isDeviceTokenError,
  isIosPwaInstalled,
  openInOwnTabForAsk,
  ownTabAskUrl,
  promptsAvailable,
  PENDING_ASK_PARAM,
  pendingAskKind,
  permissionSteps,
  readAskChoice,
  readPermission,
  rememberAskChoice,
  requestLocation,
  requestNotifications,
  watchPermission,
} from './permissions';
import { withCrossOriginFrame, withSameOriginFrame } from '../test/frame';

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

    it('never downgrades a granted notification permission to prompt (iOS Home Screen apps)', async () => {
      // Reported from an installed iPhone app: the Allow popup was answered and
      // `Notification.permission` said "granted", while Safari's Permissions API
      // kept answering "prompt" — so the portal kept insisting "turn on booking
      // alerts" and never minted a token. A real grant from either source wins.
      setLivePermission('prompt');
      globalThis.Notification = { permission: 'granted' };
      expect(await readPermission('notifications')).toBe('granted');
      // …and a genuine block reported live is still a block.
      setLivePermission('denied');
      globalThis.Notification = { permission: 'granted' };
      expect(await readPermission('notifications')).toBe('denied');
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

  describe('requestLocation', () => {
    it('keeps an Android device-level location failure distinct from a site block', async () => {
      const originalGeolocation = navigator.geolocation;
      navigator.geolocation = {
        getCurrentPosition: vi.fn((_success, fail) => fail({ code: 2, message: 'Location service disabled' })),
      };
      try {
        await expect(requestLocation()).resolves.toMatchObject({ ok: false, state: 'device-settings', code: 2 });
      } finally {
        navigator.geolocation = originalGeolocation;
      }
    });

    it('calls the native geolocation API from a tap even when the frame policy will deny it', async () => {
      const originalGeolocation = navigator.geolocation;
      const getCurrentPosition = vi.fn((_success, fail) => fail({ code: 1, message: 'Blocked by frame policy' }));
      navigator.geolocation = { getCurrentPosition };
      Object.defineProperty(document, 'permissionsPolicy', {
        value: { allowsFeature: () => false },
        configurable: true,
      });
      try {
        await expect(requestLocation()).resolves.toMatchObject({ ok: false, state: 'denied', code: 1 });
        expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      } finally {
        navigator.geolocation = originalGeolocation;
        delete document.permissionsPolicy;
      }
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

    it('survives a Permissions API that throws instead of rejecting', () => {
      // Chrome throws SecurityError SYNCHRONOUSLY when a frame it was not
      // delegated the feature asks for `geolocation` — every page inside another
      // page, previews included. Uncaught, that throw escaped a useEffect and
      // React unmounted the whole app: the page rendered nothing at all. A
      // watcher is optional, so the only acceptable answer is "no live updates".
      const query = vi.fn(() => { throw new Error('SecurityError: geolocation is not allowed in this frame'); });
      Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true });
      const handler = vi.fn();
      let unsubscribe = () => {};
      expect(() => { unsubscribe = watchPermission('location', handler); }).not.toThrow();
      expect(typeof unsubscribe).toBe('function');
      expect(() => unsubscribe()).not.toThrow();
      // The same guard covers the notifications watcher every card installs.
      expect(() => watchPermission('notifications', handler)).not.toThrow();
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns a no-op unsubscribe when the Permissions API is unavailable', () => {
      expect(typeof watchPermission('location', () => {})).toBe('function');
    });
  });

  describe('the new-tab escape hatch', () => {
    it('opens this page as its own tab, marked with the permission to ask for', () => {
      window.history.replaceState({}, '', '/login');
      const openSpy = vi.spyOn(window, 'open').mockReturnValue({});
      try {
        expect(openInOwnTabForAsk('notifications')).toBe(true);
        expect(openSpy).toHaveBeenCalledTimes(1);
        const url = new URL(openSpy.mock.calls[0][0], window.location.origin);
        expect(url.pathname).toBe('/login'); // the same page, not another site
        expect(url.searchParams.get(PENDING_ASK_PARAM)).toBe('notifications');
      } finally {
        openSpy.mockRestore();
      }
    });

    it('says so when the browser blocks the tab instead of pretending it worked', () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      try {
        expect(openInOwnTabForAsk('location')).toBe(false);
      } finally {
        openSpy.mockRestore();
      }
    });

    it('reads the pending ask from the URL, and only for a permission we ask for', () => {
      window.history.replaceState({}, '', '/?mynaai-ask=location');
      expect(pendingAskKind()).toBe('location');
      window.history.replaceState({}, '', '/?mynaai-ask=notifications');
      expect(pendingAskKind()).toBe('notifications');
      // A stranger's query string is not an instruction to ask for anything.
      window.history.replaceState({}, '', '/?mynaai-ask=camera');
      expect(pendingAskKind()).toBe('');
      window.history.replaceState({}, '', '/login');
      expect(pendingAskKind()).toBe('');
    });

    it('gives back the full address so a blocked popup still has a way out', () => {
      window.history.replaceState({}, '', '/login?x=1');
      const url = new URL(ownTabAskUrl('notifications'), window.location.origin);
      // The app's own address, same page — not a different site, not a bare host.
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get(PENDING_ASK_PARAM)).toBe('notifications');
      expect(url.searchParams.get('x')).toBe('1'); // nothing already here is lost
    });

    it('drops the marker once read — a reload never asks again', () => {
      window.history.replaceState({}, '', '/login?mynaai-ask=notifications');
      expect(pendingAskKind()).toBe('notifications');
      clearPendingAsk();
      expect(window.location.search).toBe('');
      expect(window.location.pathname).toBe('/login');
      expect(pendingAskKind()).toBe('');
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
      ['ios-chrome', 'ios-firefox', 'ios-edge'].forEach(browser => {
        expect(permissionSteps(browser, 'notifications').join(' ')).toMatch(/Safari → Share → Add to Home Screen/);
      });
    });

    it('includes the Android app-level switch that keeps the site setting stuck', () => {
      ['chrome-android', 'samsung'].forEach(browser => {
        expect(permissionSteps(browser, 'notifications').join(' ')).toContain('Settings → Apps');
      });
    });

    it('explains how the buzzer is heard on each device', () => {
      expect(buzzerHint('chrome-android')).toContain('off silent');
      expect(buzzerHint('samsung')).toContain('off silent');
      expect(buzzerHint('chrome-desktop')).toContain('not muted');
    });

    it('names the Android app-level setting only on Android browsers', () => {
      expect(androidAppNotificationHint('chrome-android')).toContain('Android Settings');
      expect(androidAppNotificationHint('samsung')).toContain('Android Settings');
      expect(androidAppNotificationHint('chrome-desktop')).toBe('');
    });
  });

  // The WebView case: WhatsApp, Instagram, Facebook and friends open links in
  // their own browser, where LOCATION still prompts but NOTIFICATIONS can never
  // prompt. Telling those visitors about browser settings would be useless.
  describe('in-app browsers', () => {
    const withUserAgent = (agent, run) => {
      const spy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
      try {
        run();
      } finally {
        spy.mockRestore();
      }
    };

    it('names the app whose browser the visitor is stuck in', () => {
      withUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 WhatsApp/2.24.9', () => {
        expect(detectInAppBrowser()).toBe('WhatsApp');
      });
      withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 320.0.0.0', () => {
        expect(detectInAppBrowser()).toBe('Instagram');
      });
      withUserAgent('Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 [FB_IAB/FB4A;FBAV/430.0.0.0] Chrome/116 Mobile Safari/537.36', () => {
        expect(detectInAppBrowser()).toBe('Facebook');
      });
      withUserAgent('Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36; wv)', () => {
        expect(detectInAppBrowser()).toBe('an app');
      });
      withUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36', () => {
        expect(detectInAppBrowser()).toBe('');
      });
      withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', () => {
        expect(detectInAppBrowser()).toBe('');
      });
    });

    it('sends the visitor to a real browser instead of browser settings', () => {
      withUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 WhatsApp/2.24.9', () => {
        expect(inAppBrowserHint()).toContain('WhatsApp');
        expect(alertsPromptFallback()).toContain('Open mynaai.in in Chrome or Safari');
      });
    });

    it('picks the most specific fallback for each context, in order', () => {
      // 1. an app's WebView wins over everything else it could blame.
      withUserAgent('Mozilla/5.0 (Linux; Android 13) WhatsApp/2.24.9 Chrome/124.0 Mobile Safari/537.36', () => {
        expect(alertsPromptFallback()).toContain('built-in browser');
      });
      // 2. an iPhone tab cannot ask at all — the Home Screen step is the answer.
      withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1', () => {
        expect(alertsPromptFallback()).toContain('Home Screen');
        expect(canAskForAlerts()).toBe(false);
      });
      // 3. an ordinary desktop Chrome can ask.
      withUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', () => {
        expect(canAskForAlerts()).toBe(true);
        expect(alertsPromptFallback()).toContain('bell');
      });
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

    it('points a silent Chromium prompt at the address-bar bell, and says nothing on iPhone', () => {
      withUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', () => {
        expect(hiddenPromptHint()).toContain('bell');
      });
      withUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', () => {
        expect(hiddenPromptHint()).toContain('Permissions');
      });
      withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1', () => {
        // iPhone has the Home Screen rule instead — never a "look for a bell" line.
        expect(hiddenPromptHint()).toBe('');
      });
    });

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
      withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1', () => {
        expect(detectBrowser()).toBe('ios-chrome');
        expect(browserLabel('ios-chrome')).toBe('Chrome on iPhone/iPad');
      });
      withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/120.0 Mobile/15E148 Safari/605.1.15', () => {
        expect(detectBrowser()).toBe('ios-firefox');
      });
      withUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 EdgiOS/120.0 Mobile/15E148 Safari/605.1.15', () => {
        expect(detectBrowser()).toBe('ios-edge');
      });
    });

    it('recognises OPPO and Vivo model/browser hints and gives OEM recovery steps', () => {
      withUserAgent('Mozilla/5.0 (Linux; Android 14; CPH2581) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36', () => {
        expect(detectAndroidVendor()).toBe('oppo');
        expect(androidLocationHint('chrome-android')).toContain('OPPO');
        expect(androidAppNotificationHint('chrome-android')).toContain('Auto-launch');
      });
      withUserAgent('Mozilla/5.0 (Linux; Android 14; V2312) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36', () => {
        expect(detectAndroidVendor()).toBe('vivo');
        expect(androidLocationHint('chrome-android')).toContain('Vivo');
        expect(androidAppNotificationHint('chrome-android')).toContain('Auto-start');
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

  // Whether a permission popup can appear at all. An embedded page gets told
  // 'denied' by the browser even when the visitor has blocked nothing, so this
  // question has to be answered separately from the permission itself.
  describe('frameAllowsFeature / promptsAvailable', () => {
    afterEach(() => { delete document.permissionsPolicy; delete document.featurePolicy; });

    it('trusts the effective permissions policy for a directive the browser knows', () => {
      const allowsFeature = vi.fn(feature => feature !== 'geolocation');
      Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature }, configurable: true });

      expect(frameAllowsFeature('geolocation')).toBe(false);
      expect(promptsAvailable('location')).toBe(false);
      // jsdom is not a frame, so the notification ask stays available.
      expect(promptsAvailable('notifications')).toBe(true);
      // The location flow must ask about geolocation, never about notifications.
      expect(allowsFeature.mock.calls.every(call => call[0] === 'geolocation')).toBe(true);
    });

    it('never reads an unknown feature name as a block on a normal page', () => {
      // Exactly what Chrome does to `allowsFeature('notifications')`: the
      // Notifications API has no Permissions Policy directive (whatwg/notifications#177),
      // so the name is missing from the browser's `features()` list and the call
      // answers false — on the live site too. Reading that as "blocked here" is
      // what made an ordinary tab announce "This preview cannot show the
      // notifications prompt. Try the live site."
      Object.defineProperty(document, 'permissionsPolicy', {
        value: {
          features: () => ['geolocation', 'camera', 'microphone'],
          allowedFeatures: () => ['geolocation', 'camera', 'microphone'],
          allowsFeature: () => false,
        },
        configurable: true,
      });

      expect(frameAllowsFeature('notifications')).toBe(true);
      expect(promptsAvailable('notifications')).toBe(true);
      // A name the browser DOES support and refuses is still a real block.
      expect(frameAllowsFeature('camera')).toBe(false);
      expect(promptsAvailable('location')).toBe(false);
    });

    it('uses the frame for the notification ask: cross-origin blocks it, same-origin does not', async () => {
      // No browser implements a `notifications` policy directive, so the frame
      // itself is the only rule left for that API.
      await withSameOriginFrame(async () => {
        expect(isCrossOriginEmbeddedFrame()).toBe(false);
        expect(promptsAvailable('notifications')).toBe(true);
      });
      await withCrossOriginFrame(async () => {
        expect(isCrossOriginEmbeddedFrame()).toBe(true);
        expect(promptsAvailable('notifications')).toBe(false);
      });
    });

    it('falls back to the older featurePolicy name', () => {
      Object.defineProperty(document, 'featurePolicy', { value: { allowsFeature: () => false }, configurable: true });
      expect(frameAllowsFeature('geolocation')).toBe(false);
    });

    it('assumes a normal page when the browser exposes no policy API', () => {
      // jsdom exposes neither object: not embedded, so prompts are available.
      expect(frameAllowsFeature('geolocation')).toBe(true);
      expect(promptsAvailable('location')).toBe(true);
      expect(promptsAvailable('notifications')).toBe(true);
    });

    it('treats a policy object that throws as unavailable, not as allowed', () => {
      Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature: () => { throw new Error('nope'); } }, configurable: true });
      // Not embedded in jsdom, so the frame fallback still allows it here — the
      // point is that a throw never becomes an unhandled error.
      expect(() => frameAllowsFeature('geolocation')).not.toThrow();
      expect(frameAllowsFeature('geolocation')).toBe(true);
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
