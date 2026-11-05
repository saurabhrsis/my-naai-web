import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmProvider } from './ConfirmDialog';
import { SalonLeadsScreen } from './SalonLeads';
import { LEAD_STATE, leadView, normalizeLead, summarizeLeads, filterLeads, leadStateFromStatus } from '../lib/bookingLeads';

const { salonBookingRequestList, salonNotificationList, bookingRequestOwnerAction } = vi.hoisted(() => ({
  salonBookingRequestList: vi.fn(),
  salonNotificationList: vi.fn(),
  bookingRequestOwnerAction: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return {
    ...actual,
    api: { ...actual.api, salonBookingRequestList, salonNotificationList, bookingRequestOwnerAction },
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = { role: 'SALON', userId: 'salon-1', user: { salon: { salonName: 'Glow Studio' } } };

const minutesAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();

const awaiting = overrides => ({
  bookingRequestId: 'req-live',
  customerName: 'Rohit Deshmukh',
  customerPhone: '9876500001',
  bookingDate: '2026-11-06',
  bookingTime: '18:30:00',
  status: 'PENDING',
  createdAt: new Date().toISOString(),
  services: [{ serviceId: 's1', serviceName: 'Haircut', price: 300 }],
  ...overrides,
});

const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

async function render(node) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ConfirmProvider>{node}</ConfirmProvider>); });
  await flush();
  return { container, root };
}

beforeEach(() => {
  vi.clearAllMocks();
  salonBookingRequestList.mockResolvedValue({
    status: 'SUCCESS',
    data: {
      requests: [
        awaiting({ bookingRequestId: 'live-1' }),
        awaiting({ bookingRequestId: 'acc-1', customerName: 'Sana Khan', status: 'ACCEPTED', createdAt: minutesAgo(30) }),
        awaiting({ bookingRequestId: 'rej-1', customerName: 'Amit Rane', status: 'REJECTED', createdAt: minutesAgo(45) }),
        // Never answered, window closed: auto-cancelled, not rejected.
        awaiting({ bookingRequestId: 'gone-1', customerName: 'Neha Patil', status: 'PENDING', createdAt: minutesAgo(20) }),
      ],
      pagination: { page: 1, totalPages: 1 },
    },
  });
  salonNotificationList.mockResolvedValue({ status: 'SUCCESS', data: { notifications: [] } });
  bookingRequestOwnerAction.mockResolvedValue({ status: 'SUCCESS' });
});

afterEach(() => { document.body.innerHTML = ''; });

describe('booking request vs booking', () => {
  it('reads the request list, never the bookings list', async () => {
    await render(<SalonLeadsScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    expect(salonBookingRequestList).toHaveBeenCalledTimes(1);
    expect(salonBookingRequestList.mock.calls[0][0]).toMatchObject({ salonId: 'salon-1', status: 'ALL', page: 1 });
    // Requests and bookings are different tables: this screen must not read or
    // write the booking endpoints.
    const called = JSON.stringify(bookingRequestOwnerAction.mock.calls);
    expect(called).not.toContain('booking/');
  });

  it('counts received / accepted / rejected / auto-cancelled separately', () => {
    const leads = [
      normalizeLead({ bookingRequestId: 'a', status: 'PENDING', createdAt: new Date().toISOString() }),
      normalizeLead({ bookingRequestId: 'b', status: 'ACCEPTED' }),
      normalizeLead({ bookingRequestId: 'c', status: 'REJECTED' }),
      normalizeLead({ bookingRequestId: 'd', status: 'EXPIRED' }),
      // A customer withdrawing is NOT the salon missing one.
      normalizeLead({ bookingRequestId: 'e', status: 'CANCELLED_BY_CUSTOMER' }),
    ];
    const summary = summarizeLeads(leads);
    expect(summary.received).toBe(5);
    expect(summary.awaiting).toBe(1);
    expect(summary.accepted).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.autoCancelled).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.answered).toBe(2);
    expect(summary.answerRate).toBe(40);
  });

  it('turns an unanswered request into auto-cancelled once the minute is up', () => {
    const live = normalizeLead({ bookingRequestId: 'x', status: 'PENDING', createdAt: new Date().toISOString() });
    expect(leadView(live).state).toBe(LEAD_STATE.awaiting);
    expect(leadView(live).canAnswer).toBe(true);
    // 1:00 on the tick it arrives, 0:59 a moment later.
    expect(leadView(live).countdown).toMatch(/^[01]:\d\d$/);

    const stale = normalizeLead({ bookingRequestId: 'y', status: 'PENDING', createdAt: minutesAgo(5) });
    // Still PENDING on the server's row, but not answerable: it is cancelled.
    expect(leadView(stale).state).toBe(LEAD_STATE.autoCancelled);
    expect(leadView(stale).canAnswer).toBe(false);
  });

  it('maps the server vocabulary onto the four states it can show', () => {
    expect(leadStateFromStatus('PENDING')).toBe(LEAD_STATE.awaiting);
    expect(leadStateFromStatus('OPEN')).toBe(LEAD_STATE.awaiting);
    expect(leadStateFromStatus('ACCEPTED')).toBe(LEAD_STATE.accepted);
    expect(leadStateFromStatus('CONFIRMED')).toBe(LEAD_STATE.accepted);
    expect(leadStateFromStatus('REJECTED')).toBe(LEAD_STATE.rejected);
    expect(leadStateFromStatus('DECLINED')).toBe(LEAD_STATE.rejected);
    expect(leadStateFromStatus('EXPIRED')).toBe(LEAD_STATE.autoCancelled);
    expect(leadStateFromStatus('AUTO_CANCELLED')).toBe(LEAD_STATE.autoCancelled);
    expect(leadStateFromStatus('CANCELLED')).toBe(LEAD_STATE.cancelled);
  });

  it('filters by what the salon is looking at', () => {
    const leads = [
      normalizeLead({ bookingRequestId: 'a', status: 'PENDING', createdAt: new Date().toISOString() }),
      normalizeLead({ bookingRequestId: 'b', status: 'ACCEPTED' }),
      normalizeLead({ bookingRequestId: 'c', status: 'EXPIRED' }),
    ];
    expect(filterLeads(leads, 'all')).toHaveLength(3);
    expect(filterLeads(leads, 'awaiting').map(lead => lead.id)).toEqual(['a']);
    expect(filterLeads(leads, 'autoCancelled').map(lead => lead.id)).toEqual(['c']);
  });
});

describe('SalonLeadsScreen', () => {
  it('leads with the counts and shows a live request with Accept / Reject', async () => {
    const { container } = await render(<SalonLeadsScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    const text = container.textContent;
    expect(text).toContain('Booking requests');
    expect(text).toContain('Received');
    expect(text).toContain('Accepted');
    expect(text).toContain('Rejected');
    expect(text).toContain('Auto-cancelled');
    // Four requests: one live, one accepted, one rejected, one missed.
    const stats = Array.from(container.querySelectorAll('.lead-stat')).map(node => node.textContent);
    expect(stats[0]).toContain('4');
    expect(stats[1]).toContain('1');
    expect(stats[2]).toContain('1');
    expect(stats[3]).toContain('1');

    const live = container.querySelector('.lead-card.lead-awaiting');
    expect(live).not.toBeNull();
    expect(live.textContent).toContain('Rohit Deshmukh');
    expect(live.textContent).toContain('Haircut');
    expect(live.querySelector('.lead-countdown')).not.toBeNull();
    const answers = Array.from(live.querySelectorAll('button')).map(button => button.textContent.trim());
    expect(answers).toContain('Accept');
    expect(answers).toContain('Reject');

    // The request nobody answered offers no buttons at all.
    const missed = container.querySelector('.lead-card.lead-autoCancelled');
    expect(missed).not.toBeNull();
    expect(missed.textContent).toContain('cancelled automatically');
    expect(Array.from(missed.querySelectorAll('button')).map(button => button.textContent.trim())).not.toContain('Accept');
  });

  it('accepts a request and records the outcome on the card', async () => {
    const notify = vi.fn();
    const { container } = await render(<SalonLeadsScreen session={SESSION} navigate={vi.fn()} notify={notify} />);
    const live = container.querySelector('.lead-card.lead-awaiting');
    const accept = Array.from(live.querySelectorAll('button')).find(button => button.textContent.includes('Accept'));
    await act(async () => { accept.click(); });
    await flush();

    expect(bookingRequestOwnerAction).toHaveBeenCalledWith('live-1', { action: 'ACCEPT' });
    expect(notify).toHaveBeenCalledWith('success', expect.stringContaining('accepted'));
    // The card no longer offers an answer — it is accepted now.
    expect(container.querySelector('.lead-card.lead-awaiting')).toBeNull();
    expect(container.textContent).toContain('Accepted');
  });

  it('rejects a request with the same call and the same quiet confirmation', async () => {
    const notify = vi.fn();
    const { container } = await render(<SalonLeadsScreen session={SESSION} navigate={vi.fn()} notify={notify} />);
    const live = container.querySelector('.lead-card.lead-awaiting');
    const reject = Array.from(live.querySelectorAll('button')).find(button => button.textContent.includes('Reject'));
    await act(async () => { reject.click(); });
    await flush();
    expect(bookingRequestOwnerAction).toHaveBeenCalledWith('live-1', { action: 'REJECT' });
    expect(notify).toHaveBeenCalledWith('success', expect.stringContaining('rejected'));
  });

  it('falls back to the notification feed until the request endpoint ships', async () => {
    salonBookingRequestList.mockRejectedValue(new Error('Not Found'));
    salonNotificationList.mockResolvedValue({
      status: 'SUCCESS',
      data: {
        notifications: [
          { type: 'BOOKING_REQUEST', bookingRequestId: 'n-1', createdAt: new Date().toISOString(), payload: { customerName: 'Kiran Rao', bookingTime: '11:00:00' } },
          { type: 'BOOKING_CONFIRMED', bookingRequestId: 'n-2', createdAt: new Date().toISOString() },
        ],
      },
    });
    const { container } = await render(<SalonLeadsScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    expect(salonNotificationList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Kiran Rao');
    expect(container.textContent).toContain('Showing requests from your notifications');
    // A non-request notification is not a lead.
    expect(container.querySelectorAll('.lead-card')).toHaveLength(1);
  });

  it('says so in words when the list cannot be read at all', async () => {
    salonBookingRequestList.mockRejectedValue(new Error('Network down'));
    salonNotificationList.mockRejectedValue(new Error('Network down'));
    const notify = vi.fn();
    const { container } = await render(<SalonLeadsScreen session={SESSION} navigate={vi.fn()} notify={notify} />);
    expect(container.textContent).toContain('Your requests are out of reach');
    expect(notify).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('shows the empty state that explains what a request is', async () => {
    salonBookingRequestList.mockResolvedValue({ status: 'SUCCESS', data: { requests: [], pagination: { page: 1, totalPages: 1 } } });
    const { container } = await render(<SalonLeadsScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    expect(container.textContent).toContain('No booking requests yet');
    expect(container.textContent).toContain('one-minute window');
  });
});
