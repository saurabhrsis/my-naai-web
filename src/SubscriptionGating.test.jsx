import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// An expired plan used to replace the whole partner portal with a paywall. It
// now closes exactly two tabs — the Customer queue and Booking history — and
// nothing else, so these tests pin both halves of that promise: the modal (with
// its two exits) on the closed pair, and a normal, usable app on every other
// route.

const { salonProfile } = vi.hoisted(() => ({ salonProfile: vi.fn() }));

vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve('')),
  isSupported: vi.fn(() => Promise.resolve(false)),
  deleteToken: vi.fn(() => Promise.resolve()),
  onMessage: vi.fn(),
}));

vi.mock('./lib/api', async () => {
  const actual = await vi.importActual('./lib/api');
  const api = new Proxy({ salonProfile }, {
    get: (target, key) => (key in target ? target[key] : vi.fn(() => Promise.resolve({ status: 'SUCCESS', data: {} }))),
  });
  return { ...actual, api };
});

vi.mock('./lib/push', () => ({
  setupPush: vi.fn(() => Promise.resolve({ token: '', unsubscribe: () => {} })),
  getPushToken: vi.fn(() => Promise.resolve({ state: 'unsupported', token: '' })),
  getPushStatus: vi.fn(() => Promise.resolve({ state: 'unsupported', token: '' })),
  isPushConfigured: vi.fn(() => true),
  notificationActionLimit: vi.fn(() => 2),
  deletePushToken: vi.fn(() => Promise.resolve({})),
  displayNotification: vi.fn(() => Promise.resolve(true)),
  closeNotification: vi.fn(),
  getNotificationRoute: vi.fn(() => ({ name: 'home', params: {} })),
  isActionableNotification: vi.fn(() => false),
  isEmbeddedFrame: vi.fn(() => false),
  normalizePushPayload: vi.fn(payload => ({ title: '', body: '', data: {}, type: '', hasData: false, ...payload })),
  recordForegroundMessage: vi.fn(),
  watchNotificationPermission: vi.fn(() => () => {}),
  readNotificationPermission: vi.fn(() => Promise.resolve('granted')),
  requestNotificationPermission: vi.fn(() => Promise.resolve('granted')),
  formatPushDiagnostics: vi.fn(() => ''),
  getPushDiagnostics: vi.fn(() => Promise.resolve({ ok: true, checks: [] })),
}));

vi.mock('./lib/permissions', async () => {
  const actual = await vi.importActual('./lib/permissions');
  return {
    ...actual,
    isEmbeddedFrame: vi.fn(() => false),
    isIosDevice: vi.fn(() => false),
    isIosPwaInstalled: vi.fn(() => false),
    isStandalone: vi.fn(() => false),
  };
});
vi.mock('./lib/socket', () => ({ subscribeToLiveUpdates: vi.fn(() => () => {}), resetLiveUpdatesSocket: vi.fn() }));
vi.mock('./lib/buzzer', async () => {
  const actual = await vi.importActual('./lib/buzzer');
  return { ...actual, playBuzzer: vi.fn(() => true), unlockBuzzer: vi.fn() };
});

import App from './App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const setPath = value => { window.history.replaceState({}, '', value); };
const currentPath = () => `${window.location.pathname}${window.location.search}`;

const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

function signInSalon(path) {
  localStorage.setItem('isLoggedIn', 'true');
  localStorage.setItem('userType', 'SALON');
  localStorage.setItem('isNewSalon', 'false');
  localStorage.setItem('mynaai', JSON.stringify({ token: 'test-token' }));
  localStorage.setItem('mynaaiUser', JSON.stringify({ salon: { salonId: 'salon-1', profileCompleted: true } }));
  setPath(path);
}

describe('an expired plan closes only the queue and the history', () => {
  let container = null;
  let root = null;

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };
  const buttonByText = text => Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim().includes(text));
  const modal = () => container.querySelector('.subscription-ended-body');

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // The server's record: a plan that ended three days ago.
    salonProfile.mockReset().mockResolvedValue({
      status: 'SUCCESS',
      data: {
        salon: {
          // A fully onboarded salon: an incomplete profile is redirected to the
          // onboarding editor before the plan matters at all.
          salonId: 'salon-1', salonName: 'Glow Studio', ownerName: 'Rita Rao', addressLine1: '12 Market Road',
          genderType: 'FEMALE', latitude: 21.14, longitude: 79.08, services: [{ name: 'Hair cut' }],
          businessHours: [{ day: 'Monday', openingTime: '10:00', closingTime: '20:00' }],
          profileCompleted: true, isNewSalon: false,
          // …whose subscription ran out three days ago.
          planType: 'SILVER', planStartDate: past, planEndDate: past, isPlanActive: false,
        },
      },
    });
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it('shows the renew-or-shop modal when the queue is opened, with the app still behind it', async () => {
    signInSalon('/queue');
    await mount();

    expect(modal(), 'the notice is on screen').toBeTruthy();
    expect(container.textContent).toContain('Your subscription has ended');
    expect(container.textContent).toContain('Renew your subscription to open this feature again');
    // Two exits, exactly as the owner specified.
    expect(buttonByText('Renew subscription')).toBeTruthy();
    expect(buttonByText('Cancel')).toBeTruthy();
    // Not a paywall: the shell and the shop are behind the notice.
    expect(container.querySelector('.sidebar-nav, .mobile-nav')).toBeTruthy();
    expect(container.querySelector('.shop-screen'), 'the shop is drawn behind the modal').toBeTruthy();
    expect(container.querySelector('.subscription-lock-notice')).toBeNull();
  });

  it('sends Cancel to the Naai Shop and closes the modal', async () => {
    signInSalon('/history');
    await mount();
    expect(modal()).toBeTruthy();

    await act(async () => { buttonByText('Cancel').click(); });
    await flush();

    expect(currentPath()).toBe('/shop');
    expect(modal()).toBeNull();
    expect(container.querySelector('.shop-screen')).toBeTruthy();
  });

  it('sends Renew to the renewal UI', async () => {
    signInSalon('/queue');
    await mount();

    await act(async () => { buttonByText('Renew subscription').click(); });
    await flush();

    expect(currentPath()).toContain('/subscription');
    expect(currentPath()).toContain('mode=RENEW');
    expect(modal()).toBeNull();
  });

  it('keeps every other tab usable', async () => {
    for (const path of ['/account', '/booking-requests', '/notifications', '/shop']) {
      signInSalon(path);
      await mount();
      expect(modal(), `${path} must not be gated`).toBeNull();
      expect(container.querySelector('.login-screen'), `${path} stays signed in`).toBeNull();
      if (root) act(() => root.unmount());
      root = null;
      container?.remove();
      container = null;
    }
  });

  it('marks the two closed tabs with a lock but leaves them tappable', async () => {
    signInSalon('/account');
    await mount();

    const locked = Array.from(container.querySelectorAll('.plan-locked')).map(node => node.textContent);
    await flush(); await flush();
    // eslint-disable-next-line no-console
    console.log('DEBUG screen:', container.querySelector('.screen')?.className, '| path:', currentPath(), '| h1:', JSON.stringify(Array.from(container.querySelectorAll('h1')).map(n => n.textContent)));
    console.log('DEBUG calls:', salonProfile.mock.calls.length, JSON.stringify(salonProfile.mock.results?.[0]?.value && 'promise'), 'isNewSalon', localStorage.getItem('isNewSalon'), 'userType', localStorage.getItem('userType'));
    // eslint-disable-next-line no-console
    console.log('DEBUG after more flush locked:', JSON.stringify(Array.from(container.querySelectorAll('.plan-locked')).map(n => n.textContent)));
    // eslint-disable-next-line no-console
    console.log('DEBUG locked:', JSON.stringify(locked), 'navs:', container.querySelectorAll('.sidebar-nav, .mobile-nav').length, 'all buttons:', JSON.stringify(Array.from(container.querySelectorAll('.sidebar-nav button')).map(b => b.className + '|' + b.textContent)));
    expect(locked.some(label => /queue/i.test(label))).toBe(true);
    expect(locked.some(label => label.includes('History'))).toBe(true);

    // Tapping the locked tab is not blocked — it opens the modal that explains why.
    const queueButton = Array.from(container.querySelectorAll('.sidebar-nav button')).find(node => node.textContent.includes('Customer queue'));
    await act(async () => { queueButton.click(); });
    await flush();
    expect(currentPath()).toBe('/queue');
    expect(modal()).toBeTruthy();
  });
});
