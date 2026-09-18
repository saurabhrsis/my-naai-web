import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BookingRequestAlert, BOOKING_ALERT_WINDOW_MS } from './BookingRequestAlert';

const { getBookingRequestById, bookingRequestOwnerAction, closeNotification } = vi.hoisted(() => ({
  getBookingRequestById: vi.fn(),
  bookingRequestOwnerAction: vi.fn(),
  closeNotification: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, getBookingRequestById, bookingRequestOwnerAction } };
});

vi.mock('../lib/push', async () => {
  const actual = await vi.importActual('../lib/push');
  return { ...actual, closeNotification };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

function byText(label, root = document.body) {
  return Array.from(root.querySelectorAll('button')).find(node => node.textContent.trim().replace(/\s+/g, ' ').startsWith(label));
}

async function renderCard(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const alert = props.alert || { data: { bookingRequestId: 'req-1', type: 'BOOKING_REQUEST' }, sentAt: Date.now() };
  await act(async () => {
    root.render(<BookingRequestAlert alert={alert} notify={() => {}} navigate={() => {}} onDone={() => {}} onDismiss={() => {}} {...props} />);
  });
  await flush();
  return { container, root };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getBookingRequestById.mockResolvedValue({
    data: { customerName: 'Riya Sharma', bookingDate: '2099-09-07', startTime: '18:30:00', endTime: '19:00:00' },
  });
  bookingRequestOwnerAction.mockResolvedValue({ status: 'SUCCESS' });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the in-app booking request alert', () => {
  it('names the customer and the slot, and offers the three answers', async () => {
    const { container } = await renderCard();
    expect(container.textContent).toContain('Riya Sharma');
    expect(container.textContent).toContain('18:30:00');
    expect(byText('Accept', container)).toBeTruthy();
    expect(byText('Reject', container)).toBeTruthy();
    expect(byText('Update time', container)).toBeTruthy();
  });

  it('accepts the request and clears the OS notification with it', async () => {
    const onDone = vi.fn();
    const notify = vi.fn();
    const { container } = await renderCard({ onDone, notify });

    await act(async () => { byText('Accept', container).click(); });
    await flush();

    expect(bookingRequestOwnerAction).toHaveBeenCalledWith('req-1', { action: 'ACCEPT' });
    expect(closeNotification).toHaveBeenCalledWith('req-1');
    expect(notify).toHaveBeenCalledWith('success', 'Booking accepted.');
    expect(onDone).toHaveBeenCalledWith('ACCEPT');
  });

  it('rejects the request', async () => {
    const { container } = await renderCard();
    await act(async () => { byText('Reject', container).click(); });
    await flush();
    expect(bookingRequestOwnerAction).toHaveBeenCalledWith('req-1', { action: 'REJECT' });
    expect(closeNotification).toHaveBeenCalledWith('req-1');
  });

  it('keeps a failed answer on the card, with the reason', async () => {
    const notify = vi.fn();
    bookingRequestOwnerAction.mockRejectedValue(new Error('network down'));
    const { container } = await renderCard({ notify });

    await act(async () => { byText('Accept', container).click(); });
    await flush();

    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('network down'));
    // Still answerable: a failure must not swallow the salon's only chance.
    expect(byText('Accept', container)).toBeTruthy();
  });

  it('hands the delay to the request screen, where the minutes are chosen', async () => {
    const navigate = vi.fn();
    const onDismiss = vi.fn();
    const { container } = await renderCard({ navigate, onDismiss });

    await act(async () => { byText('Update time', container).click(); });
    await flush();

    expect(navigate).toHaveBeenCalledWith('bookingRequest', { bookingRequestId: 'req-1', openDelayModal: 'true' });
    expect(closeNotification).toHaveBeenCalledWith('req-1');
    expect(onDismiss).toHaveBeenCalled();
  });

  it('takes the answers away when the minute is up', async () => {
    const { container } = await renderCard({ alert: { data: { bookingRequestId: 'req-1' }, sentAt: Date.now() } });
    expect(byText('Accept', container)).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(BOOKING_ALERT_WINDOW_MS + 1000);
      await Promise.resolve();
    });
    await flush();

    // A booking request is answerable for one minute — the server will refuse
    // anything later, so the buttons must not pretend otherwise.
    expect(byText('Accept', container)).toBeUndefined();
    expect(byText('Reject', container)).toBeUndefined();
    expect(container.textContent).toContain('The 60-second answer window has closed');
    expect(byText('Open request', container)).toBeTruthy();
    expect(bookingRequestOwnerAction).not.toHaveBeenCalled();
  });

  it('uses the server\u2019s own window when the request is already a few seconds old', async () => {
    // The 60 seconds belong to the request, not to this device: a push that took
    // five seconds to arrive leaves 55, and the card must not offer a minute.
    getBookingRequestById.mockResolvedValue({
      data: { customerName: 'Riya Sharma', bookingDate: '2099-09-07', startTime: '18:30:00', createdAt: new Date(Date.now() - 30000).toISOString() },
    });
    const { container } = await renderCard();
    await flush();

    const countdown = container.querySelector('.booking-alert .request-timer strong')?.textContent || '';
    expect(countdown).toBe('0:30');
  });

  it('stays shut for an alert that is already older than its window', async () => {
    const { container } = await renderCard({ alert: { data: { bookingRequestId: 'req-1' }, sentAt: Date.now() - BOOKING_ALERT_WINDOW_MS - 5000 } });
    expect(byText('Accept', container)).toBeUndefined();
    expect(container.textContent).toContain('window has closed');
  });

  it('shows nothing at all without a request to act on', async () => {
    const { container } = await renderCard({ alert: { data: {}, sentAt: Date.now() } });
    expect(container.textContent).toBe('');
  });
});
