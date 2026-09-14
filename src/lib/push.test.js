import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  bookingRequestActions,
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
  it('returns Accept / Reject / Delay', () => {
    const actions = bookingRequestActions();
    expect(actions).toHaveLength(3);
    expect(actions.map(a => a.action)).toEqual(['ACCEPT_BOOKING', 'REJECT_BOOKING', 'DELAY_BOOKING']);
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
  it('prefers the live Permissions API value and maps prompt to default', async () => {
    window.Notification.permission = 'granted';
    window.navigator.permissions = { query: vi.fn(() => Promise.resolve({ state: 'prompt' })) };
    await expect(readNotificationPermission()).resolves.toBe('default');
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

  it('reports the embedded state when a denied page runs inside an iframe', async () => {
    const { isSupported } = await import('firebase/messaging');
    vi.mocked(isSupported).mockResolvedValueOnce(true);
    window.navigator.serviceWorker = {};
    window.Notification.permission = 'denied';
    const original = Object.getOwnPropertyDescriptor(window, 'top');
    Object.defineProperty(window, 'top', { value: { framed: true }, configurable: true });
    try {
      const status = await getPushStatus();
      expect(status.state).toBe('embedded');
      expect(String(status.reason)).toContain('own browser tab');
    } finally {
      if (original) Object.defineProperty(window, 'top', original);
      else delete window.top;
    }
  });
});
