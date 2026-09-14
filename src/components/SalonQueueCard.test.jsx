import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueCardItem, SalonQueueScreen } from './SalonScreens';
import { ConfirmProvider } from './ConfirmDialog';

const { bookingDone, customerList } = vi.hoisted(() => ({
  bookingDone: vi.fn(),
  customerList: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, bookingDone, customerList } };
});

vi.mock('../lib/socket', () => ({ subscribeToLiveUpdates: () => () => {} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A far-future date so the Today group is deterministic and the "due now"
// window can never fire by accident.
const bookingDate = '2099-09-07';
const booking = {
  bookingId: 'bk-1',
  userName: 'Asha Sharma',
  userPhone: '9876543210',
  bookingDate,
  bookingTime: '18:30:00',
  serviceNames: 'Haircut, Beard Trim and Hair Spa',
  barberName: 'Raju',
};

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

function byText(label, root = document.body) {
  return Array.from(root.querySelectorAll('button')).find(node => node.textContent.trim().replace(/\s+/g, ' ') === label);
}

async function renderQueue(items, notify = () => {}) {
  customerList.mockResolvedValue({ status: 'SUCCESS', data: { bookings: items } });
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

function renderCard(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

// A fixed clock, so a "Due now" chip means the same thing on every run.
const clockSix = new Date(2026, 8, 7, 18, 0, 0);

async function renderQueueCard(props) {
  const { container, root } = renderCard(props);
  await act(async () => {
    root.render(<QueueCardItem now={clockSix} onUpdateTime={() => {}} onComplete={() => {}} {...props} />);
  });
  return { container, root };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('salon queue card — every detail stays on screen', () => {
  beforeEach(() => {
    bookingDone.mockReset();
    customerList.mockReset();
    bookingDone.mockResolvedValue({ status: 'SUCCESS' });
  });

  it('shows the customer, the slot, the services, the specialist and the phone', async () => {
    const { container, root } = await renderQueue([booking]);
    const card = container.querySelector('.queue-card');
    const text = card.textContent.toLowerCase();

    expect(card.querySelector('.queue-identity h3').textContent).toBe('Asha Sharma');
    expect(text).toContain('07 sept 2099');
    expect(text).toContain('06:30 pm');
    expect(text).toContain('haircut, beard trim and hair spa');
    expect(text).toContain('raju');
    expect(text).toContain('9876543210');
    // The number is a real call link, not just text to read out to someone.
    expect(card.querySelector('.queue-fact-call').getAttribute('href')).toBe('tel:9876543210');
    await act(async () => { root.unmount(); });
  });

  it('does not let the action buttons share a row with the customer name', async () => {
    // The iPhone bug this guards: the buttons lived in the heading row, took all
    // of its width, and squeezed the name and the appointment time to nothing.
    const { container, root } = await renderQueue([booking]);
    const card = container.querySelector('.queue-card');

    expect(card.querySelector('.queue-card-top button')).toBeNull();
    expect(card.querySelector('.queue-identity button')).toBeNull();
    expect(card.querySelector('.queue-when button')).toBeNull();
    // They sit on their own row, as a direct child of the card.
    const actions = card.querySelector('.queue-card-actions');
    expect(actions.parentElement).toBe(card);
    expect(byText('Update time', actions)).toBeTruthy();
    expect(byText('Done', actions)).toBeTruthy();
    await act(async () => { root.unmount(); });
  });

  it('keeps a long customer name whole instead of cutting it off', async () => {
    const long = { ...booking, userName: 'Priyanka Chatterjee-Whitfield' };
    const { container, root } = await renderQueue([long]);
    expect(container.querySelector('.queue-identity h3').textContent).toBe('Priyanka Chatterjee-Whitfield');
    await act(async () => { root.unmount(); });
  });

  it('fills in what a booking is missing instead of leaving a hole', async () => {
    const { container, root } = await renderQueue([{ ...booking, userPhone: '0000000000', barberName: '', serviceNames: '' }]);
    const text = container.textContent.toLowerCase();
    expect(text).toContain('any specialist');
    expect(text).toContain('salon service');
    // The placeholder number the backend uses for "no phone" never becomes a call link.
    expect(container.querySelector('.queue-fact-call')).toBeNull();
    expect(text).not.toContain('0000000000');
    await act(async () => { root.unmount(); });
  });

  it('still marks a service done from the new action row', async () => {
    const notify = vi.fn();
    const { container, root } = await renderQueue([booking], notify);
    await act(async () => { byText('Done', container).click(); });
    await flush();
    await act(async () => { document.querySelector('.confirm-ok').click(); });
    await flush();
    await flush();

    expect(bookingDone).toHaveBeenCalledWith({ salonId: 'salon-1', bookingId: 'bk-1' });
    expect(notify).toHaveBeenCalledWith('success', 'Service marked as completed.');
    await act(async () => { root.unmount(); });
  });
});

// `renderCard` fixes the clock at 6 PM on 07 Sep 2026, so these bookings are
// relative to a moment the test owns rather than to the real wall clock.
const dueDate = '2026-09-07';

describe('salon queue card — how soon the chair is needed', () => {
  it('flags a customer the salon is already keeping waiting', async () => {
    const { container, root } = await renderQueueCard({ item: { ...booking, bookingDate: dueDate, bookingTime: '17:35:00' } });
    expect(container.querySelector('.queue-card').className).toContain('queue-card-late');
    expect(container.querySelector('.queue-urgency').textContent).toBe('Overdue by 25 min');
    await act(async () => { root.unmount(); });
  });

  it('highlights the booking that is due right now', async () => {
    const { container, root } = await renderQueueCard({ item: { ...booking, bookingDate: dueDate, bookingTime: '18:05:00' } });
    expect(container.querySelector('.queue-card').className).toContain('queue-card-now');
    expect(container.querySelector('.queue-urgency').textContent).toBe('Due now');
    await act(async () => { root.unmount(); });
  });

  it('counts down a booking that is still coming up', async () => {
    const { container, root } = await renderQueueCard({ item: { ...booking, bookingDate: dueDate, bookingTime: '19:20:00' } });
    expect(container.querySelector('.queue-urgency').textContent).toBe('In 1h 20m');
    await act(async () => { root.unmount(); });
  });

  it('shows no countdown once a slot is hours away — the date carries that', async () => {
    const { container, root } = await renderQueueCard({ item: { ...booking, bookingDate: dueDate, bookingTime: '19:20:00' }, now: new Date(2026, 8, 7, 9, 0, 0) });
    expect(container.querySelector('.queue-urgency')).toBeNull();
    expect(container.querySelector('.queue-when').textContent).toContain('07:20 pm');
    await act(async () => { root.unmount(); });
  });

  it('says the time is pending rather than inventing one', async () => {
    const { container, root } = await renderQueueCard({ item: { ...booking, bookingTime: '' } });
    expect(container.querySelector('.queue-when').textContent).toContain('Time pending');
    expect(container.querySelector('.queue-urgency')).toBeNull();
    expect(byText('Update time', container).disabled).toBe(true);
    await act(async () => { root.unmount(); });
  });
});
