import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmProvider } from './ConfirmDialog';
import { CustomerBookingRequests } from './CustomerBookingRequests';
import { LEAD_CUSTOMER_LABEL, LEAD_STATE, leadView, normalizeLead } from '../lib/bookingLeads';

const { userBookingRequestList } = vi.hoisted(() => ({ userBookingRequestList: vi.fn() }));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, userBookingRequestList } };
});

// The tab subscribes to the shared socket; jsdom has no server, and the
// subscription is a no-op that must not reach the network in a test.
vi.mock('../lib/socket', () => ({ subscribeToLiveUpdates: vi.fn(() => () => {}) }));

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

  it('stops counting down the instant the window closes', () => {
    const lead = normalizeLead(request());
    const view = leadView(lead, lead.expiresAt + 1);
    expect(view.state).toBe(LEAD_STATE.autoCancelled);
    expect(view.countdown).toBe('');
    expect(view.canAnswer).toBe(false);
  });
});
