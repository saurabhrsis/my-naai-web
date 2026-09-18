import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { userSalonList, userSalonListPublic, salonByIdInfo } = vi.hoisted(() => ({
  userSalonList: vi.fn(),
  userSalonListPublic: vi.fn(),
  salonByIdInfo: vi.fn(),
}));

// App.jsx pulls in the Firebase browser SDK via lib/push.js; jsdom cannot run
// it, so the same import-time stubs src/App.test.jsx uses are repeated here.
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve('')), isSupported: vi.fn(() => Promise.resolve(false)),
  deleteToken: vi.fn(() => Promise.resolve()), onMessage: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  const api = new Proxy({ userSalonList, userSalonListPublic, salonByIdInfo }, {
    get: (target, key) => (key in target
      ? target[key]
      : vi.fn(() => Promise.resolve({ status: 'SUCCESS', data: {} }))),
  });
  return { ...actual, api };
});

vi.mock('../lib/push', () => {
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
    // The partner landing page carries the signed-out buzzer check, which reads
    // the live permission through lib/push.
    readNotificationPermission: vi.fn(() => Promise.resolve('granted')),
    requestNotificationPermission: vi.fn(() => Promise.resolve('granted')),
  };
});
vi.mock('../lib/socket', () => ({
  subscribeToLiveUpdates: vi.fn(() => () => {}),
  resetLiveUpdatesSocket: vi.fn(),
}));
vi.mock('../lib/buzzer', () => ({ playBuzzer: vi.fn(), unlockBuzzer: vi.fn() }));

import App from '../App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setPath = value => { window.history.replaceState({}, '', value); };
const currentPath = () => `${window.location.pathname}${window.location.search}`;
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

const listingPayload = () => ({
  status: 'SUCCESS',
  data: {
    salons: [{
      salonId: 'salon-9', salonName: 'Golden Scissors', genderType: 'UNISEX',
      address: 'Dharampeth, Nagpur', isOpen: true, waitTime: '5–10 min',
    }],
  },
});

// A fully-populated public salon record — services, business hours with a
// weekly off, and barbers — so the detail page renders every section a guest
// (or customer) is promised.
const detailPayload = () => ({
  status: 'SUCCESS',
  data: {
    salonId: 'salon-9',
    salonName: 'Golden Scissors',
    genderType: 'UNISEX',
    addressLine1: '12 Dharampeth Main Road',
    city: 'Nagpur',
    state: 'Maharashtra',
    pincode: '440010',
    phoneNumber: '9876543210',
    ownerName: 'Ramesh Kumar',
    isOpen: true,
    waitTime: '5–10 min',
    businessHours: [{ openingTime: '09:00:00', closingTime: '21:00:00', holidayDays: ['1'] }],
    services: [
      { serviceId: 's1', serviceName: 'Haircut', price: 150, durationMinutes: 30 },
      { serviceId: 's2', serviceName: 'Beard Trim', price: 80, durationMinutes: 15 },
      { serviceId: 's3', serviceName: 'Hair Spa', price: 500, durationMinutes: 45 },
    ],
    barbers: [
      { barberId: 'b1', fullName: 'Amit Jichkar', isAvailable: true, ratingAverage: 4.8 },
      { barberId: 'b2', fullName: 'Rahul Wankhede', isAvailable: false, ratingAverage: 4.5 },
    ],
  },
});

describe('Website pages for guests', () => {
  let container;
  let root;

  const mount = async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<App />); });
    await flush();
  };

  const buttonByText = text => Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim().includes(text));

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setPath('/');
    userSalonList.mockReset().mockResolvedValue(listingPayload());
    userSalonListPublic.mockReset().mockResolvedValue(listingPayload());
    salonByIdInfo.mockReset().mockResolvedValue(detailPayload());
  });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it('lays the home page out as differentiated website sections', async () => {
    await mount();

    // Hero band (greeting/search/ads) and salon band are separate sections…
    expect(container.querySelector('.home-hero-band')).not.toBeNull();
    expect(container.querySelector('.home-salons-band')).not.toBeNull();
    // …testimonials and the footer still close the page, in that order.
    const children = Array.from(container.querySelector('.home-screen').children).map(node => node.className);
    expect(children.indexOf('testimonial-section')).toBe(children.indexOf('site-footer') - 1);
  });

  it('puts a working male/female filter in the search row instead of a For you button', async () => {
    await mount();

    expect(container.querySelector('.filter-button')).toBeNull();
    const toggle = container.querySelector('.home-search-row .gender-toggle');
    expect(toggle).not.toBeNull();
    const lastGender = () => userSalonListPublic.mock.calls.at(-1)?.[0]?.genderType;
    expect(lastGender()).toBe('male');

    await act(async () => { Array.from(toggle.querySelectorAll('button')).find(node => node.textContent === 'Female').click(); });
    await flush();
    expect(lastGender()).toBe('female');
  });

  it('shows every public salon detail on the salon page — services, hours, days, barbers', async () => {
    setPath('/salon/salon-9');
    await mount();
    await flush();

    const detail = container.querySelector('.detail-screen');
    expect(detail).not.toBeNull();
    // Public details: phone, full address with city/state/pincode, owner, type.
    expect(detail.textContent).toContain('+91 9876543210');
    expect(detail.textContent).toContain('12 Dharampeth Main Road');
    expect(detail.textContent).toContain('Maharashtra');
    expect(detail.textContent).toContain('Ramesh Kumar');
    // ALL services, not a preview slice.
    const serviceRows = detail.querySelectorAll('.detail-service-list .detail-service-row');
    expect(serviceRows.length).toBe(3);
    expect(detail.textContent).toContain('Hair Spa');
    // Business hours AND days: open-day chips plus the weekly off.
    expect(detail.querySelector('.detail-hours-card')).not.toBeNull();
    expect(detail.textContent).toContain('Monday — weekly off');
    expect(detail.textContent).toContain('Open days');
    // The team.
    expect(detail.querySelectorAll('.detail-barber-grid .detail-barber-card').length).toBe(2);
    expect(detail.textContent).toContain('Amit Jichkar');
  });

  it('keeps booking behind login for a guest, with a Book salon CTA that sends to login', async () => {
    setPath('/salon/salon-9');
    await mount();
    await flush();

    const loginCtas = Array.from(container.querySelectorAll('button')).filter(node => node.textContent.trim().includes('Login to book'));
    expect(loginCtas.length).toBeGreaterThanOrEqual(1);

    await act(async () => { loginCtas[0].click(); });
    await flush();

    expect(currentPath()).toBe('/login');
    expect(sessionStorage.getItem('mynaaiPendingRoute')).toBe('/salon/salon-9');
    expect(container.querySelector('.auth-page')).not.toBeNull();
  });

  it('charts the About page as a website page — hero and cards, no app header', async () => {
    setPath('/about');
    await mount();

    expect(container.querySelector('.info-screen')).not.toBeNull();
    expect(container.querySelector('.page-header')).toBeNull();
    const hero = container.querySelector('.site-info-hero');
    expect(hero).not.toBeNull();
    expect(hero.querySelector('h1').textContent).toBe('About My Naai');
    expect(container.querySelectorAll('.site-info-grid .site-info-card').length).toBeGreaterThanOrEqual(6);
  });

  it('answers the questions customers actually ask on the FAQ page', async () => {
    setPath('/faq');
    await mount();

    expect(container.querySelector('.info-screen')).not.toBeNull();
    expect(container.textContent).toContain('Frequently asked questions');
    // The page grew well past the original four sections — the FAQ is the
    // self-service front door, so a thin page sends everyone to support.
    const cards = container.querySelectorAll('.site-info-grid .site-info-card');
    expect(cards.length).toBeGreaterThanOrEqual(12);
    expect(container.textContent).toContain('Is My Naai free for customers?');
    expect(container.textContent).toContain('What if I am running late?');
    expect(container.textContent).toContain('Will I be reminded before my appointment?');
    expect(container.textContent).toContain('How do I delete my account?');
  });

  it('shows My Naai contact details and a working contact form on the Contact page', async () => {
    setPath('/contact');
    await mount();

    expect(container.querySelector('.contact-screen')).not.toBeNull();
    expect(container.querySelector('.page-header')).toBeNull();
    // Company channels: phone, email, site and location.
    expect(container.querySelector('a[href="tel:8380017393"]')).not.toBeNull();
    expect(container.querySelector('a[href="mailto:mynaai.in@gmail.com"]')).not.toBeNull();
    expect(container.textContent).toContain('mynaai.in@gmail.com');
    expect(container.textContent).toContain('8380017393');
    expect(container.textContent).toContain('India');
    // The form validates instead of swallowing a message silently.
    const form = container.querySelector('.contact-form');
    expect(form).not.toBeNull();
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(container.textContent).toContain('Please tell us your name.');
  });
});
