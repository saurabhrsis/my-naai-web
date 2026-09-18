import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Firebase browser SDK does not run under node/jsdom; stub the entry points so
// the module import itself (and the feature-detection gates) stay safe.
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve('')), isSupported: vi.fn(() => Promise.resolve(false)),
  deleteToken: vi.fn(() => Promise.resolve()), onMessage: vi.fn(),
}));

// push.js reads env vars; provide stable fixtures.

import {
  isPushConfigured,
  getPushToken,
  readPushTokenFailure,
  describePushTokenFailure,
  bookingRequestActions,
  notificationActionLimit,
  notificationTag,
  normalizePushPayload,
  isActionableNotification,
  getNotificationRoute,
  formatPushDiagnostics,
  readNotificationPermission,
  watchNotificationPermission,
  isEmbeddedFrame,
  getPushStatus,
  resetPushRegistration,
} from './push';

beforeEach(() => {
  localStorage.clear();
  window.Notification.permission = 'granted';
});

afterEach(() => {
  resetPushRegistration();
  try { delete window.navigator.permissions; } catch { /* never assigned */ }
  try { delete window.navigator.serviceWorker; } catch { /* never assigned */ }
});

describe('isPushConfigured', () => {
  it('is true when all required Firebase values are set', () => {
    expect(isPushConfigured()).toBe(true);
  });
});

describe('bookingRequestActions', () => {
  it('returns Accept / Reject / Delay in that order, sized to what this browser renders', () => {
    const actions = bookingRequestActions();
    expect(actions.map(a => a.action)).toEqual(['ACCEPT_BOOKING', 'REJECT_BOOKING', 'DELAY_BOOKING'].slice(0, notificationActionLimit()));
    expect(actions.length).toBeGreaterThan(0);
  });

  it('never asks a laptop for the third button it will silently drop', () => {
    // Chromium on a laptop renders two actions; Android renders three. Asking
    // for three on a laptop is how one of the two usable buttons disappears.
    const original = Object.getOwnPropertyDescriptor(Notification, 'maxActions');
    try {
      Object.defineProperty(Notification, 'maxActions', { configurable: true, value: 2 });
      expect(bookingRequestActions().map(a => a.title)).toEqual(['Accept', 'Reject']);
      Object.defineProperty(Notification, 'maxActions', { configurable: true, value: 3 });
      expect(bookingRequestActions().map(a => a.title)).toEqual(['Accept', 'Reject', 'Delay']);
    } finally {
      if (original) Object.defineProperty(Notification, 'maxActions', original);
      else delete Notification.maxActions;
    }
  });
});

describe('notificationTag', () => {
  it('is the booking request id, so the request screen can close the banner it raised', () => {
    expect(notificationTag({ bookingRequestId: 'req-7', type: 'BOOKING_REQUEST' })).toBe('req-7');
    expect(notificationTag({ bookingId: 'bk-9' })).toBe('bk-9');
  });

  it('falls back to the alert type, and never to an empty tag', () => {
    expect(notificationTag({}, 'DELAY_BOOKING')).toBe('DELAY_BOOKING');
    expect(notificationTag({}, '')).toBe('mynaai-notification');
  });
});

describe('normalizePushPayload', () => {
  it('merges notification + data blocks', () => {
    const result = normalizePushPayload({
      notification: { title: 'T', body: 'B' },
      data: { type: 'BOOKING_REQUEST', bookingRequestId: '42' },
    });
    expect(result.title).toBe('T');
    expect(result.body).toBe('B');
    expect(result.type).toBe('BOOKING_REQUEST');
    expect(result.data.bookingRequestId).toBe('42');
    expect(result.hasData).toBe(true);
  });

  it('handles data-only messages', () => {
    const result = normalizePushPayload({ data: { title: 'X', type: 'DELAY_TIME_PROPOSAL' } });
    expect(result.title).toBe('X');
    expect(result.type).toBe('DELAY_TIME_PROPOSAL');
  });

  it('falls back to defaults for empty payload', () => {
    const result = normalizePushPayload({});
    expect(result.title).toBe('My Naai update');
    expect(result.type).toBe('');
  });

  it('reads click_action into type', () => {
    const result = normalizePushPayload({ notification: { title: 'A', click_action: 'BOOKING_REQUEST' } });
    expect(result.type).toBe('BOOKING_REQUEST');
  });
});

describe('isActionableNotification', () => {
  it('salon handles BOOKING_REQUEST / DELAY_BOOKING', () => {
    expect(isActionableNotification('BOOKING_REQUEST', 'SALON')).toBe(true);
    expect(isActionableNotification('DELAY_BOOKING', 'SALON')).toBe(true);
    expect(isActionableNotification('BOOKING_CONFIRMED', 'SALON')).toBe(false);
  });
  it('customer handles DELAY_TIME_PROPOSAL', () => {
    expect(isActionableNotification('DELAY_TIME_PROPOSAL', 'USER')).toBe(true);
    expect(isActionableNotification('BOOKING_REQUEST', 'USER')).toBe(false);
  });
  it('a time the salon already moved is informational, not an action', () => {
    // A confirmed booking moved from the queue: the customer is told, not asked.
    expect(isActionableNotification('BOOKING_TIME_UPDATED', 'USER')).toBe(false);
  });
});

describe('getNotificationRoute', () => {
  const cases = [
    [{ type: 'DELAY_TIME_PROPOSAL', bookingRequestId: '9', delayMinutes: '10' }, 'USER', 'delay'],
    [{ type: 'BOOKING_CONFIRMED' }, 'USER', 'bookings'],
    [{ type: 'BOOKING_REJECTED' }, 'USER', 'bookings'],
    [{ type: 'DELAY_RESPONSE' }, 'USER', 'bookings'],
    [{ type: 'BOOKING_REQUEST', bookingRequestId: '5' }, 'SALON', 'bookingRequest'],
    [{ type: 'DELAY_BOOKING', bookingRequestId: '5' }, 'SALON', 'bookingRequest'],
  ];
  it.each(cases)('routes %s / role %s to %s', (data, role, expected) => {
    const route = getNotificationRoute(data, role);
    expect(route.name).toBe(expected);
  });

  it('openDelayModal set for DELAY_BOOKING', () => {
    const route = getNotificationRoute({ type: 'DELAY_BOOKING', bookingRequestId: '5' }, 'SALON');
    expect(route.params.openDelayModal).toBe('true');
  });

  it('defaults to home/queue when unknown', () => {
    expect(getNotificationRoute({ type: 'WEIRD' }, 'USER').name).toBe('home');
    expect(getNotificationRoute({ type: 'WEIRD' }, 'SALON').name).toBe('queue');
  });
});

describe('formatPushDiagnostics', () => {
  it('renders each check line', () => {
    const out = formatPushDiagnostics({ checks: [
      { state: 'ok', label: 'HTTPS', value: 'Yes' },
      { state: 'fail', label: 'Token', value: 'Empty', detail: 'missing' },
    ]});
    expect(out).toContain('OK · HTTPS: Yes');
    expect(out).toContain('FAIL · Token: Empty — missing');
  });
});

// The whole reason "I allowed it — Check" used to keep saying Blocked:
// `Notification.permission` is a snapshot from page load, while the
// Permissions API carries the live value the browser settings UI writes to.
describe('readNotificationPermission', () => {
  it('keeps a genuine grant even while the Permissions API still says prompt', async () => {
    // The iPhone Home Screen app report: the Allow popup was answered, and
    // `Notification.permission` said granted, while Safari's Permissions API
    // kept answering 'prompt'. Downgrading that to 'default' is what made the
    // portal keep saying "turn on booking alerts" after alerts were already on.
    window.Notification.permission = 'granted';
    window.navigator.permissions = { query: vi.fn(() => Promise.resolve({ state: 'prompt' })) };
    await expect(readNotificationPermission()).resolves.toBe('granted');
  });

  it('reports the live granted state even when the static snapshot is still denied', async () => {
    window.Notification.permission = 'denied';
    window.navigator.permissions = { query: vi.fn(() => Promise.resolve({ state: 'granted' })) };
    await expect(readNotificationPermission()).resolves.toBe('granted');
  });

  it('falls back to Notification.permission when the Permissions API is missing', async () => {
    window.Notification.permission = 'denied';
    await expect(readNotificationPermission()).resolves.toBe('denied');
  });

  it('falls back when the Permissions API query rejects', async () => {
    window.Notification.permission = 'granted';
    window.navigator.permissions = { query: vi.fn(() => Promise.reject(new Error('unsupported name'))) };
    await expect(readNotificationPermission()).resolves.toBe('granted');
  });
});

describe('watchNotificationPermission', () => {
  it('calls back on a live change and detaches on unsubscribe', async () => {
    const status = { onchange: null };
    window.navigator.permissions = { query: vi.fn(() => Promise.resolve(status)) };
    const callback = vi.fn();
    const unsubscribe = watchNotificationPermission(callback);
    await Promise.resolve(); // let the query promise settle and attach onchange
    status.onchange?.();
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(status.onchange).toBeNull();
  });

  it('returns a no-op unsubscribe when the Permissions API is unavailable', () => {
    expect(typeof watchNotificationPermission(() => {})).toBe('function');
  });
});

describe('isEmbeddedFrame', () => {
  it('is false in a normal top-level page', () => {
    expect(isEmbeddedFrame()).toBe(false);
  });

  it('is true when the page is inside an iframe', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'top');
    Object.defineProperty(window, 'top', { value: { notTheSameWindow: true }, configurable: true });
    try {
      expect(isEmbeddedFrame()).toBe(true);
    } finally {
      if (original) Object.defineProperty(window, 'top', original);
      else delete window.top;
    }
  });
});

describe('getPushStatus permission reads', () => {
  it('reports denied from the live permission while the static snapshot still says granted', async () => {
    const { isSupported } = await import('firebase/messaging');
    vi.mocked(isSupported).mockResolvedValueOnce(true);
    window.navigator.serviceWorker = {};
    window.Notification.permission = 'granted';
    window.navigator.permissions = { query: vi.fn(() => Promise.resolve({ state: 'denied' })) };
    const status = await getPushStatus();
    expect(status.state).toBe('denied');
  });

  it('keeps the familiar denied state inside an iframe, with the embedded explanation in the reason', async () => {
    const { isSupported } = await import('firebase/messaging');
    vi.mocked(isSupported).mockResolvedValueOnce(true);
    window.navigator.serviceWorker = {};
    window.Notification.permission = 'denied';
    const original = Object.getOwnPropertyDescriptor(window, 'top');
    Object.defineProperty(window, 'top', { value: { framed: true }, configurable: true });
    try {
      const status = await getPushStatus();
      expect(status.state).toBe('denied');
      expect(String(status.reason)).toContain('own browser tab');
    } finally {
      if (original) Object.defineProperty(window, 'top', original);
      else delete window.top;
    }
  });
});

// ── "I allowed the pop-up and it still shows the error" ──────────────────────
// A granted permission whose device token never arrives is the error a salon
// owner actually sees. Two things must hold: the reason says what really
// happened (never a vague "the last step did not finish"), and a push
// subscription left behind by an older worker is rebuilt instead of failing
// forever.
describe('push token recovery', () => {
  const makeRegistration = ({ unsubscribe = vi.fn(() => Promise.resolve(true)) } = {}) => {
    const registration = {
      active: { state: 'activated', scriptURL: 'https://mynaai.in/firebase-messaging-sw.js?v=1' },
      scope: 'https://mynaai.in/',
      pushManager: { getSubscription: vi.fn(() => Promise.resolve({ unsubscribe })) },
      unregister: vi.fn(() => Promise.resolve(true)),
    };
    window.navigator.serviceWorker = {
      ready: Promise.resolve(registration),
      controller: null,
      getRegistration: vi.fn(() => Promise.resolve(registration)),
      getRegistrations: vi.fn(() => Promise.resolve([registration])),
      register: vi.fn(() => Promise.resolve(registration)),
      addEventListener: vi.fn(),
    };
    return { registration, unsubscribe };
  };

  it('describes each failure in plain words instead of one vague sentence', () => {
    expect(describePushTokenFailure({ kind: 'offline' })).toContain('could not reach My Naai alerts');
    expect(describePushTokenFailure({ kind: 'key' })).toContain('Firebase rejected');
    expect(describePushTokenFailure({ kind: 'worker' })).toContain('alert worker');
    expect(describePushTokenFailure({ kind: 'unknown' })).toContain('still finishing');
    expect(describePushTokenFailure(null)).toBe('');
  });

  it('drops a stale push subscription and finishes the token when Firebase recovers', async () => {
    const { getToken, isSupported } = await import('firebase/messaging');
    vi.mocked(isSupported).mockResolvedValueOnce(true);
    const { registration, unsubscribe } = makeRegistration();
    vi.mocked(getToken)
      .mockRejectedValueOnce(new Error('AbortError: push subscription is gone'))
      .mockRejectedValueOnce(new Error('AbortError: push subscription is gone'))
      .mockResolvedValueOnce('token-recovered');

    const token = await getPushToken({ requestPermission: false });

    expect(token).toBe('token-recovered');
    // The dead subscription was cleared and the worker rebuilt before the retry.
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(registration.unregister).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('FCM_TOKEN')).toBe('token-recovered');
    // Nothing is left to warn the user about.
    expect(readPushTokenFailure()).toBeNull();
  });

  it('records why a token could not be minted so the UI can name the cause', async () => {
    vi.useFakeTimers();
    try {
      const { isSupported } = await import('firebase/messaging');
      vi.mocked(isSupported).mockResolvedValueOnce(true);
      // No usable worker at all: the registration cannot be read or created.
      window.navigator.serviceWorker = {
        ready: Promise.resolve(null),
        controller: null,
        getRegistration: vi.fn(() => Promise.resolve(null)),
        getRegistrations: vi.fn(() => Promise.resolve([])),
        register: vi.fn(() => Promise.reject(new Error('offline'))),
        addEventListener: vi.fn(),
      };

      const pending = getPushToken({ requestPermission: false });
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toBe('');

      expect(readPushTokenFailure()).toBeTruthy();
      expect(readPushTokenFailure().kind).toBe('worker');
      expect(describePushTokenFailure()).toContain('alert worker');
    } finally {
      vi.useRealTimers();
    }
  });
});
