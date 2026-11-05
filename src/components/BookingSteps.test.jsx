import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ScheduleScreen, ServicesScreen } from './UserScreens';

// The reported bug: a customer on Schedule appointment taps back to change a
// service and the services screen is empty. The booking steps used to receive the
// whole salon record as an in-memory route param and nothing else, so the browser's
// Back re-parsed a URL that carried no salon and the screen rendered its "no
// services listed" state. Both steps now survive a URL round trip: the salon comes
// from the id, and the schedule's chosen services from their ids.
const { salonByIdInfo, createBookingRequest } = vi.hoisted(() => ({
  salonByIdInfo: vi.fn(),
  createBookingRequest: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, salonByIdInfo, createBookingRequest } };
});

vi.mock('../lib/socket', () => ({ subscribeToLiveUpdates: () => () => {} }));
vi.mock('../lib/reminders', () => ({
  armStoredReminders: vi.fn(),
  cancelBookingReminder: vi.fn(),
  remindersEnabled: () => false,
  scheduleBookingReminder: vi.fn(),
  setRemindersEnabled: vi.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

async function render(node) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(node); });
  await flush();
  return { container, root };
}

const byText = (label, container = document.body) => Array.from(container.querySelectorAll('button'))
  .find(node => node.textContent.trim().replace(/\s+/g, ' ').startsWith(label));

// Every test gets its own salon id: the screen keeps the record in a module-level
// cache (that is what makes Back instant), so reusing an id would let one test's
// state leak into the next.
let salonSeq = 0;
const makeSalon = () => ({
  salonId: `salon-${++salonSeq}`,
  salonName: 'Glow Studio',
  address: '12 Wardha Road',
  city: 'Nagpur',
  services: [
    { serviceId: 'svc-1', name: 'Haircut', price: 300, durationMinutes: 30 },
    { serviceId: 'svc-2', name: 'Beard trim', price: 150, durationMinutes: 15 },
    { serviceId: 'svc-3', name: 'Hair spa', price: 900, durationMinutes: 45 },
  ],
  barbers: [{ barberId: 'br-1', fullName: 'Amit Jichkar', isAvailable: true }],
  businessHours: { openingTime: '09:00:00', closingTime: '21:00:00', holidayDays: [] },
  bookedSlots: [],
});

// Two of the reported problems are pure CSS — a scroll box inside the time grid,
// and a dialog that scrolled as one piece so its buttons left the screen — so the
// guarantees are read from the stylesheet, with each rule's enclosing @media kept
// in `context` so a desktop rule cannot satisfy a phone assertion.
function cssRules() {
  const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let context = '';
  let selector = '';
  let buffer = '';
  let depth = 0;
  for (const char of css) {
    if (char === '{') {
      depth += 1;
      if (depth === 1 && /^\s*@/.test(buffer)) { context = buffer.trim(); selector = ''; } else selector = buffer.trim();
      buffer = '';
    } else if (char === '}') {
      if (selector) rules.push({ selector, context, body: buffer });
      depth -= 1;
      if (depth === 0) context = '';
      buffer = '';
      selector = '';
    } else buffer += char;
  }
  return rules;
}

const ruleFor = (selector, context = '') => cssRules().find(rule => rule.selector === selector && rule.context === context);

beforeEach(() => {
  vi.clearAllMocks();
  salonByIdInfo.mockResolvedValue({ status: 'SUCCESS', data: makeSalon() });
  createBookingRequest.mockResolvedValue({ status: 'SUCCESS', data: { bookingRequestId: 'req-1' } });
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('coming back to the services list', () => {
  it('loads the salon from the id in the URL — the case that used to render an empty page', async () => {
    const { container } = await render(<ServicesScreen params={{ salonId: 'salon-42' }} navigate={vi.fn()} notify={vi.fn()} />);

    expect(salonByIdInfo).toHaveBeenCalledWith({ salonId: 'salon-42' });
    expect(container.textContent).toContain('Glow Studio');
    for (const name of ['Haircut', 'Beard trim', 'Hair spa']) {
      expect(container.textContent).toContain(name);
    }
    expect(container.textContent).toContain('₹ 300');
    // The empty state that used to show instead.
    expect(container.textContent).not.toContain('No services listed');
  });

  it('says it is loading instead of flashing "no services", then paints the list', async () => {
    const salon = makeSalon();
    let release;
    salonByIdInfo.mockReturnValue(new Promise(resolve => { release = () => resolve({ status: 'SUCCESS', data: salon }); }));
    const { container } = await render(<ServicesScreen params={{ salonId: salon.salonId }} navigate={vi.fn()} notify={vi.fn()} />);

    expect(container.textContent).toContain('Loading services');
    expect(container.textContent).not.toContain('No services listed');

    await act(async () => { release(); });
    await flush();
    expect(container.textContent).toContain('Haircut');
  });

  it('uses the record handed over in-session without asking the API again', async () => {
    const salon = makeSalon();
    const { container } = await render(<ServicesScreen params={{ salon, salonId: salon.salonId }} navigate={vi.fn()} notify={vi.fn()} />);
    expect(salonByIdInfo).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Haircut');
  });

  it('hands the salon id and the chosen services to the schedule URL', async () => {
    const navigate = vi.fn();
    const salon = makeSalon();
    const { container } = await render(<ServicesScreen params={{ salon, salonId: salon.salonId }} navigate={navigate} notify={vi.fn()} />);

    await act(async () => { byText('Haircut', container).click(); });
    await act(async () => { byText('Beard trim', container).click(); });
    await flush();
    await act(async () => { byText('Choose a time', container).click(); });

    const [, params] = navigate.mock.calls.at(-1);
    expect(navigate.mock.calls.at(-1)[0]).toBe('schedule');
    expect(params.salonId).toBe(salon.salonId);
    expect(params.selectedServices.map(item => item.serviceId)).toEqual(['svc-1', 'svc-2']);
  });

  it('re-ticks what was picked when the customer steps back to change one service', async () => {
    const salon = makeSalon();
    const first = await render(<ServicesScreen params={{ salon, salonId: salon.salonId }} navigate={vi.fn()} notify={vi.fn()} />);
    await act(async () => { byText('Haircut', first.container).click(); });
    await act(async () => { byText('Choose a time', first.container).click(); });
    await flush();
    act(() => first.root.unmount());
    first.container.remove();

    // Back on the services screen — by id only, the way a history pop arrives.
    const second = await render(<ServicesScreen params={{ salonId: salon.salonId }} navigate={vi.fn()} notify={vi.fn()} />);
    const ticked = Array.from(second.container.querySelectorAll('.select-service-card.active')).map(node => node.textContent);
    expect(ticked.join(' ')).toContain('Haircut');
    expect(ticked.join(' ')).not.toContain('Hair spa');
    expect(second.container.textContent).toContain('1 selected');
  });
});

describe('the schedule opened from a URL', () => {
  it('resolves the chosen services from their ids, with the salon’s own names and prices', async () => {
    const salon = makeSalon();
    salonByIdInfo.mockResolvedValue({ status: 'SUCCESS', data: salon });
    const { container } = await render(
      <ScheduleScreen params={{ salonId: salon.salonId, serviceIds: ['svc-1', 'svc-3'] }} navigate={vi.fn()} notify={vi.fn()} />,
    );

    expect(salonByIdInfo).toHaveBeenCalledWith({ salonId: salon.salonId });
    expect(container.textContent).toContain('Glow Studio');
    // The sticky bar quotes the sum of the two resolved services (300 + 900).
    expect(container.querySelector('.schedule-total').textContent).toContain('₹ 1,200');

    const review = await (async () => {
      await act(async () => { byText('Review & confirm', container).click(); });
      await flush();
      return container.querySelector('.booking-review');
    })();
    expect(review.textContent).toContain('Haircut');
    expect(review.textContent).toContain('Hair spa');
    expect(review.querySelector('.booking-review-total').textContent).toContain('₹ 1,200');
  });

  it('shows a loading state, not a broken schedule, while the salon is fetched', async () => {
    const salon = makeSalon();
    let release;
    salonByIdInfo.mockReturnValue(new Promise(resolve => { release = () => resolve({ status: 'SUCCESS', data: salon }); }));
    const { container } = await render(
      <ScheduleScreen params={{ salonId: salon.salonId, serviceIds: ['svc-1'] }} navigate={vi.fn()} notify={vi.fn()} />,
    );
    expect(container.textContent).toContain('Loading the salon');
    await act(async () => { release(); });
    await flush();
    expect(container.querySelector('.schedule-total')).not.toBeNull();
  });

  it('keeps sending the salon id when the record came from the URL', async () => {
    const salon = makeSalon();
    salonByIdInfo.mockResolvedValue({ status: 'SUCCESS', data: salon });
    const { container } = await render(
      <ScheduleScreen params={{ salonId: salon.salonId, serviceIds: ['svc-2'] }} navigate={vi.fn()} notify={vi.fn()} />,
    );
    await act(async () => { byText('Tomorrow', container).click(); });
    await flush();
    await act(async () => { byText('Review & confirm', container).click(); });
    await flush();
    await act(async () => { byText('Send booking request', container).click(); });
    await flush();

    expect(createBookingRequest).toHaveBeenCalledTimes(1);
    expect(createBookingRequest.mock.calls[0][0].salonId).toBe(salon.salonId);
    expect(createBookingRequest.mock.calls[0][0].services).toEqual(['svc-2']);
  });
});

describe('no scroll boxes inside scroll boxes', () => {
  it('lets the time grid grow instead of scrolling on its own', () => {
    const grid = ruleFor('.time-grid');
    expect(grid).toBeDefined();
    // The page scrolls; the slots do not get a second, inner scrollbar.
    expect(grid.body).not.toMatch(/max-height/);
    expect(grid.body).not.toMatch(/overflow/);
    // …and no media query puts the cap back.
    const offenders = cssRules().filter(rule => rule.selector === '.time-grid' && /max-height|overflow/.test(rule.body));
    expect(offenders).toEqual([]);
  });

  it('keeps a dialog’s title and its buttons pinned, scrolling only the middle', () => {
    const card = ruleFor('.modal-card');
    expect(card.body).toMatch(/display:\s*flex/);
    expect(card.body).toMatch(/flex-direction:\s*column/);
    expect(card.body).not.toMatch(/overflow:\s*auto/);

    expect(ruleFor('.modal-header').body).toMatch(/flex:\s*none/);
    expect(ruleFor('.modal-footer').body).toMatch(/flex:\s*none/);
    const body = ruleFor('.modal-body');
    expect(body.body).toMatch(/overflow-y:\s*auto/);
    expect(body.body).toMatch(/flex:\s*1 1 auto/);
  });
});
