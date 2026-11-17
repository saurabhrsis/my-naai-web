import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BookingRequestScreen } from './SalonScreens';

const { getBookingRequestById, bookingRequestOwnerAction, salonDelayBooking, subscribeToLiveUpdates } = vi.hoisted(() => ({
  getBookingRequestById: vi.fn(),
  bookingRequestOwnerAction: vi.fn(),
  salonDelayBooking: vi.fn(),
  subscribeToLiveUpdates: vi.fn(() => () => {}),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return {
    ...actual,
    api: { ...actual.api, getBookingRequestById, bookingRequestOwnerAction, salonDelayBooking },
  };
});

vi.mock('../lib/socket', () => ({ subscribeToLiveUpdates }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const monthsAgo = months => new Date(Date.now() - months * 30 * 24 * 60 * 60000).toISOString();

const REQUEST = {
  bookingRequestId: 'req-1',
  customerName: 'Lucky',
  customerPhone: '9876500009',
  bookingDate: '2026-10-23',
  startTime: '19:40:00',
  endTime: '20:40:00',
  services: 'Hair Spa (Loreal/Matrix) - Unisex',
  barberName: 'Imran',
  createdAt: new Date().toISOString(),
  status: 'PENDING',
};

const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

async function render(node) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(node); });
  await flush();
  return { container, root };
}

const emitLive = (event, payload) => {
  act(() => {
    subscribeToLiveUpdates.mock.calls
      .filter(([args]) => args.event === event && typeof args.handler === 'function')
      .forEach(([args]) => args.handler(payload));
  });
};

const texts = container => Array.from(container.querySelectorAll('button')).map(button => button.textContent.trim());

beforeEach(() => {
  vi.clearAllMocks();
  getBookingRequestById.mockResolvedValue({ status: 'SUCCESS', data: { ...REQUEST } });
  bookingRequestOwnerAction.mockResolvedValue({ status: 'SUCCESS' });
});

afterEach(() => { document.body.innerHTML = ''; });

describe('BookingRequestScreen', () => {
  it('offers the answer while the minute is still running', async () => {
    const { container } = await render(<BookingRequestScreen params={{ bookingRequestId: 'req-1' }} navigate={vi.fn()} notify={vi.fn()} />);
    expect(container.querySelector('.request-timer')).not.toBeNull();
    expect(container.textContent).toContain('Respond in');
    expect(texts(container)).toEqual(expect.arrayContaining(['Accept', 'Reject', 'Update time']));
    // The facts the salon needs before answering.
    expect(container.textContent).toContain('Lucky');
    expect(container.textContent).toContain('9876500009');
    expect(container.textContent).toContain('Imran');
  });

  // Reported from the salon side: a request from LAST MONTH opened this screen
  // with a fresh 60-second timer and Accept / Reject buttons.
  it('shows no timer and no actions for a request from last month', async () => {
    getBookingRequestById.mockResolvedValue({
      status: 'SUCCESS',
      data: { ...REQUEST, createdAt: monthsAgo(1), status: 'PENDING' },
    });
    const notify = vi.fn();
    const { container } = await render(<BookingRequestScreen params={{ bookingRequestId: 'req-1' }} navigate={vi.fn()} notify={notify} />);

    expect(container.querySelector('.request-timer')).toBeNull();
    expect(container.textContent).not.toContain('Respond in');
    const labels = texts(container);
    expect(labels).not.toContain('Accept');
    expect(labels).not.toContain('Reject');
    expect(labels).not.toContain('Update time');
    // It reads as what it is: an auto-cancel, not a rejection waiting on them.
    expect(container.textContent).toContain('cancelled automatically');
    expect(container.textContent).toContain('not a rejection');
    // The request is still readable.
    expect(container.textContent).toContain('Lucky');
  });

  it('shows no actions for a request that was already answered', async () => {
    getBookingRequestById.mockResolvedValue({
      status: 'SUCCESS',
      data: { ...REQUEST, createdAt: monthsAgo(1), status: 'ACCEPTED' },
    });
    const { container } = await render(<BookingRequestScreen params={{ bookingRequestId: 'req-1' }} navigate={vi.fn()} notify={vi.fn()} />);
    const labels = texts(container);
    expect(labels).not.toContain('Accept');
    expect(labels).not.toContain('Reject');
    expect(labels).not.toContain('Update time');
    expect(container.textContent).toContain('You accepted this request');
  });

  // The old screen's back button dropped the salon in the Queue tab, which is
  // where bookings live — not where requests do.
  it('goes back to the booking requests tab, not the queue', async () => {
    const navigate = vi.fn();
    const { container } = await render(<BookingRequestScreen params={{ bookingRequestId: 'req-1' }} navigate={navigate} notify={vi.fn()} />);
    const back = container.querySelector('.page-header button');
    await act(async () => { back.click(); });
    expect(navigate).toHaveBeenCalledWith('bookingRequests');
    expect(navigate).not.toHaveBeenCalledWith('queue');
  });

  // Reported: the admin accepted the request, the panel updated, and this screen
  // — the one opened from the notification — kept counting down and kept offering
  // Accept. It only ever read the request once.
  it('stops the timer when My Naai answers while the screen is open', async () => {
    const { container } = await render(<BookingRequestScreen params={{ bookingRequestId: 'req-1' }} session={{ role: 'SALON', userId: 'salon-1' }} navigate={vi.fn()} notify={vi.fn()} />);
    expect(container.querySelector('.request-timer')).not.toBeNull();

    // The admin's accept re-reads the request; the re-read is what the salon
    // sees (accepted by My Naai, no buttons).
    getBookingRequestById.mockResolvedValue({
      status: 'SUCCESS',
      data: { ...REQUEST, status: 'ACCEPTED' },
    });
    emitLive('booking_request_updated', { bookingRequestId: 'req-1', status: 'ACCEPTED' });

    expect(container.querySelector('.request-timer')).toBeNull();
    expect(texts(container)).not.toContain('Accept');
    await flush();
    expect(getBookingRequestById.mock.calls.length).toBeGreaterThan(1);
    expect(container.textContent).toContain('You accepted this request');
  });

  it('re-reads for the admin-answer and queue events, and only for this salon', async () => {
    await render(<BookingRequestScreen params={{ bookingRequestId: 'req-1' }} session={{ role: 'SALON', userId: 'salon-1' }} navigate={vi.fn()} notify={vi.fn()} />);
    const before = getBookingRequestById.mock.calls.length;

    emitLive('booking_request_answered_by_admin', { bookingRequestId: 'req-1', action: 'ACCEPT' });
    await flush();
    emitLive('queue_updated', { bookingId: 'bk-1' });
    await flush();

    expect(getBookingRequestById.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
    // Every subscription is in the signed-in salon's own room.
    expect(subscribeToLiveUpdates.mock.calls.every(([args]) => args.scope === 'salon' && args.id === 'salon-1')).toBe(true);
  });

  it('answers in place and records the outcome on the server', async () => {
    const navigate = vi.fn();
    const notify = vi.fn();
    const { container } = await render(<BookingRequestScreen params={{ bookingRequestId: 'req-1' }} navigate={navigate} notify={notify} />);
    const accept = Array.from(container.querySelectorAll('button')).find(button => button.textContent.trim() === 'Accept');
    await act(async () => { accept.click(); });
    await flush();
    expect(bookingRequestOwnerAction).toHaveBeenCalledWith('req-1', { action: 'ACCEPT' });
    expect(notify).toHaveBeenCalledWith('success', 'Booking accepted.');
    // An accepted request IS a booking, so this is the one place Queue is right.
    expect(navigate).toHaveBeenCalledWith('queue');
  });
});
