import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { salonProfile } = vi.hoisted(() => ({ salonProfile: vi.fn() }));

// App.jsx pulls in lib/push.js, which loads the Firebase browser SDK at import
// time. That SDK needs browser APIs jsdom does not provide, so stub the same
// entry points src/lib/push.test.js does — the routing under test never touches
// messaging.
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve('')), isSupported: vi.fn(() => Promise.resolve(false)),
  deleteToken: vi.fn(() => Promise.resolve()), onMessage: vi.fn(),
}));

// Every API call resolves with an empty successful payload unless a test needs
// something specific. The router is what is under test, not the screens' data.
vi.mock('./lib/api', async () => {
  const actual = await vi.importActual('./lib/api');
  const api = new Proxy({ salonProfile }, {
    get: (target, key) => (key in target
      ? target[key]
      : vi.fn(() => Promise.resolve({ status: 'SUCCESS', data: {} }))),
  });
  return { ...actual, api };
});

// Push, sockets and the buzzer need service workers / WebSockets / Web Audio
// plumbing that jsdom only partially has. None of it affects routing.
vi.mock('./lib/push', () => {
  const noop = () => {};
  const stub = name => vi.fn(() => Promise.resolve({ state: 'unsupported', token: '', name }));
  return {
    setupPush: vi.fn(() => Promise.resolve({ token: '', unsubscribe: noop })),
    getPushToken: stub('getPushToken'),
    getPushStatus: stub('getPushStatus'),
    deletePushToken: stub('deletePushToken'),
    displayNotification: noop,
    closeNotification: noop,
    getNotificationRoute: vi.fn(() => ({ name: 'home', params: {} })),
    isActionableNotification: vi.fn(() => false),
    normalizePushPayload: vi.fn(payload => ({ title: '', body: '', data: {}, type: '', hasData: false, ...payload })),
    recordForegroundMessage: noop,
  };
});
vi.mock('./lib/socket', () => ({
  subscribeToLiveUpdates: vi.fn(() => () => {}),
  resetLiveUpdatesSocket: vi.fn(),
}));
vi.mock('./lib/buzzer', () => ({ playBuzzer: vi.fn(), unlockBuzzer: vi.fn() }));

import App, { getRouteFromHash } from './App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom normalises a history URL into a real location.hash, which is what makes
// this a faithful test of what the browser hands the router.
const setHash = value => { window.history.replaceState({}, '', `${window.location.pathname}${value}`); };
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setHash('#/');
});

describe('getRouteFromHash', () => {
  it('falls back to the customer home screen when there is no usable hash', () => {
    expect(getRouteFromHash('USER')).toEqual({ name: 'home', params: {} });
    setHash('#/');
    expect(getRouteFromHash('USER')).toEqual({ name: 'home', params: {} });
    setHash('');
    expect(getRouteFromHash(undefined)).toEqual({ name: 'home', params: {} });
  });

  it('falls back to the salon queue for a partner session', () => {
    expect(getRouteFromHash('SALON')).toEqual({ name: 'queue', params: {} });
    // The role comes from localStorage and is not guaranteed to be upper case.
    expect(getRouteFromHash('salon')).toEqual({ name: 'queue', params: {} });
    setHash('#/nonsense');
    expect(getRouteFromHash('SALON')).toEqual({ name: 'queue', params: {} });
  });

  it('reads the screen and its query params back out of the hash', () => {
    setHash('#/bookings');
    expect(getRouteFromHash('USER')).toEqual({ name: 'bookings', params: {} });

    setHash('#/detail?salonId=abc123');
    expect(getRouteFromHash('USER')).toEqual({ name: 'detail', params: { salonId: 'abc123' } });

    setHash('#/subscription?mode=RENEW&forceRenewal=true');
    expect(getRouteFromHash('SALON')).toEqual({
      name: 'subscription',
      params: { mode: 'RENEW', forceRenewal: 'true' },
    });
  });

  it('restores the deep links a notification opens', () => {
    setHash('#/bookingRequest?bookingRequestId=req-1&openDelayModal=true');
    expect(getRouteFromHash('SALON')).toEqual({
      name: 'bookingRequest',
      params: { bookingRequestId: 'req-1', openDelayModal: 'true' },
    });

    setHash('#/delay?bookingRequestId=req-1&delayMinutes=15&reason=Traffic');
    expect(getRouteFromHash('USER')).toEqual({
      name: 'delay',
      params: { bookingRequestId: 'req-1', delayMinutes: '15', reason: 'Traffic' },
    });
  });

  it('decodes percent-encoded params written by navigate()', () => {
    setHash('#/schedule?salonId=s-1&service=Hair%20Cut%20%26%20Beard');
    expect(getRouteFromHash('USER')).toEqual({
      name: 'schedule',
      params: { salonId: 's-1', service: 'Hair Cut & Beard' },
    });
  });

  it('ignores a screen that belongs to the other role', () => {
    // A customer must not land on a partner-only screen: AppShell has no branch
    // for it on the customer side, so the shell would render nothing at all.
    setHash('#/queue');
    expect(getRouteFromHash('USER')).toEqual({ name: 'home', params: {} });

    setHash('#/products');
    expect(getRouteFromHash('SALON')).toEqual({ name: 'queue', params: {} });
  });

  it('tolerates a hash without the leading slash and a malformed query', () => {
    setHash('#home');
    expect(getRouteFromHash('USER')).toEqual({ name: 'home', params: {} });

    // URLSearchParams is deliberately lenient, so junk in the query cannot break
    // screen resolution: the route still lands on bookings and the params a
    // screen actually reads survive.
    setHash('#/bookings?%&bookingRequestId=req-1');
    expect(getRouteFromHash('USER').name).toBe('bookings');
    expect(getRouteFromHash('USER').params.bookingRequestId).toBe('req-1');
  });
});

// Regression cover for the crash these helpers caused: `getRouteFromHash` was
// called from AppRoot's `useState` initializer without ever being defined, so
// the first render of a signed-in session threw a ReferenceError and the whole
// portal white-screened. Mounting the real App is the only assertion that
// catches that class of mistake.
describe('App routing on mount', () => {
  let container;
  let root;

  const signIn = (role, hash) => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userType', role);
    localStorage.setItem('isNewSalon', 'false');
    localStorage.setItem('mynaai', JSON.stringify({ token: 'test-token' }));
    localStorage.setItem('mynaaiUser', JSON.stringify(
      role === 'SALON'
        ? { salon: { salonId: 'salon-1', profileCompleted: true } }
        : { userId: 'user-1' },
    ));
    setHash(hash);
  };

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  const headings = () => Array.from(container.querySelectorAll('h1')).map(node => node.textContent);

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it('renders the screen named in the hash for a customer', async () => {
    signIn('USER', '#/bookings');
    await mount();
    expect(headings()).toContain('My bookings');
  });

  it('renders the deep link a booking-request notification opens for a salon', async () => {
    salonProfile.mockResolvedValue({ status: 'SUCCESS', data: { salon: { profileCompleted: true } } });
    signIn('SALON', '#/bookingRequest?bookingRequestId=req-1');
    await mount();
    expect(headings().some(text => /booking request/i.test(text))).toBe(true);
  });

  it('falls back to the role home screen for an unknown hash', async () => {
    signIn('USER', '#/not-a-screen');
    await mount();
    expect(container.querySelector('.home-screen, .screen')).not.toBeNull();
    expect(headings().length).toBeGreaterThan(0);
  });

  it('follows the hash when the user navigates back and forward', async () => {
    signIn('USER', '#/bookings');
    await mount();
    expect(headings()).toContain('My bookings');

    await act(async () => { window.location.hash = '#/notifications'; });
    await flush();
    expect(headings()).toContain('Notifications');
  });
});
