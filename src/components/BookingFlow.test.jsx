import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BookingsScreen, ScheduleScreen } from './UserScreens';
import { ConfirmProvider } from './ConfirmDialog';

// The reported mix-up this suite pins down: a customer sent a booking *request*,
// the salon had not answered yet, and the app was already telling them
// "Reminder set — 30 min before your visit" and arming a reminder for a slot
// nobody had agreed to. A request says what it is — sent, waiting for the salon
// — and the reminder belongs to a booking the salon has confirmed.
const { createBookingRequest, bookedSalonList, scheduleBookingReminder, remindersEnabled } = vi.hoisted(() => ({
  createBookingRequest: vi.fn(),
  bookedSalonList: vi.fn(),
  scheduleBookingReminder: vi.fn(() => Promise.resolve('armed')),
  remindersEnabled: vi.fn(() => true),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, createBookingRequest, bookedSalonList } };
});

vi.mock('../lib/reminders', async () => {
  const actual = await vi.importActual('../lib/reminders');
  return { ...actual, scheduleBookingReminder, remindersEnabled, armStoredReminders: vi.fn(), cancelBookingReminder: vi.fn(), setRemindersEnabled: vi.fn() };
});

vi.mock('../lib/socket', () => ({ subscribeToLiveUpdates: () => () => {} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

async function render(node) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ConfirmProvider>{node}</ConfirmProvider>); });
  await flush();
  return { container, root };
}

function byText(label, container = document.body) {
  return Array.from(container.querySelectorAll('button')).find(node => node.textContent.trim().replace(/\s+/g, ' ').startsWith(label));
}

const SALON = {
  salonId: 'salon-1',
  salonName: 'Glow Studio',
  businessHours: { openingTime: '09:00:00', closingTime: '21:00:00', holidayDays: [] },
  bookedSlots: [],
};

// A slot that is always in the future, whatever time of day the suite runs.
const futureDate = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'Asia/Kolkata';
  createBookingRequest.mockResolvedValue({ status: 'SUCCESS', data: { bookingRequestId: 'req-77' } });
  bookedSalonList.mockResolvedValue({ status: 'SUCCESS', data: { bookings: [] } });
  remindersEnabled.mockReturnValue(true);
  scheduleBookingReminder.mockResolvedValue('armed');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a booking request the salon has not answered yet', () => {
  it('tells the customer it was sent and is waiting, instead of promising a reminder', async () => {
    const notify = vi.fn();
    const navigate = vi.fn();
    const { container } = await render(
      <ScheduleScreen
        params={{ salon: SALON, selectedServices: [{ serviceId: 'svc-1', name: 'Haircut', price: 300 }] }}
        navigate={navigate}
        notify={notify}
      />,
    );

    await act(async () => { byText('Confirm booking', container).click(); });
    await flush();

    expect(createBookingRequest).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('success', 'Booking request sent to Glow Studio.');
    // The whole point: no reminder for a slot the salon has not accepted, and
    // no "reminder set" message either.
    expect(scheduleBookingReminder).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('info', expect.stringContaining('Reminder set'));
    // …and the customer is told what happens next, in words, on the screen.
    expect(container.textContent).toContain('Booking sent to the salon');
    expect(container.textContent).toContain('Glow Studio');
    expect(container.textContent).toContain('Waiting for the salon to accept it');
  });

  it('shows a waiting booking as "Waiting for salon" in the list, with no reminder armed', async () => {
    bookedSalonList.mockResolvedValue({
      status: 'SUCCESS',
      data: { bookings: [{ bookingId: 'bk-1', salonName: 'Glow Studio', bookingDate: futureDate(), bookingTime: '18:30:00', status: 'pending' }] },
    });
    const { container } = await render(<BookingsScreen session={{ userId: 'user-1' }} notify={() => {}} />);

    expect(container.textContent).toContain('Waiting for salon');
    expect(container.textContent).toContain('Waiting for the salon to accept');
    expect(container.textContent).toContain('waiting for their action');
    expect(scheduleBookingReminder).not.toHaveBeenCalled();
  });

  it('arms the 30-minute reminder once the salon has confirmed the booking', async () => {
    bookedSalonList.mockResolvedValue({
      status: 'SUCCESS',
      data: { bookings: [{ bookingId: 'bk-2', salonName: 'Glow Studio', bookingDate: futureDate(), bookingTime: '18:30:00', status: 'confirmed' }] },
    });
    const { container } = await render(<BookingsScreen session={{ userId: 'user-1' }} notify={() => {}} />);

    expect(container.textContent).toContain('Confirmed');
    expect(scheduleBookingReminder).toHaveBeenCalledTimes(1);
    expect(scheduleBookingReminder).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'bk-2', salonName: 'Glow Studio' }));
    expect(container.textContent).not.toContain('Waiting for the salon to accept');
  });

  it('stays quiet about reminders when the customer switched them off', async () => {
    remindersEnabled.mockReturnValue(false);
    bookedSalonList.mockResolvedValue({
      status: 'SUCCESS',
      data: { bookings: [{ bookingId: 'bk-3', bookingDate: futureDate(), bookingTime: '18:30:00', status: 'confirmed' }] },
    });
    await render(<BookingsScreen session={{ userId: 'user-1' }} notify={() => {}} />);
    expect(scheduleBookingReminder).not.toHaveBeenCalled();
  });
});
