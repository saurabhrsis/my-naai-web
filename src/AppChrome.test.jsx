import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression cover for the round of fixes reported from a tablet:
//   1. "ReferenceError: Download is not defined" — an icon used in JSX that was
//      never imported, which white-screened the salon sidebar and the salon
//      registration page.
//   2. No footer / reviews inside the app (both customer and salon side); the
//      public website keeps both.
//   3. The hamburger and the notification bell in the in-app top bar.
//   4. My-bookings cards on an iPad.
//
// The API/Firebase/socket stubs mirror src/App.test.jsx — none of that
// plumbing is what these tests are about.
const { salonProfile, userSalonList, userSalonListPublic, bookedSalonList } = vi.hoisted(() => ({
  salonProfile: vi.fn(),
  userSalonList: vi.fn(),
  userSalonListPublic: vi.fn(),
  bookedSalonList: vi.fn(),
}));

vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve('')), isSupported: vi.fn(() => Promise.resolve(false)),
  deleteToken: vi.fn(() => Promise.resolve()), onMessage: vi.fn(),
}));

vi.mock('./lib/api', async () => {
  const actual = await vi.importActual('./lib/api');
  const api = new Proxy({ salonProfile, userSalonList, userSalonListPublic, bookedSalonList }, {
    get: (target, key) => (key in target
      ? target[key]
      : vi.fn(() => Promise.resolve({ status: 'SUCCESS', data: {} }))),
  });
  return { ...actual, api };
});

vi.mock('./lib/push', () => {
  const noop = () => {};
  const stub = name => vi.fn(() => Promise.resolve({ state: 'unsupported', token: '', name }));
  return {
    setupPush: vi.fn(() => Promise.resolve({ token: '', unsubscribe: noop })),
    getPushToken: stub('getPushToken'),
    getPushStatus: stub('getPushStatus'),
    isPushConfigured: vi.fn(() => true),
    notificationActionLimit: vi.fn(() => 2),
    deletePushToken: stub('deletePushToken'),
    displayNotification: noop,
    closeNotification: noop,
    getNotificationRoute: vi.fn(() => ({ name: 'home', params: {} })),
    isActionableNotification: vi.fn(() => false),
    isEmbeddedFrame: vi.fn(() => false),
    normalizePushPayload: vi.fn(payload => ({ title: '', body: '', data: {}, type: '', hasData: false, ...payload })),
    recordForegroundMessage: noop,
    watchNotificationPermission: vi.fn(() => () => {}),
    // The partner landing page carries the signed-out buzzer check, which reads
    // the live permission through lib/push.
    readNotificationPermission: vi.fn(() => Promise.resolve('granted')),
    requestNotificationPermission: vi.fn(() => Promise.resolve('granted')),
  };
});
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
vi.mock('./lib/socket', () => ({
  subscribeToLiveUpdates: vi.fn(() => () => {}),
  resetLiveUpdatesSocket: vi.fn(),
}));
vi.mock('./lib/buzzer', () => ({ playBuzzer: vi.fn(), unlockBuzzer: vi.fn() }));

import App from './App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setPath = value => { window.history.replaceState({}, '', value); };
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

let container;
let root;

const mount = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await flush();
};

const signIn = (role, path) => {
  localStorage.setItem('isLoggedIn', 'true');
  localStorage.setItem('userType', role);
  localStorage.setItem('isNewSalon', 'false');
  localStorage.setItem('mynaai', JSON.stringify({ token: 'test-token' }));
  localStorage.setItem('mynaaiUser', JSON.stringify(
    role === 'SALON'
      ? { salon: { salonId: 'salon-1', profileCompleted: true } }
      : { userId: 'user-1' },
  ));
  setPath(path);
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setPath('/');
  userSalonList.mockReset().mockResolvedValue({ status: 'SUCCESS', data: { salons: [] } });
  userSalonListPublic.mockReset().mockResolvedValue({ status: 'SUCCESS', data: { salons: [] } });
  bookedSalonList.mockReset().mockResolvedValue({ status: 'SUCCESS', data: { bookings: [] } });
  salonProfile.mockReset().mockResolvedValue({
    status: 'SUCCESS',
    data: { salon: { salonId: 'salon-1', salonName: 'Golden Scissors', profileCompleted: true, isOpen: true, subscriptionExpired: false } },
  });
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

// ── 1. The crash ────────────────────────────────────────────────────────────
// `Download` was referenced in two places in App.jsx (the sidebar Install
// button and the salon registration header) without ever being imported. React
// evaluates the JSX on render, so the salon portal threw and white-screened.
describe('Install affordances render without a ReferenceError', () => {
  // The sidebar only renders its Install button when a beforeinstallprompt
  // event has been captured — fire the real event the app listens for.
  const fireInstallPrompt = async () => {
    await act(async () => {
      const event = new Event('beforeinstallprompt');
      event.prompt = () => Promise.resolve();
      event.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });
    await flush();
  };

  it('renders the salon portal shell with an Install button', async () => {
    signIn('SALON', '/queue');
    await mount();
    await fireInstallPrompt();

    // The shell is on screen (no white screen) …
    expect(container.querySelector('.app-shell')).not.toBeNull();
    // … and the Install control that referenced `Download` is really rendered.
    const install = container.querySelector('.install-side-button');
    expect(install).not.toBeNull();
    expect(install.textContent).toContain('Install My Naai');
    // A lucide icon renders an <svg>; if `Download` were undefined React would
    // have thrown before reaching this point.
    expect(install.querySelector('svg')).not.toBeNull();
  });

  it('renders the customer shell with an Install button', async () => {
    signIn('USER', '/home');
    await mount();
    await fireInstallPrompt();

    expect(container.querySelector('.app-shell')).not.toBeNull();
    expect(container.querySelector('.install-side-button svg')).not.toBeNull();
  });
});

// ── 2. App vs website chrome ────────────────────────────────────────────────
describe('The app has no website footer or reviews', () => {
  it('drops the footer and the review carousel on the customer home screen', async () => {
    signIn('USER', '/home');
    await mount();

    expect(container.querySelector('.home-screen')).not.toBeNull();
    expect(container.querySelector('.site-footer')).toBeNull();
    expect(container.querySelector('.testimonial-section')).toBeNull();
  });

  it('drops them on the in-app info pages too', async () => {
    signIn('USER', '/about');
    await mount();

    expect(container.querySelector('.info-screen')).not.toBeNull();
    expect(container.querySelector('.site-footer')).toBeNull();
    expect(container.querySelector('.testimonial-section')).toBeNull();
  });

  it('drops them on the salon partner side', async () => {
    signIn('SALON', '/queue');
    await mount();

    expect(container.querySelector('.app-shell.salon-shell')).not.toBeNull();
    expect(container.querySelector('.site-footer')).toBeNull();
    expect(container.querySelector('.testimonial-section')).toBeNull();
  });

  it('KEEPS both on the public website for logged-out visitors', async () => {
    setPath('/');
    await mount();

    // Guests still get the full marketing page — this is the control case that
    // proves the change is scoped to the signed-in shell.
    expect(container.querySelector('.guest-shell')).not.toBeNull();
    expect(container.querySelector('.site-footer')).not.toBeNull();
    expect(container.querySelector('.testimonial-section')).not.toBeNull();
  });
});

// ── 3. The in-app top bar: hamburger + bell ─────────────────────────────────
// Below 1024px there is no sidebar, and the bottom nav only renders on the four
// primary routes — so utility screens had NO navigation at all on a tablet.
describe('In-app top bar', () => {
  const menuButton = () => container.querySelector('.mobile-menu-button');
  const bell = () => container.querySelector('.mobile-shell-bar .notification-button');

  it('renders a hamburger and a notification bell', async () => {
    signIn('USER', '/home');
    await mount();

    expect(menuButton()).not.toBeNull();
    expect(bell()).not.toBeNull();
    // Both must actually draw their icon.
    expect(menuButton().querySelector('svg')).not.toBeNull();
    expect(bell().querySelector('svg')).not.toBeNull();
    // Closed to begin with, and labelled for screen readers.
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(menuButton().getAttribute('aria-label')).toBe('Open menu');
    expect(bell().getAttribute('aria-label')).toBe('Notifications');
  });

  it('opens a menu with every route, install and sign out', async () => {
    signIn('USER', '/home');
    await mount();

    await act(async () => { menuButton().click(); });
    await flush();

    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.mobile-shell-bar.menu-open')).not.toBeNull();
    const labels = Array.from(container.querySelectorAll('.mobile-shell-menu button')).map(node => node.textContent.trim());
    // All four customer destinations plus notifications and sign out.
    expect(labels).toEqual(expect.arrayContaining(['Discover', 'My bookings', 'Products', 'Account', 'Notifications', 'Sign out']));
  });

  it('lists the salon routes for a partner session', async () => {
    signIn('SALON', '/queue');
    await mount();

    await act(async () => { menuButton().click(); });
    await flush();

    const labels = Array.from(container.querySelectorAll('.mobile-shell-menu button')).map(node => node.textContent.trim());
    expect(labels).toEqual(expect.arrayContaining(['Customer queue', 'History', 'Products', 'Account']));
    expect(container.querySelector('.mobile-shell-menu-role').textContent).toContain('Salon partner');
  });

  // The whole point of the menu: a utility route on a tablet still has a way out.
  it('gives utility screens navigation, where the bottom nav is absent', async () => {
    signIn('USER', '/notifications');
    await mount();

    // No bottom nav on this route …
    expect(container.querySelector('.mobile-nav')).toBeNull();
    // … so the menu is the only navigation, and it must be there.
    expect(menuButton()).not.toBeNull();

    await act(async () => { menuButton().click(); });
    await flush();
    const discover = Array.from(container.querySelectorAll('.mobile-shell-menu button')).find(node => node.textContent.trim() === 'Discover');
    expect(discover).not.toBeUndefined();

    await act(async () => { discover.click(); });
    await flush();
    expect(window.location.pathname).toBe('/');
    // Navigating closes the menu — it must not outlive the tap.
    expect(container.querySelector('.mobile-shell-bar.menu-open')).toBeNull();
  });

  it('closes on Escape', async () => {
    signIn('USER', '/home');
    await mount();

    await act(async () => { menuButton().click(); });
    await flush();
    expect(container.querySelector('.mobile-shell-bar.menu-open')).not.toBeNull();

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await flush();
    expect(container.querySelector('.mobile-shell-bar.menu-open')).toBeNull();
  });

  it('routes the bell to notifications and marks it current', async () => {
    signIn('USER', '/home');
    await mount();

    await act(async () => { bell().click(); });
    await flush();

    expect(window.location.pathname).toBe('/notifications');
    expect(bell().getAttribute('aria-current')).toBe('page');
  });
});

// ── 4. Bottom-bar labels ────────────────────────────────────────────────────
// The bar used to build its text with
//   label.replace('Customer ', '').replace('My ', '')
// which chopped the capital off the front of the word: an iPad screenshot
// showed a lowercase "bookings" tab sitting between "Discover" and "Products".
describe('Bottom navigation labels', () => {
  const tabLabels = () => Array.from(container.querySelectorAll('.mobile-nav button span')).map(node => node.textContent);

  it('capitalises every customer tab', async () => {
    signIn('USER', '/home');
    await mount();

    const labels = tabLabels();
    expect(labels).toEqual(['Discover', 'Bookings', 'Products', 'Account']);
    // Nothing may start lowercase — that is the exact defect.
    labels.forEach(label => expect(label[0]).toBe(label[0].toUpperCase()));
  });

  it('capitalises every salon tab', async () => {
    signIn('SALON', '/queue');
    await mount();

    const labels = tabLabels();
    expect(labels).toEqual(['Queue', 'History', 'Products', 'Account']);
    labels.forEach(label => expect(label[0]).toBe(label[0].toUpperCase()));
  });

  it('marks the open tab for assistive tech', async () => {
    signIn('USER', '/bookings');
    await mount();

    const current = container.querySelector('.mobile-nav button[aria-current="page"]');
    expect(current).not.toBeNull();
    expect(current.textContent).toContain('Bookings');
  });
});
