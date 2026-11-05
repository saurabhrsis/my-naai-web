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

describe('paying for a booking', () => {
  const SERVICES = [
    { serviceId: 'svc-1', name: 'Haircut', price: 300 },
    { serviceId: 'svc-2', name: 'Beard trim', price: 150 },
  ];

  const openCheckout = async () => {
    const result = await render(
      <ScheduleScreen params={{ salon: SALON, selectedServices: SERVICES }} navigate={vi.fn()} notify={vi.fn()} />,
    );
    // Pick tomorrow: today's slots may already be gone late in the evening.
    await act(async () => { byText('Tomorrow', result.container).click(); });
    await flush();
    return result;
  };

  it('offers "Pay at Salon" at the last step, preselected and with the amount', async () => {
    const { container } = await openCheckout();
    const group = container.querySelector('.schedule-pay-options');
    expect(group).not.toBeNull();
    expect(container.textContent).toContain('Pay at Salon');
    // The amount is the sum of the chosen services, and it is paid at the salon.
    expect(container.textContent).toContain('Pay ₹ 450 at the salon after your service');
    expect(container.textContent).toContain('Nothing is charged now.');
    // Preselected: the one radio in the group is checked.
    const radio = container.querySelector('input[name="schedule-payment"]');
    expect(radio).not.toBeNull();
    expect(radio.checked).toBe(true);
    expect(radio.value).toBe('payAtSalon');
    // …and the sticky confirm bar repeats the method under the amount.
    expect(container.querySelector('.schedule-total').textContent).toContain('Pay at salon');
    expect(container.querySelector('.schedule-total').textContent).toContain('₹ 450');
  });

  it('collects no card, UPI or bank details — the booking is not a payment form', async () => {
    const { container } = await openCheckout();
    // The only input on the checkout is the payment radio: there is no card
    // number, expiry, CVV, UPI id or bank field to fill (Terms §4, Privacy §2).
    const inputs = Array.from(container.querySelectorAll('input'));
    expect(inputs).toHaveLength(1);
    expect(inputs[0].type).toBe('radio');
    expect(container.textContent).toContain('never asks for card, UPI or bank details');
    for (const word of ['CVV', 'Card number', 'UPI ID', 'Expiry']) {
      expect(container.textContent).not.toContain(word);
    }
  });

  it('repeats the method on the confirmation, so the counter is no surprise', async () => {
    const { container } = await openCheckout();
    await act(async () => { byText('Review & confirm', container).click(); });
    await flush();
    // The bar opens the checkout; the request leaves from inside it.
    expect(createBookingRequest).not.toHaveBeenCalled();
    await act(async () => { byText('Send booking request', container).click(); });
    await flush();

    expect(createBookingRequest).toHaveBeenCalledTimes(1);
    // Nothing payment-related is sent: My Naai does not process the money.
    expect(createBookingRequest.mock.calls[0][0]).not.toHaveProperty('paymentMode');
    expect(container.textContent).toContain('Booking sent to the salon');
    expect(container.textContent).toContain('Pay ₹ 450 at the salon after your service — nothing was charged now.');
  });
});

// The checkout that stands between the last choice and the API call: reported
// as "before calling api, make checkout modal and show all the details selected
// by customer — salon, services, timing, barber, total amount" plus the payment
// note. So the request must not leave until that card has been read and its own
// button tapped.
describe('the checkout before a request leaves', () => {
  const SERVICES = [
    { serviceId: 'svc-1', name: 'Haircut', price: 300 },
    { serviceId: 'svc-2', name: 'Beard trim', price: 150 },
  ];

  const openSchedule = async (barbers = []) => {
    const result = await render(
      <ScheduleScreen
        params={{ salon: { ...SALON, barbers }, selectedServices: SERVICES }}
        navigate={vi.fn()}
        notify={vi.fn()}
      />,
    );
    await act(async () => { byText('Tomorrow', result.container).click(); });
    await flush();
    return result;
  };

  const openReview = async container => {
    await act(async () => { byText('Review & confirm', container).click(); });
    await flush();
    return container.querySelector('.booking-review');
  };

  it('shows what was chosen — salon, services, timing, barber, total — before the call', async () => {
    const { container } = await openSchedule();
    const review = await openReview(container);

    expect(review).not.toBeNull();
    expect(createBookingRequest).not.toHaveBeenCalled();

    // Who, and where.
    expect(review.textContent).toContain('Glow Studio');
    // What, with each price and the sum.
    expect(review.textContent).toContain('Haircut');
    expect(review.textContent).toContain('Beard trim');
    expect(review.textContent).toContain('₹ 300');
    expect(review.textContent).toContain('₹ 150');
    expect(review.querySelector('.booking-review-total').textContent).toContain('₹ 450');
    // When — a real date and a real slot, not "the chosen time".
    expect(review.textContent).toContain('Date');
    expect(review.textContent).toContain('Time');
    expect(review.textContent).toContain('Duration');
    // Who cuts: no specialist chosen means any available one, said plainly.
    expect(review.textContent).toContain('Any available barber');
  });

  it('names the chosen barber instead of "any"', async () => {
    const { container } = await openSchedule([{ barberId: 'br-1', fullName: 'Amit Jichkar', isAvailable: true }]);
    await act(async () => { byText('Amit Jichkar', container).click(); });
    await flush();
    const review = await openReview(container);
    expect(review.textContent).toContain('Amit Jichkar');
    expect(review.textContent).not.toContain('Any available barber');
  });

  it('carries the "Pay at Salon after Service" note, with the amount', async () => {
    const { container } = await openSchedule();
    const review = await openReview(container);
    const pay = review.querySelector('.booking-review-pay');
    expect(pay).not.toBeNull();
    expect(pay.textContent).toContain('Pay at Salon after Service');
    expect(pay.textContent).toContain('Pay ₹ 450 at the salon after your service');
    expect(pay.textContent).toContain('Nothing is charged now.');
    // Still not a payment form: the card asks for nothing but a decision.
    expect(review.querySelectorAll('input')).toHaveLength(0);
  });

  it('sends nothing when the customer backs out of the checkout', async () => {
    const { container } = await openSchedule();
    await openReview(container);
    await act(async () => { byText('Back', container).click(); });
    await flush();
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(container.querySelector('.booking-review')).toBeNull();
    // …and the bar still opens it again, so backing out is not a dead end.
    expect(await openReview(container)).not.toBeNull();
  });

  it('creates the request only from the checkout button, then shows the sent screen', async () => {
    const { container } = await openSchedule();
    await openReview(container);
    await act(async () => { byText('Send booking request', container).click(); });
    await flush();

    expect(createBookingRequest).toHaveBeenCalledTimes(1);
    const payload = createBookingRequest.mock.calls[0][0];
    expect(payload.salonId).toBe('salon-1');
    expect(payload.services).toEqual(['svc-1', 'svc-2']);
    expect(payload.bookingDate).toBe(futureDate());
    expect(payload.bookingTime).toBeTruthy();
    expect(payload).not.toHaveProperty('paymentMode');
    expect(container.querySelector('.booking-review')).toBeNull();
    expect(container.textContent).toContain('Booking sent to the salon');
  });
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

    // Pick tomorrow first: the screen pre-selects the first free slot of TODAY,
    // and late in the evening there is none left (the salon closes at 21:00), so
    // this test used to pass in the morning and fail after dark.
    await act(async () => { byText('Tomorrow', container).click(); });
    await flush();

    await act(async () => { byText('Review & confirm', container).click(); });
    await flush();
    await act(async () => { byText('Send booking request', container).click(); });
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
