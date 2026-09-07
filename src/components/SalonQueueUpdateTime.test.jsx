import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SalonQueueScreen } from './SalonScreens';
import { ConfirmProvider } from './ConfirmDialog';

const { customerList, salonUpdateBookingTime } = vi.hoisted(() => ({
  customerList: vi.fn(),
  salonUpdateBookingTime: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, customerList, salonUpdateBookingTime } };
});

vi.mock('../lib/socket', () => ({ subscribeToLiveUpdates: () => () => {} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Far-future so the "already passed" guard never fires by accident.
const bookingDate = '2099-09-07';
const booking = {
  bookingId: 'bk-1',
  bookingRequestId: 'req-1',
  userName: 'Asha',
  bookingDate,
  bookingTime: '18:30:00',
  serviceNames: 'Haircut',
};

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

function byText(label, root = document.body) {
  return Array.from(root.querySelectorAll('button')).find(node => node.textContent.trim().replace(/\s+/g, ' ') === label);
}

async function renderQueue(notify = () => {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ConfirmProvider>
        <SalonQueueScreen session={{ userId: 'salon-1' }} navigate={() => {}} notify={notify} />
      </ConfirmProvider>,
    );
  });
  await flush();
  return { container, root };
}

describe('salon queue — update appointment time', () => {
  beforeEach(() => {
    customerList.mockReset();
    salonUpdateBookingTime.mockReset();
    customerList.mockResolvedValue({ status: 'SUCCESS', data: { bookings: [booking] } });
    salonUpdateBookingTime.mockResolvedValue({ status: 'SUCCESS' });
  });
  afterEach(() => { document.body.innerHTML = ''; });

  it('offers an Update time action on each queued booking', async () => {
    const { container, root } = await renderQueue();
    expect(container.textContent).toContain('Asha');
    expect(byText('Update time', container)).toBeTruthy();
    await act(async () => { root.unmount(); });
  });

  it('previews the resulting clock time before anything is sent', async () => {
    const { container, root } = await renderQueue();
    await act(async () => { byText('Update time', container).click(); });
    await flush();

    // Nothing is sendable until a new time is chosen.
    expect(document.body.textContent).toContain('Choose a new time to continue');
    expect(byText('Update & notify').disabled).toBe(true);

    await act(async () => { byText('+20 min').click(); });
    await flush();

    // 18:30 + 20m = 18:50 -> "06:50 PM" in en-IN.
    expect(document.body.textContent).toContain('50');
    expect(document.body.textContent).toContain('20 minutes later');
    expect(salonUpdateBookingTime).not.toHaveBeenCalled();

    await act(async () => { root.unmount(); });
  });

  it('sends a signed offset plus the resolved time and notifies the salon', async () => {
    const notify = vi.fn();
    const { container, root } = await renderQueue(notify);
    await act(async () => { byText('Update time', container).click(); });
    await flush();
    await act(async () => { byText('+20 min').click(); });
    await flush();
    await act(async () => { byText('Update & notify').click(); });
    await flush();
    await flush();

    expect(salonUpdateBookingTime).toHaveBeenCalledTimes(1);
    const [requestId, payload] = salonUpdateBookingTime.mock.calls[0];
    // owner-action is addressed by the request id, not the booking id.
    expect(requestId).toBe('req-1');
    expect(payload.offsetMinutes).toBe(20);
    expect(payload.bookingTime).toBe('18:50:00');
    expect(payload.bookingDate).toBe(bookingDate);
    expect(payload.proposedTime).toContain('50');

    expect(notify).toHaveBeenCalledWith('success', expect.stringContaining('Asha'));
    await act(async () => { root.unmount(); });
  });

  it('supports moving a booking earlier with a negative offset', async () => {
    const { container, root } = await renderQueue();
    await act(async () => { byText('Update time', container).click(); });
    await flush();
    await act(async () => { byText('-15 min').click(); });
    await flush();

    expect(document.body.textContent).toContain('15 minutes earlier');

    await act(async () => { byText('Update & notify').click(); });
    await flush();
    await flush();

    const [, payload] = salonUpdateBookingTime.mock.calls[0];
    expect(payload.offsetMinutes).toBe(-15);
    expect(payload.bookingTime).toBe('18:15:00');
    await act(async () => { root.unmount(); });
  });

  it('rolls back the row and reports the error when the update fails', async () => {
    salonUpdateBookingTime.mockRejectedValue(new Error('Server refused the change'));
    const notify = vi.fn();
    const { container, root } = await renderQueue(notify);
    await act(async () => { byText('Update time', container).click(); });
    await flush();
    await act(async () => { byText('+30 min').click(); });
    await flush();
    await act(async () => { byText('Update & notify').click(); });
    await flush();
    await flush();

    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('Server refused the change'));
    // The original 6:30 slot is still shown, not the optimistic 7:00 one.
    // (ICU renders the meridiem as 'pm' or 'PM' depending on the build.)
    expect(container.textContent.toLowerCase()).toContain('06:30 pm');
    expect(container.textContent.toLowerCase()).not.toContain('07:00 pm →');
    await act(async () => { root.unmount(); });
  });

  it('refuses to notify a customer about a time that has already passed', async () => {
    // A booking earlier today: pulling it 30 minutes further back lands in the past.
    const past = new Date(Date.now() - 5 * 60000);
    const pad = value => String(value).padStart(2, '0');
    customerList.mockResolvedValue({
      status: 'SUCCESS',
      data: {
        bookings: [{
          ...booking,
          bookingDate: `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`,
          bookingTime: `${pad(past.getHours())}:${pad(past.getMinutes())}:00`,
        }],
      },
    });
    const { container, root } = await renderQueue();
    await act(async () => { byText('Update time', container).click(); });
    await flush();
    await act(async () => { byText('-30 min').click(); });
    await flush();

    expect(document.body.textContent).toContain('That time has already passed');
    expect(byText('Update & notify').disabled).toBe(true);
    expect(salonUpdateBookingTime).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });
});
