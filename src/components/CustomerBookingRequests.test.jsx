import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmProvider } from './ConfirmDialog';
import { CustomerBookingRequests } from './CustomerBookingRequests';
import { LEAD_CUSTOMER_LABEL, LEAD_STATE, leadView, normalizeLead } from '../lib/bookingLeads';

const { userBookingRequestList, subscribeToLiveUpdates } = vi.hoisted(() => ({
  userBookingRequestList: vi.fn(),
  subscribeToLiveUpdates: vi.fn(() => () => {}),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, userBookingRequestList } };
});

// The tab subscribes to the shared socket; jsdom has no server, so the
// subscriptions are recorded here and the tests deliver the events themselves —
// exactly what the server would push into `user_<id>`.
vi.mock('../lib/socket', () => ({ subscribeToLiveUpdates }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = { role: 'USER', userId: 'user-1' };
const minutesAgo = minutes => new Date(Date.now() - minutes * 60000).toISOString();

const request = overrides => ({
  bookingRequestId: 'req-1',
  salonName: 'Glow Studio',
  bookingDate: '2026-11-06',
  bookingTime: '18:30:00',
  status: 'PENDING',
  createdAt: new Date().toISOString(),
  services: [{ serviceId: 's1', serviceName: 'Haircut', price: 300 }],
  ...overrides,
});

// Deliver a server event to every handler the screen registered for it, the way
// lib/socket does when the socket delivers one.
const emitLive = (event, payload) => {
  act(() => {
    subscribeToLiveUpdates.mock.calls
      .filter(([args]) => args.event === event && typeof args.handler === 'function')
      .forEach(([args]) => args.handler(payload));
  });
};

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
  userBookingRequestList.mockResolvedValue({
    status: 'SUCCESS',
    data: {
      requests: [
        request({ bookingRequestId: 'live-1' }),
        request({ bookingRequestId: 'acc-1', salonName: 'Urban Cut Studio', status: 'ACCEPTED', createdAt: minutesAgo(30) }),
        // Never answered: PENDING on the row, but the five minutes are gone.
        request({ bookingRequestId: 'gone-1', salonName: 'Trim & Co.', status: 'PENDING', createdAt: minutesAgo(20) }),
      ],
      pagination: { page: 1, totalPages: 1, totalRequests: 3 },
    },
  });
});

afterEach(() => { document.body.innerHTML = ''; });

describe('customer booking requests tab', () => {
  it('reads the customer list, not the salon one', async () => {
    await render(<CustomerBookingRequests session={SESSION} notify={vi.fn()} />);
    expect(userBookingRequestList).toHaveBeenCalledTimes(1);
    expect(userBookingRequestList.mock.calls[0][0]).toMatchObject({ page: 1 });
    // The customer never names a salon or a customer id in the body: the server
    // answers from the token.
    expect(userBookingRequestList.mock.calls[0][0]).not.toHaveProperty('salonId');
    expect(userBookingRequestList.mock.calls[0][0]).not.toHaveProperty('userId');
  });

  it('shows the live request with a countdown and no actions at all', async () => {
    const { container } = await render(<CustomerBookingRequests session={SESSION} notify={vi.fn()} />);
    const text = container.textContent;
    expect(text).toContain('Glow Studio');
    expect(text).toContain(LEAD_CUSTOMER_LABEL.awaiting);
    // "4:59 left to be answered" (or 5:00 on the first tick).
    expect(text).toMatch(/[45]:\d\d left to be answered/);
    // History, not a control panel: the only buttons are the three list filters
    // and Refresh — nothing in this tab accepts, rejects or cancels a request.
    const buttons = [...container.querySelectorAll('button')].map(button => button.textContent.trim());
    expect(buttons.every(label => /^(All requests|Waiting|Answered|Refresh)/.test(label))).toBe(true);
    // No action classes at all — not even the salon's accept/reject buttons.
    expect(container.querySelectorAll('.lead-answer, .cancel-booking')).toHaveLength(0);
  });

  it('reads a request nobody answered as expired, not rejected', async () => {
    const { container } = await render(<CustomerBookingRequests session={SESSION} notify={vi.fn()} />);
    expect(container.textContent).toContain(LEAD_CUSTOMER_LABEL.autoCancelled);
    expect(container.textContent).not.toContain(LEAD_CUSTOMER_LABEL.rejected);
    // The accepted one is its own state.
    expect(container.textContent).toContain(LEAD_CUSTOMER_LABEL.accepted);
  });

  it('says the history arrives with the backend update when the endpoint is missing', async () => {
    const error = new Error('Cannot POST /api/bookingRequest/user/list');
    error.status = 404;
    userBookingRequestList.mockRejectedValueOnce(error);
    const notify = vi.fn();
    const { container } = await render(<CustomerBookingRequests session={SESSION} notify={notify} />);
    expect(container.textContent).toContain('next backend update');
    // A missing endpoint is not an error the customer can act on.
    expect(notify).not.toHaveBeenCalled();
  });

  it('stops the countdown the moment the answer arrives, before any reload', async () => {
    const { container } = await render(<CustomerBookingRequests session={SESSION} notify={vi.fn()} />);
    expect(container.textContent).toMatch(/left to be answered/);

    // The admin accepted it on the salon's behalf: the backend emits into this
    // customer's own room. The card must act on the status it was given, not
    // wait for the refetch to come back with it.
    emitLive('booking_request_updated', { bookingRequestId: 'live-1', status: 'ACCEPTED' });

    expect(container.textContent).not.toMatch(/left to be answered/);
    expect(container.textContent).toContain(LEAD_CUSTOMER_LABEL.accepted);
    // …and it still re-reads afterwards, so the card ends up with the row the
    // server actually holds rather than the event's label.
    await flush();
    expect(userBookingRequestList.mock.calls.length).toBeGreaterThan(1);
  });

  it('subscribes to the customer room for both request events', async () => {
    await render(<CustomerBookingRequests session={SESSION} notify={vi.fn()} />);
    const events = subscribeToLiveUpdates.mock.calls.map(([args]) => args.event);
    expect(events).toContain('booking_request_updated');
    expect(events).toContain('booking_status_updated');
    expect(subscribeToLiveUpdates.mock.calls.every(([args]) => args.scope === 'user' && args.id === 'user-1')).toBe(true);
  });

  it('stops counting down the instant the window closes', () => {
    const lead = normalizeLead(request());
    const view = leadView(lead, lead.expiresAt + 1);
    expect(view.state).toBe(LEAD_STATE.autoCancelled);
    expect(view.countdown).toBe('');
    expect(view.canAnswer).toBe(false);
  });
});
