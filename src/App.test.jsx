import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { salonProfile, userSalonList, userSalonListPublic } = vi.hoisted(() => ({ salonProfile: vi.fn(), userSalonList: vi.fn(), userSalonListPublic: vi.fn() }));

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
  const api = new Proxy({ salonProfile, userSalonList, userSalonListPublic }, {
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
    isPushConfigured: vi.fn(() => true),
    deletePushToken: stub('deletePushToken'),
    displayNotification: noop,
    closeNotification: noop,
    getNotificationRoute: vi.fn(() => ({ name: 'home', params: {} })),
    isActionableNotification: vi.fn(() => false),
    isEmbeddedFrame: vi.fn(() => false),
    normalizePushPayload: vi.fn(payload => ({ title: '', body: '', data: {}, type: '', hasData: false, ...payload })),
    recordForegroundMessage: noop,
    watchNotificationPermission: vi.fn(() => () => {}),
  };
});
vi.mock('./lib/socket', () => ({
  subscribeToLiveUpdates: vi.fn(() => () => {}),
  resetLiveUpdatesSocket: vi.fn(),
}));
vi.mock('./lib/buzzer', () => ({ playBuzzer: vi.fn(), unlockBuzzer: vi.fn() }));

import App, { getRouteFromPath, parseRoutePath, resolveResumeRoute, routeToPath } from './App';
import * as push from './lib/push';
import { stashPendingRoute, popPendingRoute } from './lib/pendingRoute';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    expect(footer.querySelector('a[href="mailto:support@mynaai.com"]')).not.toBeNull();
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
    expect(container.textContent).toContain('support@mynaai.com');
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
});

// Login permission flow: one setup card on the login screen, direct browser
// popups from the Continue tap, and a real way out when the browser has
// blocked notifications (the "followed the steps but it still shows blocked"
// dead end).
describe('Login permission flow', () => {
  let container;
  let root;

  const setNotificationPermission = permission => {
    globalThis.Notification = { permission, requestPermission: vi.fn().mockResolvedValue(permission) };
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

  const headings = () => Array.from(container.querySelectorAll('h1')).map(node => node.textContent);

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  beforeEach(() => {
    // Browsing is public now, so a bare hash opens the guest home — these
    // tests target the login flow, which lives at its own route.
    setPath('/login');
    vi.mocked(push.getPushStatus).mockReset().mockResolvedValue({ state: 'needs-permission', reason: '' });
    vi.mocked(push.getPushToken).mockReset().mockResolvedValue('');
    vi.mocked(push.isPushConfigured).mockReset().mockReturnValue(true);
    vi.mocked(push.isEmbeddedFrame).mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    delete globalThis.Notification;
    vi.clearAllMocks();
  });

  it('without alerts config, login skips the permission gate and sends the OTP', async () => {
    // The alerts setup is not wired into this build (no Firebase env): there
    // is nothing actionable for a user, so the pill hides, no "not set up"
    // gate ever opens, and sign-in proceeds without a device token.
    vi.mocked(push.isPushConfigured).mockReturnValue(false);
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'unconfigured', reason: 'Notifications have not been enabled for this build yet.' });
    await mount();

    expect(container.querySelector('.setup-splash')).toBeNull();
    expect(container.textContent).not.toContain('not set up for web alerts');
    expect(container.textContent).not.toContain('need a second try');
    expect(buttonByText('Allow alerts')).toBeUndefined();

    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    await flush();

    expect(push.getPushToken).not.toHaveBeenCalled();
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
    expect(headings().some(text => /Check your phone/.test(text))).toBe(true);
  });

  it('asks the browser directly when Continue is tapped, then sends the OTP', async () => {
    setNotificationPermission('default');
    vi.mocked(push.getPushToken).mockImplementation(async options => (options?.requestPermission ? 'push-token-1' : ''));
    await mount();

    // The login screen shows the compact setup pills with one clear Allow button.
    expect(container.querySelector('.login-actions')).not.toBeNull();
    expect(buttonByText('Allow alerts')).not.toBeNull();

    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    await flush();

    // The browser's own popup was requested straight from the Continue tap.
    expect(push.getPushToken).toHaveBeenCalledWith({ requestPermission: true });
    // And the flow continued to the OTP step.
    expect(headings().some(text => /Check your phone/.test(text))).toBe(true);
  });

  it('asks for notification permission on the first tap of the login page', async () => {
    setNotificationPermission('default');
    vi.mocked(push.getPushToken).mockResolvedValue('');
    await mount();

    // Alerts belong to login: any tap on the page is the gesture that opens
    // the browser's own permission popup here — never on the home screen.
    await act(async () => { window.dispatchEvent(new Event('pointerdown')); });
    await flush();
    expect(push.getPushToken).toHaveBeenCalledWith({ requestPermission: true });
  });

  it('opens the permission gate from the Fix alerts pill and Check again ends the dead end', async () => {
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    await mount();

    // Blocked state is one honest pill — no Wall-of-text card on the login page.
    expect(container.querySelector('.perm-panel')).toBeNull();
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();
    const fixButton = buttonByText('Fix alerts');
    expect(fixButton).not.toBeNull();

    // The pill opens the gate, which carries the per-browser steps and the
    // recovery actions.
    await act(async () => { fixButton.click(); });
    await flush();
    const gate = container.querySelector('.permission-gate-sheet');
    expect(gate).not.toBeNull();
    expect(gate.textContent).toContain('Notifications are blocked');
    expect(buttonByText('I allowed it — Check')).not.toBeNull();
    expect(buttonByText('Reload page')).not.toBeNull();

    // Still blocked after a first Check — the fix stays up and names the exact
    // site + reload, the two classic "allowed but still blocked" traps.
    await act(async () => { buttonByText('I allowed it — Check').click(); });
    await flush();
    expect(container.querySelector('.permission-gate-sheet .permission-gate-warn').textContent).toContain(window.location.host);

    // The user unblocks in the browser and Checks again — the sheet closes.
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'enabled', token: 'push-token-2' });
    await act(async () => { buttonByText('I allowed it — Check').click(); });
    await flush();
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();

    // Sign-in now proceeds without asking again.
    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    await flush();
    expect(headings().some(text => /Check your phone/.test(text))).toBe(true);
  });

  it('puts the open-in-new-tab escape hatch first when an embedded page is blocked', async () => {
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    vi.mocked(push.isEmbeddedFrame).mockReturnValue(true);
    await mount();

    // Embedded + blocked: the pill opens the gate, whose primary action is the
    // escape hatch — no failed Check needed to discover it.
    await act(async () => { buttonByText('Fix alerts').click(); });
    await flush();
    const gate = container.querySelector('.permission-gate-sheet');
    expect(gate).not.toBeNull();
    expect(gate.textContent).toContain('inside another page');
    const openButton = buttonByText('Open My Naai in a new tab');
    expect(openButton).not.toBeNull();

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await act(async () => { openButton.click(); });
    expect(openSpy).toHaveBeenCalledWith(window.location.href, '_blank', 'noopener');
    openSpy.mockRestore();
  });

  it('opens the gate with the inline fix when a blocked browser cannot pop up', async () => {
    setNotificationPermission('denied');
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'denied', reason: '' });
    await mount();

    await act(async () => { typeMobile('9876543210'); });
    await act(async () => { submitPhone(); });
    await flush();

    // The gate (not a nested help modal) carries the steps itself.
    const gate = container.querySelector('.permission-gate-sheet');
    expect(gate).not.toBeNull();
    expect(gate.textContent).toContain('Notifications are blocked');
    expect(gate.querySelectorAll('.modal-backdrop').length).toBe(0);

    // The user unblocks in the browser and taps Check — the sheet closes and
    // the token is wired into the flow for the next Continue tap.
    vi.mocked(push.getPushStatus).mockResolvedValue({ state: 'enabled', token: 'push-token-3' });
    vi.mocked(push.getPushToken).mockResolvedValue('push-token-3');
    await act(async () => { buttonByText('I allowed it — Check').click(); });
    await flush();
    expect(container.querySelector('.permission-gate-sheet')).toBeNull();

    await act(async () => { submitPhone(); });
    await flush();
    expect(headings().some(text => /Check your phone/.test(text))).toBe(true);
  });

  it('keeps the login screen light: one-line subtitle, no perk chips, just the setup pills', async () => {
    setNotificationPermission('default');
    await mount();

    // No glance chips, no text panel — a phone user taps buttons, not paragraphs.
    expect(container.querySelector('.login-perks')).toBeNull();
    expect(container.querySelector('.perm-panel')).toBeNull();

    // The subtitle stays one short line.
    expect(container.querySelector('.auth-subtitle').textContent).toBe('Sign in and book your next visit.');

    // The two compact pills are the whole setup: Allow alerts (fires the
    // browser popup or the gate) and Install app (prompt or the short guide).
    const actions = container.querySelector('.login-actions');
    expect(actions).not.toBeNull();
    expect(buttonByText('Allow alerts')).not.toBeNull();
    const installButton = buttonByText('Install app');
    expect(installButton).not.toBeNull();

    // Allowed directly from the pill: the tap asks the browser and the pill
    // disappears once permission is granted.
    vi.mocked(push.getPushToken).mockImplementation(async options => (options?.requestPermission ? 'push-token-pill' : ''));
    await act(async () => { buttonByText('Allow alerts').click(); });
    await flush();
    expect(push.getPushToken).toHaveBeenCalledWith({ requestPermission: true });
    expect(container.querySelector('.allow-alerts-button')).toBeNull();

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

  it('swaps the login subtitle for the partner pitch when the Salon partner role is picked', async () => {
    setNotificationPermission('default');
    await mount();

    await act(async () => { buttonByText('Salon partner').click(); });
    await flush();
    expect(container.querySelector('.auth-subtitle').textContent).toBe('Sign in and never miss a booking.');
  });
});
