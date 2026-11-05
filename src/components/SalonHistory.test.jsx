import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalonHistoryScreen } from './SalonScreens';
import { customerMobileFrom, formatMobileNumber, mobileDigits, telHref } from '../lib/customerPhone';

const { salonQueueHistory } = vi.hoisted(() => ({ salonQueueHistory: vi.fn() }));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, salonQueueHistory } };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const notify = vi.fn();

// The shape the backend actually sends for a completed booking
// (services/booking.service.js → salonOwnerCompletedBookings): `userPhone` is the
// registered customer's number, or the walk-in number.
const BOOKINGS = [
  {
    bookingId: 'b-1',
    bookingDate: '2026-11-04T00:00:00.000Z',
    bookingTime: '11:30:00',
    userName: 'Amit Jichkar',
    userPhone: '9876543210',
    barberName: 'Ravi',
    services: 'Haircut, Beard trim',
    totalAmount: 450,
  },
  {
    // A walk-in who did not leave a number: the API sends this placeholder, and
    // printing it would be a fake number that dials nothing.
    bookingId: 'b-2',
    bookingDate: '2026-11-03T00:00:00.000Z',
    bookingTime: '18:00:00',
    userName: 'Walk-in guest',
    userPhone: '0000000000',
    barberName: 'Amit',
    services: 'Hair spa',
    totalAmount: 900,
  },
];

function render() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root, mount: () => root.render(<SalonHistoryScreen notify={notify} />) };
}

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('customer history shows the mobile number', () => {
  it('prints the customer’s number as a tap-to-call link', async () => {
    salonQueueHistory.mockResolvedValue({ bookings: BOOKINGS });
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    const rows = container.querySelectorAll('.history-card');
    expect(rows).toHaveLength(2);

    const link = rows[0].querySelector('.history-phone');
    expect(link).toBeTruthy();
    // Readable as an Indian mobile, and diallable with the country code even
    // though the API sends ten digits.
    expect(link.textContent.trim()).toBe('+91 98765 43210');
    expect(link.getAttribute('href')).toBe('tel:+919876543210');
    expect(link.getAttribute('aria-label')).toBe('Call Amit Jichkar on +91 98765 43210');
    // …and the rest of the row is untouched.
    expect(rows[0].textContent).toContain('Amit Jichkar');
    expect(rows[0].textContent).toContain('Haircut, Beard trim');
    expect(rows[0].textContent).toContain('Ravi');
  });

  it('shows nothing rather than the 0000000000 placeholder of a walk-in', async () => {
    salonQueueHistory.mockResolvedValue({ bookings: BOOKINGS });
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    const rows = container.querySelectorAll('.history-card');
    expect(rows[1].querySelector('.history-phone')).toBeNull();
    expect(container.textContent).not.toContain('0000000000');
    // The row itself still renders — the customer is not hidden, only the fake
    // number is.
    expect(rows[1].textContent).toContain('Walk-in guest');
  });

  it('reads the number out of either the booking or a nested user record', async () => {
    salonQueueHistory.mockResolvedValue({
      bookings: [
        { bookingId: 'b-3', userName: 'Neha', user: { phoneNumber: '9123456780' }, services: 'Facial' },
        { bookingId: 'b-4', userName: 'Guest 2', walkinPhone: '9012345678', services: 'Shave' },
        { bookingId: 'b-5', userName: 'No number', services: 'Trim' },
      ],
    });
    const { container, mount } = render();
    await act(async () => { mount(); });
    await flush();

    const rows = container.querySelectorAll('.history-card');
    expect(rows[0].querySelector('.history-phone').getAttribute('href')).toBe('tel:+919123456780');
    expect(rows[1].querySelector('.history-phone').getAttribute('href')).toBe('tel:+919012345678');
    expect(rows[2].querySelector('.history-phone')).toBeNull();
  });
});

describe('the number helpers', () => {
  it('normalises every way a number is written down', () => {
    ['9876543210', '+91 98765 43210', '919876543210', '098765 43210', '+91-9876543210'].forEach(value => {
      expect(mobileDigits(value)).toBe('9876543210');
    });
    expect(mobileDigits('')).toBe('');
    expect(mobileDigits(undefined)).toBe('');
  });

  it('formats a ten-digit mobile the way it is read aloud', () => {
    expect(formatMobileNumber('9876543210')).toBe('+91 98765 43210');
    expect(formatMobileNumber('+91 98765 43210')).toBe('+91 98765 43210');
    // Not a mobile shape: shown as its own digits rather than guessed at.
    expect(formatMobileNumber('0221234567')).toBe('02212 34567');
  });

  it('refuses to make a link out of nothing or out of zeros', () => {
    expect(telHref('0000000000')).toBe('');
    expect(telHref('')).toBe('');
    expect(telHref(null)).toBe('');
    expect(telHref('12345')).toBe('');
    expect(telHref('9876543210')).toBe('tel:+919876543210');
  });

  it('returns null for a booking with no number at all', () => {
    expect(customerMobileFrom({})).toBeNull();
    expect(customerMobileFrom(null)).toBeNull();
    expect(customerMobileFrom({ userPhone: '0000000000' })).toBeNull();
    expect(customerMobileFrom({ userPhone: '9876543210' })).toEqual({
      digits: '9876543210',
      display: '+91 98765 43210',
      tel: 'tel:+919876543210',
    });
  });
});
