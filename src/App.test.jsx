import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { salonProfile, userSalonList, userSalonListPublic, userLogin, verifyLogin, userAds, getBookingRequestById, bookingRequestOwnerAction } = vi.hoisted(() => ({ salonProfile: vi.fn(), userSalonList: vi.fn(), userSalonListPublic: vi.fn(), userLogin: vi.fn(), verifyLogin: vi.fn(), userAds: vi.fn(() => Promise.resolve({ status: 'SUCCESS', data: {} })), getBookingRequestById: vi.fn(() => Promise.resolve({ status: 'SUCCESS', data: {} })), bookingRequestOwnerAction: vi.fn(() => Promise.resolve({ status: 'SUCCESS' })) }));

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
  const api = new Proxy({ salonProfile, userSalonList, userSalonListPublic, userLogin, verifyLogin, userAds, getBookingRequestById, bookingRequestOwnerAction }, {
    get: (target, key) => (key in target
      ? target[key]
      : vi.fn(() => Promise.resolve({ status: 'SUCCESS', data: {} }))),
  });
  return { ...actual, api };
});

// Push, sockets and the buzzer need service workers / WebSockets / Web Audio
// plumbing that jsdom only partially has. None of it affects routing.
// `pushHarness` is how a test delivers a foreground push: the app hands its
// onMessage handler to setupPush, and the test calls it the way Firebase would.
const pushHarness = vi.hoisted(() => ({ onMessage: null }));
vi.mock('./lib/push', () => {
  const noop = () => {};
  const stub = name => vi.fn(() => Promise.resolve({ state: 'unsupported', token: '', name }));
  return {
    setupPush: vi.fn(options => {
      pushHarness.onMessage = options?.onMessage || null;
      return Promise.resolve({ token: '', unsubscribe: noop });
    }),
    getPushToken: stub('getPushToken'),
    getPushStatus: stub('getPushStatus'),
    isPushConfigured: vi.fn(() => true),
    notificationActionLimit: vi.fn(() => 2),
    deletePushToken: stub('deletePushToken'),
    displayNotification: vi.fn(() => Promise.resolve(true)),
    closeNotification: noop,
    getNotificationRoute: vi.fn(() => ({ name: 'home', params: {} })),
    isActionableNotification: vi.fn(() => false),
    isEmbeddedFrame: vi.fn(() => false),
    normalizePushPayload: vi.fn(payload => ({ title: '', body: '', data: {}, type: '', hasData: false, ...payload })),
    recordForegroundMessage: noop,
    watchNotificationPermission: vi.fn(() => () => {}),
    // The signed-out buzzer check on the login page reads the live permission
    // through lib/push, so the mock carries those entry points too.
    readNotificationPermission: vi.fn(() => Promise.resolve('granted')),
    requestNotificationPermission: vi.fn(() => Promise.resolve('granted')),
    formatPushDiagnostics: vi.fn(() => ''),
    getPushDiagnostics: vi.fn(() => Promise.resolve({ ok: true, checks: [] })),
  };
});
// Device detection (iPhone, embedded frame) decides WHICH permission copy the
// UI shows, so tests drive it — everything else in lib/permissions (the live
// permission reads, the gesture-safe asks) stays real.
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
// The buzzer module is only partly stubbed: `alertIdentity` and
// `claimAlertDelivery` (the arrival gate the app uses to recognise a repeated
// delivery) stay real, so these tests exercise the actual single-alert rule.
// `playBuzzer` is a spy that says "rang" by default.
vi.mock('./lib/buzzer', async () => {
  const actual = await vi.importActual('./lib/buzzer');
  return { ...actual, playBuzzer: vi.fn(() => true), unlockBuzzer: vi.fn() };
});

import App, { getRouteFromPath, parseRoutePath, resolveResumeRoute, routeToPath } from './App';
import { api } from './lib/api';
import * as permissions from './lib/permissions';
import * as push from './lib/push';
import { stashPendingRoute, popPendingRoute } from './lib/pendingRoute';
import { playBuzzer } from './lib/buzzer';
import { withCrossOriginFrame } from './test/frame';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no BroadcastChannel, and the app's only cross-tab channel is exactly
// what the "app open in another tab" case travels on.
class FakeChannel {
  static instances = [];
  constructor(name) {
    this.name = name;
    this.listeners = [];
    FakeChannel.instances.push(this);
  }
  addEventListener(type, handler) { this.listeners.push(handler); }
  close() {}
  emit(data) { this.listeners.forEach(handler => handler({ data })); }
}

// Tests drive the real browser history API (paths, not hashes) — exactly
// what the address bar hands the router. `goto` performs an SPA navigation
// (pushState + popstate, the same soft-nav the app uses internally).
const setPath = value => { window.history.replaceState({}, '', value); };
const goto = value => { window.history.pushState({}, '', value); window.dispatchEvent(new Event('popstate')); };
const currentPath = () => `${window.location.pathname}${window.location.search}`;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // No startup splash exists: every suite runs the real first-visit flow —
  // guests land straight on home, where the page itself asks only location.
  setPath('/');
  // A successful empty discovery list by default — guest-flow tests override it.
  userSalonList.mockReset().mockResolvedValue({ status: 'SUCCESS', data: { salons: [] } });
  userSalonListPublic.mockReset().mockResolvedValue({ status: 'SUCCESS', data: { salons: [] } });
});

describe('getRouteFromPath', () => {
  it('falls back to the customer home screen when there is no usable path', () => {
    setPath('/');
    expect(getRouteFromPath('USER')).toEqual({ name: 'home', params: {} });
    setPath('');
    expect(getRouteFromPath(undefined)).toEqual({ name: 'home', params: {} });
  });

  it('falls back to the salon queue for a partner session', () => {
    setPath('/nonsense');
    expect(getRouteFromPath('SALON')).toEqual({ name: 'queue', params: {} });
    // The role comes from localStorage and is not guaranteed to be upper case.
    expect(getRouteFromPath('salon')).toEqual({ name: 'queue', params: {} });
  });

  it('reads the screen and its query params back out of the path', () => {
    setPath('/bookings');
    expect(getRouteFromPath('USER')).toEqual({ name: 'bookings', params: {} });

    setPath('/detail?salonId=abc123');
    expect(getRouteFromPath('USER')).toEqual({ name: 'detail', params: { salonId: 'abc123' } });

    setPath('/subscription?mode=RENEW&forceRenewal=true');
    expect(getRouteFromPath('SALON')).toEqual({
      name: 'subscription',
      params: { mode: 'RENEW', forceRenewal: 'true' },
    });
  });

  it('restores the deep links a notification opens', () => {
    setPath('/bookingRequest?bookingRequestId=req-1&openDelayModal=true');
    expect(getRouteFromPath('SALON')).toEqual({
      name: 'bookingRequest',
      params: { bookingRequestId: 'req-1', openDelayModal: 'true' },
    });

    setPath('/delay?bookingRequestId=req-1&delayMinutes=15&reason=Traffic');
    expect(getRouteFromPath('USER')).toEqual({
      name: 'delay',
      params: { bookingRequestId: 'req-1', delayMinutes: '15', reason: 'Traffic' },
    });
  });

  it('decodes percent-encoded params written by navigate()', () => {
    setPath('/schedule?salonId=s-1&service=Hair%20Cut%20%26%20Beard');
    expect(getRouteFromPath('USER')).toEqual({
      name: 'schedule',
      params: { salonId: 's-1', service: 'Hair Cut & Beard' },
    });
  });

  it('ignores a screen that belongs to the other role', () => {
    // A customer must not land on a partner-only screen: AppShell has no branch
    // for it on the customer side, so the shell would render nothing at all.
    setPath('/queue');
    expect(getRouteFromPath('USER')).toEqual({ name: 'home', params: {} });

    setPath('/products');
    expect(getRouteFromPath('SALON')).toEqual({ name: 'queue', params: {} });
  });

  it('maps the salon-partner URL segment onto the partner route', () => {
    setPath('/salon-partner');
    expect(getRouteFromPath(undefined)).toEqual({ name: 'partner', params: {} });
    expect(routeToPath('partner')).toBe('/salon-partner');
  });

  it('maps the privacy-policy URL segment onto the privacy route', () => {
    setPath('/privacy-policy');
    expect(getRouteFromPath(undefined)).toEqual({ name: 'privacy', params: {} });
    expect(getRouteFromPath('USER')).toEqual({ name: 'privacy', params: {} });
    // And routeToPath writes public segment names back out.
    expect(routeToPath('privacy', {})).toBe('/privacy-policy');
    expect(routeToPath('home', {})).toBe('/');
    expect(routeToPath('about', {})).toBe('/about');
  });

  it('tolerates a bare segment and a malformed query', () => {
    setPath('/bookings?%&bookingRequestId=req-1');
    expect(getRouteFromPath('USER').name).toBe('bookings');
    expect(getRouteFromPath('USER').params.bookingRequestId).toBe('req-1');
  });

  it('parses the shareable per-salon link /salon/<id>', () => {
    expect(parseRoutePath('/salon/salon-42')).toEqual({ name: 'salon', params: { salonId: 'salon-42' } });
    expect(parseRoutePath('/salon/salon-42?from=share')).toEqual({ name: 'salon', params: { salonId: 'salon-42', from: 'share' } });
    // And back. In-session object params (a prefetched salon record) never leak
    // into the URL — only the scalar slots do.
    expect(routeToPath('salon', { salonId: 'salon-42', salon: { name: 'X' } })).toBe('/salon/salon-42');
    expect(routeToPath('bookings', {})).toBe('/bookings');
  });

  it('opens salon links for guests but keeps account screens gated', () => {
    // No role = browsing before login: home and the salon page are public.
    setPath('/salon/salon-42');
    expect(getRouteFromPath(undefined)).toEqual({ name: 'salon', params: { salonId: 'salon-42' } });

    setPath('/bookings');
    expect(getRouteFromPath(undefined)).toEqual({ name: 'home', params: {} });

    setPath('/home');
    expect(getRouteFromPath(null)).toEqual({ name: 'home', params: {} });
  });

  it('still resolves legacy #/ hash links shared before the routing switch', () => {
    window.history.replaceState({}, '', '/#/salon/legacy-8');
    expect(getRouteFromPath(undefined)).toEqual({ name: 'salon', params: { salonId: 'legacy-8' } });
    // The address bar is upgraded in place so refresh/back stay on the path URL.
    expect(currentPath()).toBe('/salon/legacy-8');

    window.history.replaceState({}, '', '/#/bookings');
    expect(getRouteFromPath('USER')).toEqual({ name: 'bookings', params: {} });
  });

  it('resumes the exact page a guest stashed, once it is valid for their role', () => {
    stashPendingRoute('/salon/salon-42');
    expect(popPendingRoute()).toBe('/salon/salon-42');
    // One-shot: the stash is consumed by the pop.
    expect(popPendingRoute()).toBe('');

    expect(resolveResumeRoute('USER', '/salon/salon-42')).toEqual({ name: 'salon', params: { salonId: 'salon-42' } });
    // Legacy stashes from the hash era are normalised too.
    expect(resolveResumeRoute('USER', '#/salon/salon-42')).toEqual({ name: 'salon', params: { salonId: 'salon-42' } });
    // The customer salon link a partner was sent means nothing to their account.
    expect(resolveResumeRoute('SALON', '/salon/salon-42')).toBeNull();
    expect(resolveResumeRoute('USER', '/queue')).toBeNull();
    // Login itself is never a resume target — it is stored *from*, not *to*.
    stashPendingRoute('/login');
    expect(popPendingRoute()).toBe('');
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
    setPath(hash);
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
    signIn('USER', '/bookings');
    await mount();
    expect(headings()).toContain('My bookings');
  });

  it('renders the deep link a booking-request notification opens for a salon', async () => {
    salonProfile.mockResolvedValue({ status: 'SUCCESS', data: { salon: { profileCompleted: true } } });
    signIn('SALON', '/bookingRequest?bookingRequestId=req-1');
    await mount();
    expect(headings().some(text => /booking request/i.test(text))).toBe(true);
  });

  it('falls back to the role home screen for an unknown hash', async () => {
    signIn('USER', '/not-a-screen');
    await mount();
    expect(container.querySelector('.home-screen, .screen')).not.toBeNull();
    expect(headings().length).toBeGreaterThan(0);
  });

  it('keeps a signed-in session inside the app: #/login resolves to the dashboard home', async () => {
    signIn('USER', '/login');
    await mount();
    // The public navbar must never render for a session — only logout returns them.
    expect(container.querySelector('.guest-shell')).toBeNull();
    expect(container.querySelector('.home-screen')).not.toBeNull();
  });

  it('uses the personalized salon list endpoint for a signed-in customer', async () => {
    signIn('USER', '/home');
    await mount();
    await flush();
    expect(userSalonList).toHaveBeenCalled();
    expect(userSalonListPublic).not.toHaveBeenCalled();
  });

  it('follows the hash when the user navigates back and forward', async () => {
    signIn('USER', '/bookings');
    await mount();
    expect(headings()).toContain('My bookings');

    await act(async () => { goto('/notifications'); });
    await flush();
    expect(headings()).toContain('Notifications');
  });
});

// Browse-first guest flow (client ask, Hindi brief): salons are visible with
// no login wall, Book now is the moment login is required, and every salon
// carries its own shareable #/salon/<id> link that a fresh visitor can open.
describe('Guest browsing flow', () => {
  let container;
  let root;

  const salonPayload = () => ({
    status: 'SUCCESS',
    data: {
      salons: [{
        salonId: 'salon-9', salonName: 'Golden Scissors', genderType: 'UNISEX',
        address: 'Dharampeth, Nagpur', isOpen: true, waitTime: '5–10 min',
      }],
    },
  });

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  const buttonByText = text => Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim().includes(text));

  beforeEach(() => {
    userSalonListPublic.mockResolvedValue(salonPayload());
    vi.mocked(push.getPushStatus).mockReset().mockResolvedValue({ state: 'needs-permission', reason: '' });
    vi.mocked(push.getPushToken).mockReset().mockResolvedValue('');
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it('lands a first-time guest straight on home — no permission splash ever', async () => {
    setPath('/');
    await mount();

    // No splash/step screen of any kind before the guest home…
    expect(container.querySelector('.setup-splash')).toBeNull();
    expect(container.querySelector('.guest-shell')).not.toBeNull();
    expect(container.querySelector('.auth-page')).toBeNull();
    // …and the one home-screen permission — location — is asked by the home
    // page itself right after load (browser geolocation popup).
    expect(container.textContent).toContain('Golden Scissors');
  });

  it('shows salons to a guest with no login wall', async () => {
    setPath('/');
    await mount();

    expect(container.querySelector('.guest-shell')).not.toBeNull();
    expect(container.querySelector('.auth-page')).toBeNull();
    expect(container.textContent).toContain('Golden Scissors');
    // One Login action in the navbar (registration lives inside the flow).
    const login = container.querySelector('.guest-login-button');
    expect(login).not.toBeNull();
    expect(login.textContent.trim()).toBe('Login');
  });

  it('loads the discovery list from the token-free public endpoint', async () => {
    setPath('/');
    await mount();

    expect(userSalonListPublic).toHaveBeenCalled();
    expect(userSalonList).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Golden Scissors');
  });

  it('navigates the site routes from the navbar', async () => {
    setPath('/');
    await mount();

    const nav = container.querySelector('.site-nav-links');
    expect(nav).not.toBeNull();
    const labels = Array.from(nav.querySelectorAll('button')).map(node => node.textContent.trim());
    expect(labels).toEqual(['Home', 'About', 'Salon partner', 'Contact']);

    // The partner tab is for owners — it opens the public partner page.
    await act(async () => { Array.from(nav.querySelectorAll('button')).find(node => node.textContent === 'Salon partner').click(); });
    await flush();
    expect(currentPath()).toBe('/salon-partner');
    expect(container.querySelector('.partner-screen')).not.toBeNull();
    expect(container.querySelector('.site-nav-links button.active')?.textContent).toBe('Salon partner');
    // The signed-out buzzer check lives on this page: iOS only grants a
    // notification permission to an app that is actually running, so a login wall
    // made the buzzer unverifiable on an iPhone. Reachable here without an account.
    expect(container.querySelector('.partner-buzzer .buzzer-test-card')).not.toBeNull();
    expect(container.textContent).toContain('Hear the buzzer before you sign in');

    await act(async () => { Array.from(container.querySelector('.site-nav-links').querySelectorAll('button')).find(node => node.textContent === 'About').click(); });
    await flush();
    expect(currentPath()).toBe('/about');
    expect(container.querySelector('.info-screen')).not.toBeNull();
    expect(container.querySelector('.site-nav-links button.active')?.textContent).toBe('About');

    await act(async () => { Array.from(container.querySelector('.site-nav-links').querySelectorAll('button')).find(node => node.textContent === 'Contact').click(); });
    await flush();
    expect(currentPath()).toBe('/contact');
    expect(container.textContent).toContain('Contact us');
    expect(container.textContent).toContain('8380017393');
  });

  it('opens a shared salon link (#/salon/<id>) straight on the salon page', async () => {
    setPath('/salon/salon-9');
    await mount();

    expect(container.querySelector('.detail-screen')).not.toBeNull();
    expect(container.querySelector('.auth-page')).toBeNull();
  });

  it('asks for login only at booking intent and remembers the exact salon', async () => {
    setPath('/');
    await mount();

    await act(async () => { buttonByText('Book now').click(); });
    await flush();

    expect(currentPath()).toBe('/login');
    expect(sessionStorage.getItem('mynaaiPendingRoute')).toBe('/salon/salon-9');
    expect(container.querySelector('.auth-page')).not.toBeNull();
    // The login page volunteers a way back to browsing — it must not feel trapped.
    expect(buttonByText('Browse salons')).not.toBeNull();
  });

  it('gives the guest home a business-site footer: columns, badges, partner links', async () => {
    setPath('/');
    await mount();

    const footer = container.querySelector('.site-footer');
    expect(footer).not.toBeNull();
    // App badges stay (Play Store live, iOS chip marked coming soon).
    expect(footer.querySelector('a[href*="play.google.com/store/apps/details?id=com.mynaai"]')).not.toBeNull();
    expect(footer.textContent).toContain('COMING SOON');
    // Three link columns — Explore, Salon partners, Support & legal.
    expect(footer.querySelector('a[href="/about"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/faq"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/terms"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/privacy-policy"]')).not.toBeNull();
    expect(footer.querySelector('a[href="/salon-partner"]')).not.toBeNull();
    expect(footer.querySelectorAll('a[href="/login?role=SALON"]').length).toBeGreaterThan(0);
    expect(footer.querySelector('a[href="tel:8380017393"]')).not.toBeNull();
    expect(footer.querySelector('a[href="mailto:mynaai.in@gmail.com"]')).not.toBeNull();
    expect(footer.textContent).toContain('Salon partners');
  });

  it('shows a swipeable testimonial carousel right above the home footer', async () => {
    setPath('/');
    await mount();

    const section = container.querySelector('.testimonial-section');
    expect(section).not.toBeNull();
    // Real carousel: a scrollable track plus prev/next buttons, so any number
    // of reviews fits.
    expect(section.querySelector('.testimonial-track')).not.toBeNull();
    expect(section.querySelector('button[aria-label="Previous reviews"]')).not.toBeNull();
    expect(section.querySelector('button[aria-label="Next reviews"]')).not.toBeNull();
    expect(container.querySelectorAll('.testimonial-card').length).toBeGreaterThanOrEqual(4);
    // It sits directly before the footer, social proof on the way out.
    const children = Array.from(container.querySelector('.home-screen').children).map(node => node.className);
    expect(children.indexOf('testimonial-section')).toBe(children.indexOf('site-footer') - 1);
    // Mixed voices, and NO locations on any review — role only.
    expect(section.textContent).toContain('Salon partner');
    expect(section.textContent).toContain('Customer');
    expect(section.textContent).not.toContain('Nagpur');
    expect(section.textContent).not.toContain('Sitabuldi');
  });

  // The card is the whole "does this look like a review?" answer: a person
  // (avatar + name + role) at the top, the rating under it, the quote last.
  it('builds each review card as person → rating → quote', async () => {
    setPath('/');
    await mount();

    const card = container.querySelector('.testimonial-card');
    expect(card).not.toBeNull();
    const top = card.querySelector('.testimonial-card-top');
    expect(top).not.toBeNull();
    // The person leads: initials tile, then name and role.
    expect(top.querySelector('.testimonial-avatar').textContent.trim().length).toBeGreaterThanOrEqual(1);
    expect(top.querySelector('.testimonial-person strong').textContent.trim().length).toBeGreaterThan(1);
    expect(['Customer', 'Salon partner']).toContain(top.querySelector('.testimonial-person small').textContent.trim());
    // Rating and quote follow, in that order, and the quote is the blockquote.
    const children = Array.from(card.children).map(node => node.className.split(' ')[0] || node.tagName.toLowerCase());
    expect(children).toEqual(['testimonial-card-top', 'testimonial-stars', 'blockquote']);
    expect(card.querySelector('.testimonial-stars svg')).not.toBeNull();
    expect(card.querySelector('blockquote').textContent.trim().length).toBeGreaterThan(20);
  });

  it('opens the salon partner page and starts partner registration', async () => {
    goto('/salon-partner');
    await mount();

    // The public landing page sells the opportunity — no login gate.
    expect(container.querySelector('.partner-screen')).not.toBeNull();
    expect(container.querySelector('.auth-page')).toBeNull();
    expect(container.textContent).toContain('Your salon, fully booked.');
    expect(container.textContent).toContain('Live in three steps');
    expect(container.textContent).toContain('Register your salon');

    // Tapping register lands on login with the Salon partner role preselected.
    await act(async () => { buttonByText('Register your salon').click(); });
    await flush();
    expect(currentPath()).toBe('/login?role=SALON');
    expect(container.querySelector('.auth-page')).not.toBeNull();
    const roleButtons = Array.from(container.querySelectorAll('.role-switch button'));
    expect(roleButtons.some(b => b.classList.contains('active') && b.textContent.includes('Salon partner'))).toBe(true);
  });

  it('opens the website info pages to guests without a login gate', async () => {
    setPath('/about');
    await mount();

    expect(container.querySelector('.info-screen')).not.toBeNull();
    expect(container.textContent).toContain('About My Naai');
    expect(container.querySelector('.auth-page')).toBeNull();
    expect(container.querySelector('.site-footer')).not.toBeNull();

    // The About page reads like a company about page: story, vision, mission,
    // values — and a dedicated About-our-app section with the store badges.
    expect(container.textContent).toContain('Our vision');
    expect(container.textContent).toContain('Our mission');
    expect(container.textContent).toContain('What we value');
    expect(container.textContent).toContain('About our app');
    expect(container.querySelector('.info-screen .store-badges')).not.toBeNull();
    expect(container.querySelector('.info-screen a[href*="play.google.com/store/apps/details?id=com.mynaai"]')).not.toBeNull();

    await act(async () => { goto('/faq'); });
    await flush();
    expect(container.textContent).toContain('Frequently asked questions');
    expect(container.querySelector('.auth-page')).toBeNull();
  });

  it('renders full Terms and Privacy Policy pages for guests, linked from the footer', async () => {
    setPath('/terms');
    await mount();
    expect(container.querySelector('.legal-screen')).not.toBeNull();
    expect(container.textContent).toContain('Terms & Conditions');
    expect(container.textContent).toContain('Effective Date: 09 January 2026');
    expect(container.textContent).toContain('4. Payments');

    const privacyLink = container.querySelector('.site-footer a[href="/privacy-policy"]');
    expect(privacyLink).not.toBeNull();
    await act(async () => { privacyLink.click(); });
    await flush();
    expect(currentPath()).toBe('/privacy-policy');
    expect(container.textContent).toContain('Privacy Policy');
    expect(container.textContent).toContain('mynaai.in@gmail.com');
    expect(container.textContent).toContain('made directly at the salon');
    expect(container.querySelector('.auth-page')).toBeNull();
  });

  it('returns to the salon page when the guest backs out of logging in', async () => {
    setPath('/salon/salon-9');
    await mount();

    await act(async () => { buttonByText('Login to book').click(); });
    await flush();
    expect(currentPath()).toBe('/login');
    expect(sessionStorage.getItem('mynaaiPendingRoute')).toBe('/salon/salon-9');

    await act(async () => { buttonByText('Browse salons').click(); });
    await flush();
    expect(currentPath()).toBe('/salon/salon-9');
    expect(sessionStorage.getItem('mynaaiPendingRoute')).toBeNull();
    expect(container.querySelector('.detail-screen')).not.toBeNull();
  });

  // The navbar used to be one non-wrapping row (brand + four route links +
  // Install + Login) that overflowed a 320-430px phone and pushed the Login
  // pill off the screen. The links now live behind this toggle below 820px;
  // these assertions keep the toggle wired, and keep the Login pill in the bar.
  it('folds the site links into a menu toggle that works and closes itself', async () => {
    setPath('/');
    await mount();

    const header = container.querySelector('.site-navbar');
    const toggle = container.querySelector('.site-nav-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // The toggle owns the link list, and it does not sit inside it (the link
    // labels are menu items, not a fifth menu entry).
    expect(toggle.getAttribute('aria-controls')).toBe('site-nav-links');
    expect(container.querySelector('.site-nav-links').contains(toggle)).toBe(false);
    // The Login pill travels with the bar, never inside the folding panel.
    expect(container.querySelector('.site-navbar-actions .guest-login-button')).not.toBeNull();
    expect(header.querySelector('.site-nav-links')).not.toBeNull();

    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(header.classList.contains('menu-open')).toBe(true);

    // Choosing a destination navigates and folds the menu away again.
    await act(async () => { Array.from(container.querySelectorAll('.site-nav-links button')).find(node => node.textContent === 'Contact').click(); });
    await flush();
    expect(currentPath()).toBe('/contact');
    expect(container.querySelector('.site-navbar').classList.contains('menu-open')).toBe(false);
  });

  it('wraps the review carousel in a circle — after the last review comes the first', async () => {    setPath('/');
    await mount();

    const dots = () => Array.from(container.querySelectorAll('.testimonial-dots .carousel-dot'));
    const activeDotIndex = () => dots().findIndex(dot => dot.classList.contains('active'));
    const next = () => Array.from(container.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === 'Next reviews');
    const previous = () => Array.from(container.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === 'Previous reviews');
    const reviewCount = container.querySelectorAll('.testimonial-card').length;

    expect(reviewCount).toBeGreaterThanOrEqual(4);
    expect(dots().length).toBe(reviewCount);
    expect(activeDotIndex()).toBe(0);

    // Next on the last review returns to the first (circular, not clamped).
    for (let step = 0; step < reviewCount; step += 1) {
      await act(async () => { next().click(); });
    }
    expect(activeDotIndex()).toBe(0);

    // Previous on the first review wraps backwards to the last.
    await act(async () => { previous().click(); });
    expect(activeDotIndex()).toBe(reviewCount - 1);
    expect(container.querySelectorAll('.testimonial-card.active').length).toBe(1);
  });

  it('pages past the first 20 salons instead of stopping there', async () => {
    const pageOf = (page, count) => ({
      status: 'SUCCESS',
      data: {
        salons: Array.from({ length: count }, (item, index) => ({
          salonId: `salon-${page}-${index}`,
          salonName: `Salon ${page}-${index}`,
          genderType: 'UNISEX',
          address: 'Dharampeth, Nagpur',
          isOpen: true,
          waitTime: '5–10 min',
        })),
      },
    });
    // Page 1 is full (20 records, the API's page size) → there is more to fetch.
    userSalonListPublic.mockImplementation(payload => Promise.resolve(pageOf(Number(payload?.page) || 1, Number(payload?.page) === 2 ? 5 : 20)));

    setPath('/');
    await mount();
    await flush();

    expect(userSalonListPublic).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
    expect(container.querySelectorAll('.salon-card').length).toBe(20);
    const more = buttonByText('Load more salons');
    expect(more).not.toBeNull();

    await act(async () => { more.click(); });
    await flush();

    expect(userSalonListPublic).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    expect(container.querySelectorAll('.salon-card').length).toBe(25);
    // A short second page means that was the last one — the footer says so.
    expect(buttonByText('Load more salons')).toBeUndefined();
    expect(container.textContent).toContain('every salon we found near you');
  });

  it('reads the page metadata when the API sends it (total in the header count)', async () => {
    userSalonListPublic.mockResolvedValue({
      status: 'SUCCESS',
      data: {
        salons: Array.from({ length: 20 }, (item, index) => ({ salonId: `salon-${index}`, salonName: `Salon ${index}`, genderType: 'UNISEX', address: 'Dharampeth, Nagpur', isOpen: true, waitTime: '5–10 min' })),
        hasMore: true,
        totalCount: 25,
      },
    });

    setPath('/');
    await mount();
    await flush();

    // 20 on screen, 25 in the city: the heading says so instead of pretending
    // the first page is everything.
    expect(container.textContent).toContain('20 of 25 places');
    expect(buttonByText('Load more salons')).not.toBeNull();
  });

  it('stops paging when the API repeats itself instead of looping forever', async () => {
    const samePage = () => ({ status: 'SUCCESS', data: { salons: Array.from({ length: 20 }, (item, index) => ({ salonId: `salon-${index}`, salonName: `Salon ${index}`, genderType: 'UNISEX', address: 'Dharampeth, Nagpur', isOpen: true, waitTime: '5–10 min' })) } });
    userSalonListPublic.mockImplementation(() => Promise.resolve(samePage()));

    setPath('/');
    await mount();
    await flush();
    expect(container.querySelectorAll('.salon-card').length).toBe(20);

    await act(async () => { buttonByText('Load more salons').click(); });
    await flush();

    // The duplicate page added nothing and ended the paging — 20 cards, no
    // duplicate keys, and no further Load more button.
    expect(userSalonListPublic).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('.salon-card').length).toBe(20);
    expect(buttonByText('Load more salons')).toBeUndefined();
  });
});

// The ad band on the guest home. A laptop frame is far wider than the artwork,
// so `object-fit: cover` used to crop a third of every ad away on desktop while
// phones looked fine. Each slide now carries its own blurred backdrop and shows
// the artwork whole — this pins the markup that the CSS depends on.
describe('Home ad carousel', () => {
  let container;
  let root;

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  beforeEach(() => {
    setPath('/');
    localStorage.clear();
    userSalonListPublic.mockResolvedValue({ status: 'SUCCESS', data: { salons: [] } });
    userAds.mockResolvedValue({
      status: 'SUCCESS',
      data: { images: ['/assets/naai/ad1.jpg', '/assets/naai/ad2.jpg'] },
    });
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'needs-permission', reason: '' });
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it('renders every ad whole, with the backdrop that fills the frame', async () => {
    await mount();

    const slides = container.querySelectorAll('.ad-slide');
    expect(slides.length).toBe(2);
    slides.forEach(slide => {
      // The artwork itself (shown in full, never cropped)…
      expect(slide.querySelector('img.ad-image')).not.toBeNull();
      // …and the blurred copy that fills whatever the frame leaves over.
      const backdrop = slide.querySelector('.ad-backdrop');
      expect(backdrop).not.toBeNull();
      expect(backdrop.getAttribute('style')).toContain('ad');
    });
  });

  it('measures the artwork and drives the frame from it, not from a guess', async () => {
    await mount();

    // None of the test images ever "load" in jsdom, so the frame falls back to
    // the 3:2 default until an image reports its real size.
    const wrap = container.querySelector('.ad-carousel-wrap');
    expect(wrap.getAttribute('style')).toBeNull();

    // A 16:9 creative is the common case from the API. Once it loads, the CSS
    // variable carries the real ratio — this is what stops a laptop frame from
    // cropping (and stops a 16:9 ad from being letterboxed inside a 3:2 box).
    const image = container.querySelector('img.ad-image');
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1920 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1080 });
    await act(async () => { image.dispatchEvent(new Event('load', { bubbles: true })); });

    expect(container.querySelector('.ad-carousel-wrap').getAttribute('style')).toContain('1.7778');
  });

  it('keeps the hero band single-column until there is a promo to sit beside the filters', async () => {
    userAds.mockResolvedValue({ status: 'SUCCESS', data: { images: [] } });
    await mount();

    // No ads: the band must not reserve an empty second column on a laptop.
    const band = container.querySelector('.home-hero-band');
    expect(band.classList.contains('has-ads')).toBe(false);
    expect(band.querySelector('.ad-carousel-wrap')).toBeNull();
  });
});

// The home-screen location row asks the native geolocation API from the tap,
// preserves the settings recovery route after a real denial, and gives embedded
// previews a small inline status instead of a silent return or replacement popup.
describe('Home location permission', () => {
  let container;
  let root;
  let originalGeolocation;

  const buttonByText = text => Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim().includes(text));
  const notice = () => container.querySelector('.location-fallback-notice');

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  const salonPayload = () => ({
    status: 'SUCCESS',
    data: {
      salons: [{
        salonId: 'salon-9', salonName: 'Golden Scissors', genderType: 'UNISEX',
        address: 'Dharampeth, Nagpur', isOpen: true, waitTime: '5–10 min',
      }],
    },
  });

  const setLivePermission = state => {
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(async () => ({ state, onchange: null })) },
    });
  };

  beforeEach(() => {
    originalGeolocation = navigator.geolocation;
    setPath('/');
    localStorage.clear();
    userSalonListPublic.mockResolvedValue(salonPayload());
    vi.mocked(push.getPushStatus).mockReset().mockResolvedValue({ state: 'needs-permission', reason: '' });
    vi.mocked(push.getPushToken).mockReset().mockResolvedValue('');
    vi.mocked(permissions.isIosDevice).mockReset().mockReturnValue(false);
    vi.mocked(permissions.isEmbeddedFrame).mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete navigator.permissions;
    if (originalGeolocation) navigator.geolocation = originalGeolocation;
    else delete navigator.geolocation;
    vi.clearAllMocks();
  });

  it('asks the browser and re-sorts the list when the tap can actually prompt', async () => {
    // jsdom ships no geolocation; this is the "user allows the prompt" path.
    navigator.geolocation = {
      getCurrentPosition: vi.fn(success => success({ coords: { latitude: 21.1458, longitude: 79.0882 } })),
    };
    await mount();

    const enableButton = buttonByText('Use my location');
    expect(enableButton).not.toBeNull();
    expect(notice().textContent).toContain('not sorted by distance');

    await act(async () => { enableButton.click(); });
    await flush();

    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    // The coordinates reached the salon list, so distances can be shown.
    const lastCall = userSalonListPublic.mock.calls.at(-1)[0];
    expect(lastCall.latitude).toBeCloseTo(21.1458, 3);
    expect(lastCall.longitude).toBeCloseTo(79.0882, 3);
    // …and the notice retires itself because the list is now distance-sorted.
    expect(container.querySelector('.location-fallback-notice')).toBeNull();
  });

  it('calls geolocation from the home-page tap before waiting on permission status', async () => {
    const getCurrentPosition = vi.fn(success => success({ coords: { latitude: 21.1458, longitude: 79.0882 } }));
    navigator.geolocation = { getCurrentPosition };
    await mount();

    // If the handler regresses to an async permission pre-check, it will stall
    // here and the native API will never receive the original user gesture.
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(() => new Promise(() => {})) },
    });
    act(() => { buttonByText('Use my location').click(); });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await flush();
  });

  it('never lets a click event leak into the salon-list request', async () => {
    // The same loader is wired to onClick handlers ("Try again"), and a
    // PointerEvent is not a coordinate. A failed load must not turn into a
    // request carrying an event object.
    userSalonListPublic.mockRejectedValueOnce(new Error('network down'));
    await mount();
    await act(async () => { buttonByText('Try again')?.click(); });
    await flush();

    const lastCall = userSalonListPublic.mock.calls.at(-1)[0];
    expect(lastCall).toEqual({ page: 1, searchString: '', genderType: 'male' });
  });

  it('keeps the settings recovery route after a location denial', async () => {
    setLivePermission('denied');
    const getCurrentPosition = vi.fn((_success, fail) => fail({ code: 1, message: 'Permission denied' }));
    navigator.geolocation = { getCurrentPosition };
    await mount();

    await act(async () => { buttonByText('Use my location').click(); });
    await flush();

    // The native API is still called from the tap; once the browser reports a
    // real denial, the settings recovery route is shown.
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const sheet = container.querySelector('.permission-gate-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain('Location is blocked');
    expect(sheet.querySelectorAll('.ios-install-steps li')).toHaveLength(3);
    expect(buttonByText('I allowed it — Try again')).not.toBeNull();
  });

  it('gives a non-modal inline note when the preview policy suppresses the native prompt', async () => {
    const getCurrentPosition = vi.fn((_success, fail) => fail({ code: 1, message: 'Blocked by frame policy' }));
    navigator.geolocation = { getCurrentPosition };
    Object.defineProperty(document, 'permissionsPolicy', {
      value: { allowsFeature: () => false },
      configurable: true,
    });
    const openSpy = vi.spyOn(window, 'open');
    try {
      await mount();
      await act(async () => { buttonByText('Use my location').click(); });
      await flush();

      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.permission-gate-sheet')).toBeNull();
      expect(container.querySelector('.location-request-note').textContent).toContain('cannot show the native location prompt');
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
      delete document.permissionsPolicy;
    }
  });
});

// The home page is where people land, so the booking-alerts ask lives there too
// — next to the location ask, in the same labelled, non-nagging shape. Before
// this, a visitor who saw the location popup had no way at all to trigger the
// notification one ("location shows, notifications never does").
describe('Home booking alerts ask', () => {
  let container;
  let root;

  const buttonByText = text => Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim().includes(text));
  const invite = () => container.querySelector('.alerts-invite-notice');

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  beforeEach(() => {
    setPath('/');
    localStorage.clear();
    userSalonListPublic.mockResolvedValue({
      status: 'SUCCESS',
      data: { salons: [{ salonId: 'salon-9', salonName: 'Golden Scissors', genderType: 'UNISEX', address: 'Dharampeth, Nagpur', isOpen: true, waitTime: '5–10 min' }] },
    });
    vi.mocked(push.getPushStatus).mockReset().mockResolvedValue({ state: 'needs-permission', reason: '' });
    vi.mocked(push.isPushConfigured).mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete globalThis.Notification;
    delete navigator.permissions;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('offers one labelled tap that opens the browser prompt, and retires itself on a grant', async () => {
    globalThis.Notification = {
      permission: 'default',
      requestPermission: vi.fn(() => {
        globalThis.Notification.permission = 'granted';
        return Promise.resolve('granted');
      }),
    };
    await mount();

    expect(invite()).not.toBeNull();
    expect(invite().textContent).toContain('Turn on booking alerts');
    // Never a surprise popup: nothing is asked until the tap.
    expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();

    await act(async () => { buttonByText('Turn on').click(); });
    await flush();

    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.alerts-invite-notice')).toBeNull();
    expect(container.querySelector('.toast')?.textContent).toContain('Booking alerts on');
  });

  it('remembers "Not now" instead of nagging on the next visit', async () => {
    globalThis.Notification = { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('default')) };
    await mount();
    expect(invite()).not.toBeNull();

    await act(async () => { buttonByText('Not now').click(); });
    await flush();
    expect(container.querySelector('.alerts-invite-notice')).toBeNull();
    expect(localStorage.getItem('mynaaiPermissionAsk:notifications')).toBe('later');

    // A fresh mount stays quiet — the choice was remembered.
    act(() => root.unmount());
    container.remove();
    await mount();
    expect(container.querySelector('.alerts-invite-notice')).toBeNull();
  });

  it('says why no prompt can appear instead of leaving a dead button', async () => {
    // Chrome's quieter-messaging UI resolves the ask with nothing on screen.
    globalThis.Notification = { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('default')) };
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await mount();

    await act(async () => { buttonByText('Turn on').click(); });
    await flush();
    expect(container.querySelector('.location-request-note').textContent).toMatch(/bell|address bar/i);
  });

  it('tells an in-app browser (WhatsApp, Instagram …) to open a real browser', async () => {
    // An app's WebView prompts for location but can NEVER prompt for
    // notifications: the API is missing or answers 'denied' instantly. No site
    // setting can fix that, so the row must name the way out — and must not
    // spend the tap on a call that cannot work.
    delete globalThis.Notification;
    const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.9.78');
    try {
      await mount();
      expect(invite()).not.toBeNull();

      await act(async () => { buttonByText('How to allow').click(); });
      await flush();

      const note = container.querySelector('.location-request-note').textContent;
      expect(note).toContain('WhatsApp');
      expect(note).toContain('Open mynaai.in in Chrome or Safari');
    } finally {
      agent.mockRestore();
    }
  });
});

// Login permission flow.
//
// What these tests protect (all of it is why users were being lost):
//   · the browser's permission popup NEVER fires from an unrelated tap — it is
//     always attached to a labelled button or the Continue tap, so a visitor
//     cannot lose their alerts to a surprise prompt;
//   · the ask is ONE tap: the login card sits on the page from the first paint,
//     and the popup opens inside that tap (gesture-safe);
//   · a blocked / unsupported browser never blocks sign-in. The API is the only
//     thing allowed to insist on a deviceToken, and when it does the sheet says
//     so plainly and retries the exact request by itself once alerts are on.
describe('Login permission flow', () => {
  let container;
  let root;
  let originalGeolocation;
  let originalPermissions;

  const setNotificationPermission = permission => {
    globalThis.Notification = { permission, requestPermission: vi.fn().mockResolvedValue(permission) };
  };

  // A browser that grants the permission when the user taps Allow: the stub
  // flips the live value, exactly like a real browser does.
  const grantOnRequest = () => {
    globalThis.Notification = {
      permission: 'default',
      requestPermission: vi.fn(() => {
        globalThis.Notification.permission = 'granted';
        return Promise.resolve('granted');
      }),
    };
  };

  const typeMobile = value => {
    const input = container.querySelector('.phone-input input');
    // React tracks the value of controlled inputs, so the native setter has to
    // be used before the input event or onChange never fires.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const submitPhone = () => {
    const form = container.querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  const buttonByText = text => Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim().includes(text));
  const notificationAllowButton = () => container.querySelector('.login-perm-card .allow-alerts-button');
  const locationAllowButton = () => container.querySelector('.login-perm-card .perm-location-button');

  const headings = () => Array.from(container.querySelectorAll('h1')).map(node => node.textContent);

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  beforeEach(() => {
    originalGeolocation = navigator.geolocation;
    originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
    // Browsing is public now, so a bare path opens the guest home — these tests
    // target the login flow, which lives at its own route.
    setPath('/login');
    vi.mocked(push.getPushStatus).mockReset().mockResolvedValue({ state: 'needs-permission', reason: '' });
    vi.mocked(push.getPushToken).mockReset().mockResolvedValue('');
    vi.mocked(push.isPushConfigured).mockReset().mockReturnValue(true);
    vi.mocked(permissions.isEmbeddedFrame).mockReset().mockReturnValue(false);
    vi.mocked(permissions.isIosDevice).mockReset().mockReturnValue(false);
    vi.mocked(permissions.isIosPwaInstalled).mockReset().mockReturnValue(false);
    vi.mocked(api.userLogin).mockReset().mockResolvedValue({ status: 'SUCCESS', data: {} });
    vi.mocked(api.verifyLogin).mockReset().mockResolvedValue({ status: 'SUCCESS', data: { token: 'session-token', userId: 'user-1' } });
    localStorage.removeItem('mynaaiPermissionAsk:location');
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete globalThis.Notification;
    if (originalGeolocation) navigator.geolocation = originalGeolocation;
    else delete navigator.geolocation;
    if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions);
    else delete navigator.permissions;
    vi.clearAllMocks();
  });

  it('still shows the notification row without alerts config, and the tap asks the browser', async () => {
    // A build with no Firebase config cannot mint a device token, but the
    // notification PERMISSION is still exactly what the visitor can give — and
    // it is the thing the login page exists to ask for. The row must be on the
    // page, and its button must open the browser's own prompt.
    grantOnRequest();
    vi.mocked(push.isPushConfigured).mockReturnValue(false);
    await mount();

    expect(container.querySelector('.setup-splash')).toBeNull();
    expect(container.textContent).not.toContain('not set up for web alerts');
    const row = container.querySelector('.login-perm-card .perm-row-copy strong');
    expect(row.textContent).toBe('Notifications');
    const allowButton = notificationAllowButton();
    expect(allowButton).not.toBeNull();
    expect(allowButton.textContent.trim()).toBe('Allow');
    expect(allowButton.getAttribute('aria-label')).toBe('Allow notifications');

    await act(async () => { allowButton.click(); });
    await flush();
    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
    // Permission banked, nothing left to ask on this page — and no broken state.
    expect(container.querySelector('.allow-alerts-button')).toBeNull();
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();

    // Sign-in still proceeds without a device token.
    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    await flush();
    expect(push.getPushToken).not.toHaveBeenCalled();
    expect(headings().some(text => /Check your phone/.test(text))).toBe(true);
  });

  // The two taps below are asserted INSIDE the tap's own synchronous turn: the
  // browser API must already have been invoked by the time the click handler
  // returns. Safari silently drops a permission popup requested after an
  // `await` (src/lib/permissions.js, rule 3), so "it worked in a test that
  // flushed promises first" is not the guarantee that matters — this is.
  it('opens the browser notification prompt from the Allow tap itself, before any promise resolves', async () => {
    const requestPermission = vi.fn(() => {
      globalThis.Notification.permission = 'granted';
      return Promise.resolve('granted');
    });
    globalThis.Notification = { permission: 'default', requestPermission };
    // A live-permission read that never answers: anything that awaited a
    // permission status (or a device token) before asking would never reach
    // requestPermission at all.
    Object.defineProperty(navigator, 'permissions', {
      value: { query: vi.fn(() => new Promise(() => {})) },
      configurable: true,
    });
    await mount();

    const allowButton = notificationAllowButton();
    expect(allowButton).not.toBeNull();
    await act(async () => {
      allowButton.click();
      expect(requestPermission).toHaveBeenCalledTimes(1);
    });
    await flush();
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
  });

  it('opens the browser location prompt from the Allow tap itself, before any promise resolves', async () => {
    setNotificationPermission('granted');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'enabled', token: 'push-token-geo' });
    const getCurrentPosition = vi.fn(success => success({ coords: { latitude: 21.1458, longitude: 79.0882 } }));
    navigator.geolocation = { getCurrentPosition };
    // Safari does not expose location permission through navigator.permissions,
    // so the read falls back to 'default' and the row stays on the page.
    delete navigator.permissions;
    await mount();

    const allowButton = locationAllowButton();
    expect(allowButton).not.toBeNull();
    await act(async () => {
      allowButton.click();
      // The native geolocation call — the one that shows the browser's own
      // "Allow location" popup — happened in the tap itself.
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    });
    await flush();
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
  });

  it('explains a cross-origin frame instead of spending the tap on a doomed ask', async () => {
    // Chrome and Firefox refuse Notification.requestPermission() inside a
    // cross-origin frame, so a tap there can never produce a prompt: the card
    // says what to do (open My Naai in its own tab) rather than firing a call
    // that silently fails — and still substitutes neither a popup nor a tab.
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    const openSpy = vi.spyOn(window, 'open');
    try {
      await withCrossOriginFrame(async () => {
        await mount();
        const card = container.querySelector('.login-perm-card');
        expect(card.textContent).not.toMatch(/blocked|open in browser|how to allow/i);

        await act(async () => { notificationAllowButton().click(); });
        await flush();

        expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
        expect(openSpy).not.toHaveBeenCalled();
        expect(container.querySelector('.permission-gate-sheet')).toBeNull();
        expect(container.querySelector('.perm-card-note').textContent).toContain('cannot show the notifications prompt');
      });
    } finally {
      openSpy.mockRestore();
    }
  });

  it('never calls an ordinary live page a preview when the policy does not know "notifications"', async () => {
    // Chrome answers `featurePolicy.allowsFeature('notifications') === false` on
    // EVERY page: the Notifications API has no Permissions Policy directive, so
    // the name is unrecognized. Reading that as "embedded preview" is exactly how
    // the live site ended up telling visitors to "try the live site".
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    Object.defineProperty(document, 'featurePolicy', {
      value: {
        features: () => ['geolocation', 'camera', 'microphone'],
        allowedFeatures: () => ['geolocation', 'camera', 'microphone'],
        allowsFeature: () => false,
      },
      configurable: true,
    });
    try {
      await mount();
      expect(notificationAllowButton()).not.toBeNull();

      await act(async () => { notificationAllowButton().click(); });
      await flush();

      // A denial on a normal page gets the real browser-settings route…
      expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.perm-card-note').textContent).toContain('Change Notifications in browser site settings');
      // …and never the preview copy.
      expect(container.textContent).not.toContain('Try the live site');
    } finally {
      delete document.featurePolicy;
    }
  });

  it('calls the native notification API from Allow when a frame has not asked yet', async () => {
    setNotificationPermission('default');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'needs-permission', reason: '' });
    Object.defineProperty(document, 'permissionsPolicy', {
      value: { allowsFeature: feature => feature !== 'notifications' },
      configurable: true,
    });
    const openSpy = vi.spyOn(window, 'open');
    try {
      await mount();

      expect(notificationAllowButton().textContent.trim()).toBe('Allow');
      await act(async () => { notificationAllowButton().click(); });
      await flush();

      expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
      expect(openSpy).not.toHaveBeenCalled();
      expect(container.querySelector('.permission-gate-sheet')).toBeNull();
    } finally {
      openSpy.mockRestore();
      delete document.permissionsPolicy;
    }
  });

  it('retries the native notification request directly after a previous denial', async () => {
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    Object.defineProperty(document, 'permissionsPolicy', { value: { allowsFeature: () => true }, configurable: true });
    try {
      await mount();
      expect(notificationAllowButton().textContent.trim()).toBe('Allow');

      await act(async () => { notificationAllowButton().click(); });
      await flush();

      expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.permission-gate-sheet')).toBeNull();
      expect(notificationAllowButton()).not.toBeNull();
    } finally {
      delete document.permissionsPolicy;
    }
  });

  it('never sends a cached or earlier in-memory token when Firebase cannot return a live one', async () => {
    grantOnRequest();
    // Simulate the permission card having held a token from an earlier
    // subscription, while the authoritative Firebase read used by verify now
    // fails. Neither value is valid input for the OTP request.
    vi.mocked(push.getPushToken)
      .mockResolvedValueOnce('old-in-memory-token')
      .mockResolvedValue('');
    localStorage.setItem('FCM_TOKEN', 'old-cached-token');
    await mount();

    await act(async () => { notificationAllowButton().click(); });
    await flush();
    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    await flush();
    await act(async () => { typeOtp('123456'); });
    await act(async () => { submitForm(); });
    await flush();

    expect(api.verifyLogin).toHaveBeenCalledTimes(1);
    expect(api.verifyLogin.mock.calls[0][0]).toEqual({ phoneNumber: '9876543210', otp: '123456' });
    localStorage.removeItem('FCM_TOKEN');
  });

  it('asks once — from the Allow button, inside the tap, and never as a surprise', async () => {
    grantOnRequest();
    vi.mocked(push.getPushToken).mockResolvedValue('push-token-1');
    await mount();

    // The ask is on the page from the first paint: compact, labelled rows for
    // notifications and location, with no explanatory copy taking phone space.
    const card = container.querySelector('.login-perm-card');
    expect(card).not.toBeNull();
    expect(card.querySelectorAll('.perm-row')).toHaveLength(2);
    expect(card.querySelector('.perm-row-copy strong').textContent).toBe('Notifications');
    expect(notificationAllowButton()).not.toBeNull();
    expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();

    // An unrelated tap (switching role, tapping the page) must NOT open the
    // browser popup: that surprise is what made people hit Block for good.
    await act(async () => { window.dispatchEvent(new Event('pointerdown')); });
    await act(async () => { buttonByText('Salon partner').click(); });
    await flush();
    expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();

    // The labelled button does it: one tap, popup, token, row gone.
    await act(async () => { notificationAllowButton().click(); });
    await flush();
    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(push.getPushToken).toHaveBeenCalledWith({ requestPermission: false });
    // The alerts row removes itself once alerts are on — login carries no dead
    // weight (the optional location row may still be waiting for an answer).
    expect(container.querySelector('.allow-alerts-button')).toBeNull();
  });

  it('a granted permission never leaves an error row behind — the token finishes in the background', async () => {
    // Reported: "I allow the pop-up and it still shows the error." Once the
    // browser's own popup has been answered with Allow, the permission is ON and
    // the row is done — minting the device token is My Naai's half of the job, and
    // it is retried in the background (lib/push.js) with the row left out of the
    // way. "The last setup step did not finish" is our problem, not the
    // visitor's, so it must never be parked in front of them as an error.
    grantOnRequest();
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'unavailable', reason: '' });
    vi.mocked(push.getPushToken).mockResolvedValue('');
    await mount();

    const card = container.querySelector('.login-perm-card');
    expect(card.textContent).toContain('Alerts allowed');
    expect(buttonByText('Try again')).not.toBeNull();
    expect(card.textContent).not.toContain('did not finish');
    expect(card.textContent).not.toContain('still works on the second try');

    // The tap retries our side; the browser is already allowed, so the row goes
    // and nothing scary takes its place.
    await act(async () => { buttonByText('Try again').click(); });
    await flush();
    expect(container.querySelector('.allow-alerts-button')).toBeNull();
    expect(container.textContent).not.toContain('did not finish');
  });

  it('asks in the same tap as Continue with OTP, then sends it', async () => {
    grantOnRequest();
    // Exactly like the real thing: the silent read finds nothing until the user
    // has actually granted the permission.
    vi.mocked(push.getPushToken).mockImplementation(async () => (globalThis.Notification.permission === 'granted' ? 'push-token-2' : ''));
    await mount();

    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    await flush();

    // The submit tap is the gesture, so the browser popup opened right there and
    // the OTP request went out without any extra step for the user. (The token
    // itself rides the verify/onboarding call, as the mobile contract does.)
    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(api.userLogin).toHaveBeenCalledWith({ phoneNumber: '9876543210' });
    expect(headings().some(text => /Check your phone/.test(text))).toBe(true);
  });

  it('still asks from the Continue tap on a live page whose policy does not know "notifications"', async () => {
    // Chrome's featurePolicy answers false for `allowsFeature('notifications')`
    // on every page (no such directive exists), so the old sync gate skipped both
    // the ask and the device-token mint on a perfectly ordinary live tab — a
    // visitor who allowed alerts never got a token on the server.
    grantOnRequest();
    vi.mocked(push.getPushToken).mockImplementation(async () => (globalThis.Notification.permission === 'granted' ? 'push-token-live' : ''));
    Object.defineProperty(document, 'featurePolicy', {
      value: {
        features: () => ['geolocation', 'camera'],
        allowedFeatures: () => ['geolocation', 'camera'],
        allowsFeature: () => false,
      },
      configurable: true,
    });
    try {
      await mount();
      await act(async () => { typeMobile('9876543210'); });
      await act(async () => { submitPhone(); });
      await flush();

      expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
      expect(api.userLogin).toHaveBeenCalledWith({ phoneNumber: '9876543210' });
      expect(headings().some(text => /Check your phone/.test(text))).toBe(true);
    } finally {
      delete document.featurePolicy;
    }
  });

  const typeOtp = value => {
    const input = container.querySelector('.otp-input');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const submitForm = () => {
    const form = container.querySelector('form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };

  it('a blocked browser never blocks sign-in — the API decides, not the popup', async () => {
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    await mount();

    // The blocked state is one honest row (no wall of instructions, no sheet).
    expect(notificationAllowButton()).not.toBeNull();
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();

    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    await flush();

    // No popup was attempted and sign-in still reached the OTP step, with no
    // deviceToken key at all (not an empty string).
    expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
    expect(api.userLogin).toHaveBeenCalledTimes(1);
    expect(api.userLogin.mock.calls[0][0]).toEqual({ phoneNumber: '9876543210' });
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
    expect(headings().some(text => /Check your phone/.test(text))).toBe(true);
  });

  it('names the Android app-level switch when a denied site setting cannot prompt', async () => {
    // On Android 13+ (and OEM builds) the site setting stays stuck at Blocked
    // while the browser app's own notifications are off, so the tap can never
    // produce a prompt. Saying only "browser site settings" leaves an Android
    // tester tapping a button that looks dead.
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36');
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    try {
      await mount();

      await act(async () => { notificationAllowButton().click(); });
      await flush();

      const note = container.querySelector('.perm-card-note').textContent;
      expect(note).toContain('browser site settings');
      expect(note).toContain('Android Settings → Apps');
      expect(note).toContain('Notifications → On');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('keeps the Allow button native after notification permission is denied', async () => {
    globalThis.Notification = {
      permission: 'default',
      requestPermission: vi.fn(() => {
        globalThis.Notification.permission = 'denied';
        return Promise.resolve('denied');
      }),
    };
    vi.mocked(push.getPushStatus).mockImplementation(async () => ({
      state: globalThis.Notification.permission === 'denied' ? 'denied' : 'needs-permission',
      reason: '',
    }));
    await mount();

    await act(async () => { notificationAllowButton().click(); });
    await flush();
    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
    expect(notificationAllowButton()?.textContent.trim()).toBe('Allow');

    // Browsers do not re-prompt after a denial. A later tap still calls the
    // native API, but never substitutes a My Naai dialog or new browser tab.
    await act(async () => { notificationAllowButton().click(); });
    await flush();
    expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
  });

  it('keeps the login location Allow action native after a browser denial', async () => {
    setNotificationPermission('granted');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'enabled', token: 'push-token-location' });
    const getCurrentPosition = vi.fn((_success, fail) => fail({ code: 1, message: 'Permission denied' }));
    navigator.geolocation = { getCurrentPosition };
    // Safari does not expose location permission through navigator.permissions.
    delete navigator.permissions;
    await mount();

    expect(locationAllowButton().textContent.trim()).toBe('Allow');
    await act(async () => { locationAllowButton().click(); });
    await flush();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
    expect(container.querySelector('.login-perm-card .perm-row-copy strong').textContent).toBe('Location');

    // Another tap calls the browser API again but never opens a My Naai popup.
    await act(async () => { locationAllowButton().click(); });
    await flush();
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
  });

  it('calls the native geolocation API from Allow without opening a page or app dialog', async () => {
    setNotificationPermission('granted');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'enabled', token: 'push-token-location' });
    const getCurrentPosition = vi.fn((_success, fail) => fail({ code: 1, message: 'Permission denied by policy' }));
    navigator.geolocation = { getCurrentPosition };
    Object.defineProperty(navigator, 'permissions', {
      value: { query: vi.fn(async ({ name }) => ({ state: name === 'geolocation' ? 'denied' : 'granted' })) },
      configurable: true,
    });
    Object.defineProperty(document, 'permissionsPolicy', {
      value: { allowsFeature: feature => feature !== 'geolocation' },
      configurable: true,
    });
    const openSpy = vi.spyOn(window, 'open');
    try {
      await mount();

      const card = container.querySelector('.login-perm-card');
      const allowButton = locationAllowButton();
      expect(card.querySelector('.perm-row-copy strong').textContent).toBe('Location');
      expect(card.textContent).not.toMatch(/blocked|open in browser|how to allow/i);
      expect(allowButton.textContent.trim()).toBe('Allow');
      await act(async () => { allowButton.click(); });
      await flush();

      // The native geolocation API receives the tap. The browser's frame policy
      // can still deny it, but My Naai opens no modal or extra tab.
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      expect(openSpy).not.toHaveBeenCalled();
      expect(container.querySelector('.permission-gate-sheet')).toBeNull();
      expect(container.querySelector('.perm-card-note').textContent).toContain('cannot show the location prompt');
    } finally {
      openSpy.mockRestore();
      delete document.permissionsPolicy;
    }
  });

  it('if the API insists on a deviceToken, the sheet explains it and retries by itself', async () => {
    // A visitor who blocked alerts earlier: they can still reach the OTP step,
    // and only the API's own refusal (verification carries the deviceToken in
    // the mobile contract) turns into the one-tap alerts sheet.
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    vi.mocked(push.getPushToken).mockResolvedValue('');
    vi.mocked(api.verifyLogin)
      .mockRejectedValueOnce(Object.assign(new Error('"deviceToken" is required'), { data: { message: '"deviceToken" is required' } }))
      .mockResolvedValue({ status: 'SUCCESS', data: { token: 'session-token', userId: 'user-1' } });
    await mount();

    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    await flush();
    expect(headings().some(text => /Check your phone/.test(text))).toBe(true);

    await act(async () => { typeOtp('123456'); });
    await act(async () => { submitForm(); });
    await flush();

    // The refusal opens the alerts sheet and says why in one plain sentence —
    // never the raw API string.
    const sheet = container.querySelector('.permission-gate-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet.textContent).toContain('Alerts are blocked');
    expect(container.querySelector('.form-error').textContent).toContain('Alerts are switched off');

    // The user follows the three steps and taps Try again; the sheet closes, the
    // token lands and the SAME verification is retried automatically — no second
    // trip through the form.
    grantOnRequest();
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'enabled', token: 'push-token-3' });
    vi.mocked(push.getPushToken).mockImplementation(async () => (globalThis.Notification.permission === 'granted' ? 'push-token-3' : ''));
    await act(async () => { buttonByText('I allowed it — Try again').click(); });
    await flush();
    expect(api.verifyLogin).toHaveBeenCalledTimes(2);
    expect(api.verifyLogin.mock.calls[1][0]).toEqual({ phoneNumber: '9876543210', otp: '123456', deviceToken: 'push-token-3' });
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
  });

  it('when the API insists on a token the user already allowed, it says so instead of asking again', async () => {
    // Reported from a phone: "I allow the pop and it still shows the error."
    // Here the browser's popup WAS answered with Allow — the device token is what
    // the API refused over. The form line and the sheet must both reflect that
    // instead of repeating "turn on booking alerts … choose Allow".
    grantOnRequest();
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'unavailable', reason: 'Notifications are allowed on this device — the last step is still finishing.' });
    vi.mocked(push.getPushToken).mockResolvedValue('');
    vi.mocked(api.userLogin).mockResolvedValue({ status: 'SUCCESS', data: {} });
    vi.mocked(api.verifyLogin)
      .mockRejectedValueOnce(Object.assign(new Error('"deviceToken" is required'), { data: { message: '"deviceToken" is required' } }))
      .mockResolvedValue({ status: 'SUCCESS', data: { token: 'session-token', userId: 'user-1' } });
    await mount();

    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    // Allow was just tapped: the token is minted with a few patient retries
    // (the server stores whatever login carries) before the OTP is requested.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 2300)); });
    await flush();
    await act(async () => { typeOtp('123456'); });
    await act(async () => { submitForm(); });
    await flush();

    const formError = container.querySelector('.form-error');
    expect(formError.textContent).toContain('Notifications are allowed on this device');
    expect(formError.textContent).not.toContain('choose Allow');
    const sheet = container.querySelector('.permission-gate-sheet');
    expect(sheet.textContent).toContain('Alerts are allowed — finishing setup');
    expect(sheet.textContent).not.toContain('Still off');
    expect(sheet.textContent).not.toContain('Switch Notifications back on');

    // The background retry lands a token: the sheet closes and the SAME
    // verification goes through without the user doing anything.
    vi.mocked(push.getPushToken).mockResolvedValue('push-token-late');
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mynaai:push-token', { detail: { token: 'push-token-late' } }));
    });
    await flush();
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
  });

  it('does not open a My Naai dialog when an already-denied notification is tapped', async () => {
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    const openSpy = vi.spyOn(window, 'open');
    try {
      await mount();
      await act(async () => { notificationAllowButton().click(); });
      await flush();

      expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.permission-gate-sheet')).toBeNull();
      expect(openSpy).not.toHaveBeenCalled();
      expect(notificationAllowButton()?.textContent.trim()).toBe('Allow');
    } finally {
      openSpy.mockRestore();
    }
  });

  // An iPhone has to be simulated at the browser level: the shipped rule
  // (canAskForAlerts/alertsPromptFallback in lib/permissions) reads the user
  // agent and matchMedia itself, exactly as it does in Safari.
  const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';
  const withIosDevice = async (standalone, run) => {
    const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = () => ({ matches: standalone });
    try {
      await run();
    } finally {
      agent.mockRestore();
      window.matchMedia = originalMatchMedia;
    }
  };

  it('sends an iPhone tab to the Home Screen instead of spending the tap on a prompt iOS refuses', async () => {
    // iOS gives web notifications only to an app on the Home Screen: in a Safari
    // (or Chrome) tab `Notification.requestPermission()` resolves 'denied' without
    // ever showing a prompt — while a location popup at the same moment shows
    // normally. So the tap says the real next step and never burns the permission.
    setNotificationPermission('default');
    const openSpy = vi.spyOn(window, 'open');
    try {
      await withIosDevice(false, async () => {
        await mount();

        await act(async () => { notificationAllowButton().click(); });
        await flush();
        expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
        expect(container.querySelector('.perm-card-note').textContent).toContain('Home Screen');
        expect(container.querySelector('.permission-gate-sheet')).toBeNull();
        expect(openSpy).not.toHaveBeenCalled();

        // …and Continue must not ask behind their back either.
        await act(async () => { typeMobile('9876543210'); });
        await act(async () => { submitPhone(); });
        await flush();
        expect(globalThis.Notification.requestPermission).not.toHaveBeenCalled();
        expect(headings().some(text => /Check your phone/.test(text))).toBe(true);
      });
    } finally {
      openSpy.mockRestore();
    }
  });

  it('still asks from the installed iPhone Home Screen app', async () => {
    setNotificationPermission('default');
    await withIosDevice(true, async () => {
      await mount();

      await act(async () => { notificationAllowButton().click(); });
      await flush();
      expect(globalThis.Notification.requestPermission).toHaveBeenCalledTimes(1);
    });
  });

  it('names the address-bar bell when the browser hides the notification prompt', async () => {
    // Chrome's quieter-messaging UI (and the auto-block it applies to sites people
    // rarely accept) answers a request with no prompt at all and no denial. A tap
    // that ends in silence has to say where the switch actually is.
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    setNotificationPermission('default');
    try {
      await mount();

      await act(async () => { notificationAllowButton().click(); });
      await flush();

      // setNotificationPermission('default') resolves the request as 'default' —
      // exactly what a quiet Chromium answers.
      expect(container.querySelector('.perm-card-note').textContent).toMatch(/bell|address bar/i);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('keeps detailed buzzer recovery behind an API-required alert flow, not the Allow tap', async () => {
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    vi.mocked(api.verifyLogin).mockRejectedValue(Object.assign(
      new Error('"deviceToken" is required'),
      { data: { message: '"deviceToken" is required' } },
    ));
    const agent = vi.spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
    try {
      await mount();
      await act(async () => { typeMobile('9876543210'); });
      await act(async () => { submitPhone(); });
      await flush();
      await act(async () => { typeOtp('123456'); });
      await act(async () => { submitForm(); });
      await flush();

      const sheet = container.querySelector('.permission-gate-sheet');
      expect(sheet).not.toBeNull();
      expect(sheet.textContent).toContain('Android: Settings → Apps → Chrome → Notifications → On');
      expect(sheet.textContent).toContain('Keep the phone off silent');
    } finally {
      agent.mockRestore();
    }
  });

  it('keeps the login screen light: one-line subtitle, two one-tap rows, install pill', async () => {
    setNotificationPermission('default');
    await mount();

    // No glance chips, no text panel — a phone user taps buttons, not paragraphs.
    expect(container.querySelector('.login-perks')).toBeNull();
    expect(container.querySelector('.perm-panel')).toBeNull();
    expect(container.querySelector('.auth-subtitle').textContent).toBe('Sign in and book your next visit.');

    // The card is two rows of one tap each; the install pill stays a pill.
    const card = container.querySelector('.login-perm-card');
    expect(card).not.toBeNull();
    expect(card.querySelectorAll('.perm-row')).toHaveLength(2);
    expect(card.querySelectorAll('.perm-row p')).toHaveLength(0);
    expect(container.querySelector('.login-buzzer-card')).toBeNull();
    expect(notificationAllowButton().textContent.trim()).toBe('Allow');
    expect(notificationAllowButton().getAttribute('aria-label')).toBe('Allow notifications');
    expect(locationAllowButton().textContent.trim()).toBe('Allow');
    expect(locationAllowButton().getAttribute('aria-label')).toBe('Allow location');
    expect(card.textContent).not.toMatch(/blocked|open in browser|how to allow/i);
    const installButton = buttonByText('Install app');
    expect(installButton).not.toBeNull();

    // No native prompt was captured (jsdom), so Install opens the short
    // per-browser guide instead of nothing at all.
    await act(async () => { installButton.click(); });
    await flush();
    const guide = container.querySelector('.modal-card');
    expect(guide).not.toBeNull();
    expect(guide.querySelectorAll('.ios-install-steps li').length).toBeGreaterThan(0);
    await act(async () => { buttonByText('Got it').click(); });
    await flush();
    expect(container.querySelector('.modal-card')).toBeNull();
  });

  it('keeps the location action available until the user grants it', async () => {
    setNotificationPermission('granted');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'enabled', token: 'push-token-5' });
    await mount();

    // Location is the only row left (alerts are on). It stays compact and can
    // always be opened again, even if permission was skipped or blocked earlier.
    const card = container.querySelector('.login-perm-card');
    expect(card).not.toBeNull();
    expect(card.querySelector('.perm-row-copy strong').textContent).toBe('Location');
    expect(locationAllowButton()).not.toBeNull();
    expect(card.querySelectorAll('.perm-row p')).toHaveLength(0);
  });

  it('swaps the login subtitle for the partner pitch when the Salon partner role is picked', async () => {
    setNotificationPermission('default');
    await mount();

    await act(async () => { buttonByText('Salon partner').click(); });
    await flush();
    expect(container.querySelector('.auth-subtitle').textContent).toBe('Sign in and never miss a booking.');
  });
});

// ── Installing the app must not cost a sign-in ──────────────────────────────
// An installed app on iOS is a separate storage container: Web Storage,
// IndexedDB and cookies all start empty even though Safari is signed in. The
// one thing the two share is the CacheStorage the session is mirrored into
// (src/lib/session.js), so the installed app has to look there before it
// believes the user is a stranger.
describe('installed app and the session', () => {
  let container;
  let root;
  let originalCaches;
  let originalResponse;

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
  };

  beforeEach(() => {
    localStorage.clear();
    setPath('/');
    originalCaches = globalThis.caches;
    originalResponse = globalThis.Response;
    globalThis.Response = class FakeResponse {
      constructor(body) { this.body = body; }
      async json() { return JSON.parse(this.body); }
    };
    permissions.isStandalone.mockReturnValue(true);
    userSalonListPublic.mockResolvedValue({ status: 'SUCCESS', data: { salons: [] } });
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    permissions.isStandalone.mockReturnValue(false);
    if (originalCaches === undefined) delete globalThis.caches; else globalThis.caches = originalCaches;
    if (originalResponse === undefined) delete globalThis.Response; else globalThis.Response = originalResponse;
  });

  it('reads the session Safari shared, instead of showing a login form', async () => {
    const session = { token: 'jwt-1', role: 'USER', user: { userId: 'user-1', fullName: 'Riya' } };
    let releaseCache;
    const pendingMatch = new Promise(resolve => { releaseCache = resolve; });
    globalThis.caches = { open: async () => ({ match: () => pendingMatch, put: async () => {}, delete: async () => {} }) };

    await mount();
    // While the shared copies are being read the app shows a splash — never the
    // login page a signed-in user would have to stare at.
    expect(container.textContent).toContain('Welcome back to My Naai');
    expect(container.querySelector('.login-page')).toBeNull();

    await act(async () => {
      releaseCache({ json: async () => session });
      await pendingMatch;
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await flush();

    // Signed in, on the customer home, with the local copy rewritten for the
    // next (synchronous) read.
    expect(container.querySelector('.guest-shell')).toBeNull();
    expect(container.querySelector('.login-page')).toBeNull();
    expect(localStorage.getItem('isLoggedIn')).toBe('true');
    expect(JSON.parse(localStorage.getItem('mynaai')).token).toBe('jwt-1');
  });

  it('falls through to the normal visitor experience when there is no shared session', async () => {
    globalThis.caches = { open: async () => ({ match: async () => undefined, put: async () => {}, delete: async () => {} }) };
    await mount();
    await flush();
    expect(container.querySelector('.guest-shell')).not.toBeNull();
  });

  it('opens a browser tab immediately — the splash belongs to the installed app only', async () => {
    permissions.isStandalone.mockReturnValue(false);
    globalThis.caches = { open: async () => ({ match: () => new Promise(() => {}), put: async () => {}, delete: async () => {} }) };
    await mount();
    expect(container.textContent).not.toContain('Welcome back to My Naai');
  });
});

// ── One notification, one ring ──────────────────────────────────────────────
// The buzzer marks the arrival of a notification; it is never a side effect of
// rendering a screen. These tests drive the foreground path (the app is open in
// front of the user) with the same alert twice, the way a redelivery arrives.
describe('foreground notification handling', () => {
  let container;
  let root;

  const signIn = role => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userType', role);
    localStorage.setItem('isNewSalon', 'false');
    localStorage.setItem('mynaai', JSON.stringify({ token: 'test-token' }));
    localStorage.setItem('mynaaiUser', JSON.stringify(role === 'SALON' ? { salon: { salonId: 'salon-1', profileCompleted: true } } : { userId: 'user-1' }));
  };

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  const deliver = async message => {
    await act(async () => { pushHarness.onMessage(message); });
    await flush();
  };

  beforeEach(() => {
    localStorage.clear();
    signIn('USER');
    setPath('/bookings');
    vi.mocked(playBuzzer).mockClear().mockReturnValue(true);
    vi.mocked(push.displayNotification).mockClear();
    vi.mocked(push.isActionableNotification).mockReturnValue(true);
    process.env.TZ = 'Asia/Kolkata';
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.mocked(push.isActionableNotification).mockReturnValue(false);
    vi.clearAllMocks();
  });

  it('rings once, with the arrival envelope, when the notification arrives', async () => {
    await mount();
    await deliver({ notification: { title: 'Booking request', body: 'Riya wants a fade' }, data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-9' } });

    expect(playBuzzer).toHaveBeenCalledTimes(1);
    const [{ alertId, sentAt }] = playBuzzer.mock.calls[0];
    expect(alertId).toBe('BOOKING_REQUEST:req-9');
    expect(typeof sentAt).toBe('number');
    expect(push.displayNotification).toHaveBeenCalledTimes(1);
  });

  it('treats a repeated delivery of one alert as one alert — no second banner, no second buzz', async () => {
    await mount();
    const message = { type: 'BOOKING_REQUEST', notification: { title: 'Booking request', body: 'Riya wants a fade' }, data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-10' } };

    await deliver(message);
    expect(playBuzzer).toHaveBeenCalledTimes(1);
    expect(push.displayNotification).toHaveBeenCalledTimes(1);

    // The same alert again: the arrival gate refuses it before anything is
    // shown, so there is no second ring, no second banner and no second toast.
    await deliver(message);
    expect(playBuzzer).toHaveBeenCalledTimes(1);
    expect(push.displayNotification).toHaveBeenCalledTimes(1);
  });

  it('makes a sound for every notification, not only the ones with buttons', async () => {
    // "If a notification comes, we need a sound." An informational message has
    // no action buttons, but it still arrives — the buzzer rings for it too
    // (with its own, softer sound) and the banner carries the device alert.
    vi.mocked(push.isActionableNotification).mockReturnValue(false);
    await mount();
    await deliver({ type: 'BOOKING_CONFIRMED', notification: { title: 'Your booking is confirmed', body: 'See you at 6pm' }, data: { type: 'BOOKING_CONFIRMED', bookingId: 'b-1' } });

    expect(playBuzzer).toHaveBeenCalledTimes(1);
    expect(playBuzzer.mock.calls[0][0]).toEqual(expect.objectContaining({ type: 'BOOKING_CONFIRMED', claimed: true }));
    // The alert itself is still shown and recorded.
    expect(push.displayNotification).toHaveBeenCalledTimes(1);
  });

  it('still shows the alert when this page cannot make a sound at all', async () => {
    // A desktop whose audio clock refuses to start, or a tab that was never
    // unlocked by a tap: the app buzzer is silent. The alert is not — the
    // notification below carries the device's own sound, so the ring is never
    // allowed to decide whether the notification is shown.
    vi.mocked(playBuzzer).mockReturnValue(false);
    await mount();
    const message = { type: 'BOOKING_REQUEST', title: 'Booking request', body: 'Riya wants a fade', notification: { title: 'Booking request', body: 'Riya wants a fade' }, data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-11' } };
    await deliver(message);

    expect(push.displayNotification).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Booking request');
  });
});

// The salon's side of a new booking request: the mobile app asks for an answer
// within 60 seconds, and the web app has to put that answer in front of the
// owner on whatever screen they are on — not just ring and hope.
describe('the in-app booking request alert', () => {
  let container;
  let root;

  const signInSalon = () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userType', 'SALON');
    localStorage.setItem('isNewSalon', 'false');
    localStorage.setItem('mynaai', JSON.stringify({ token: 'test-token' }));
    localStorage.setItem('mynaaiUser', JSON.stringify({ salon: { salonId: 'salon-1', profileCompleted: true } }));
  };

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  const deliver = async message => {
    await act(async () => { pushHarness.onMessage(message); });
    await flush();
  };

  const byText = label => Array.from(container.querySelectorAll('button'))
    .find(node => node.textContent.trim().replace(/\s+/g, ' ') === label);

  beforeEach(() => {
    localStorage.clear();
    signInSalon();
    setPath('/queue');
    salonProfile.mockReset().mockResolvedValue({ status: 'SUCCESS', data: { salon: { salonId: 'salon-1', profileCompleted: true } } });
    getBookingRequestById.mockReset().mockResolvedValue({ status: 'SUCCESS', data: { customerName: 'Riya Sharma', bookingDate: '2099-09-07', startTime: '18:30:00' } });
    bookingRequestOwnerAction.mockReset().mockResolvedValue({ status: 'SUCCESS' });
    vi.mocked(playBuzzer).mockClear().mockReturnValue(true);
    vi.mocked(push.isActionableNotification).mockReturnValue(true);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.mocked(push.isActionableNotification).mockReturnValue(false);
    vi.clearAllMocks();
  });

  it('offers Accept, Reject and Delay the moment a request arrives', async () => {
    await mount();
    await deliver({ type: 'BOOKING_REQUEST', notification: { title: 'New booking request', body: 'Riya wants a fade' }, data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-21' } });

    const card = container.querySelector('.booking-alert');
    expect(card).toBeTruthy();
    expect(byText('Accept')).toBeTruthy();
    expect(byText('Reject')).toBeTruthy();
    expect(byText('Delay')).toBeTruthy();
  });

  it('answers from the card without leaving the screen the salon was on', async () => {
    await mount();
    await deliver({ type: 'BOOKING_REQUEST', notification: { title: 'New booking request', body: 'Riya wants a fade' }, data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-22' } });

    await act(async () => { byText('Accept').click(); });
    await flush();

    expect(bookingRequestOwnerAction).toHaveBeenCalledWith('req-22', { action: 'ACCEPT' });
    // The card retires itself once the answer is in.
    expect(container.querySelector('.booking-alert')).toBeNull();
  });

  it('raises the card for a request that arrived while the app was in another tab', async () => {
    // A hidden window is not handed the FCM message — the worker rings it over
    // the notification channel with the arrival stamp instead, and that is the
    // only reason the salon, on switching back, finds the request waiting.
    globalThis.BroadcastChannel = FakeChannel;
    try {
      await mount();
      const channel = FakeChannel.instances.find(instance => instance.name === 'mynaai-notifications');
      expect(channel).toBeTruthy();

      await act(async () => {
        channel.emit({ type: 'MYNAAI_PLAY_BUZZER', notificationType: 'BOOKING_REQUEST', alertId: 'BOOKING_REQUEST:req-31', sentAt: Date.now(), data: { bookingRequestId: 'req-31' } });
      });
      await flush();

      expect(container.querySelector('.booking-alert')).toBeTruthy();
      expect(byText('Accept')).toBeTruthy();
    } finally {
      delete globalThis.BroadcastChannel;
      FakeChannel.instances.length = 0;
    }
  });

  it('ignores a relay that arrives long after the alert did', async () => {
    // A queued channel message from five minutes ago is not a live request; it
    // must not open a countdown for a window that has already closed.
    globalThis.BroadcastChannel = FakeChannel;
    try {
      await mount();
      const channel = FakeChannel.instances.find(instance => instance.name === 'mynaai-notifications');
      await act(async () => {
        channel.emit({ type: 'MYNAAI_PLAY_BUZZER', notificationType: 'BOOKING_REQUEST', alertId: 'BOOKING_REQUEST:req-32', sentAt: Date.now() - 300000, data: { bookingRequestId: 'req-32' } });
      });
      await flush();
      expect(container.querySelector('.booking-alert')).toBeNull();
    } finally {
      delete globalThis.BroadcastChannel;
      FakeChannel.instances.length = 0;
    }
  });

  it('signs the salon out, with a reason, when this device\u2019s token no longer matches the login token', async () => {
    // Browser tab → installed app: the PWA mints its own push token while the
    // session it inherited points the backend at the old one. When the quiet
    // hand-over cannot be confirmed, the app asks for one fresh OTP login.
    await mount();
    expect(container.querySelector('.queue-screen, .screen')).toBeTruthy();
    await act(async () => { window.dispatchEvent(new CustomEvent('mynaai:device-token-changed', { detail: { token: 'pwa-token', previous: 'tab-token' } })); });
    await flush();
    expect(localStorage.getItem('mynaai')).toBeNull();
    expect(container.textContent).toContain('sign in again');
    expect(container.querySelector('.form-notice')).toBeTruthy();
    expect(container.textContent).toContain('Salon partner');
  });

  it('does not stack a second copy of the request the salon already has open', async () => {
    setPath('/bookingRequest?bookingRequestId=req-41');
    await mount();
    await deliver({ type: 'BOOKING_REQUEST', notification: { title: 'New booking request' }, data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-41' } });
    // The screen itself asks for an answer; the card is for every other screen.
    expect(container.querySelector('.booking-alert')).toBeNull();
  });

  it('never shows the actionable card to a customer, or for a quiet message', async () => {
    await mount();
    await deliver({ type: 'BOOKING_CONFIRMED', notification: { title: 'Booking confirmed', body: 'See you at 6pm' }, data: { type: 'BOOKING_CONFIRMED', bookingId: 'b-2' } });
    expect(container.querySelector('.booking-alert')).toBeNull();

    // …and the same booking request means nothing to a customer account.
    localStorage.clear();
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userType', 'USER');
    localStorage.setItem('mynaai', JSON.stringify({ token: 'test-token' }));
    localStorage.setItem('mynaaiUser', JSON.stringify({ userId: 'user-1' }));
    if (root) act(() => root.unmount());
    container.remove();
    setPath('/bookings');
    await mount();
    await deliver({ type: 'BOOKING_REQUEST', notification: { title: 'New booking request', body: 'Riya wants a fade' }, data: { type: 'BOOKING_REQUEST', bookingRequestId: 'req-23' } });
    expect(container.querySelector('.booking-alert')).toBeNull();
  });
});
