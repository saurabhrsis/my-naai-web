import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HomeScreen, SalonDetailScreen } from './UserScreens';
import { salonHoursLabel } from './Shared';

// The salon now has to answer this page out of its own record, so the API is
// mocked down to the two calls these screens make.
const { salonByIdInfo, userSalonList, userSalonListPublic } = vi.hoisted(() => ({
  salonByIdInfo: vi.fn(),
  userSalonList: vi.fn(),
  userSalonListPublic: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual('../lib/api');
  return { ...actual, api: { ...actual.api, salonByIdInfo, userSalonList, userSalonListPublic } };
});

vi.mock('../lib/push', async () => {
  const actual = await vi.importActual('../lib/push');
  return {
    ...actual,
    getPushStatus: vi.fn().mockResolvedValue({ state: 'needs-permission', reason: '' }),
    getPushToken: vi.fn().mockResolvedValue(''),
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigate = () => {};
const notify = () => {};
const session = { userId: 'user-7', user: { fullName: 'Sneha', phoneNumber: '9876543210' } };

const SALON = {
  salonId: 'salon-9',
  salonName: 'Golden Scissors',
  genderType: 'UNISEX',
  address: 'Dharampeth, Nagpur',
  isOpen: true,
  // The API still sends the queue's estimate. Nothing may print it: the salon
  // serves walk-in customers, so the number is stale the moment the page opens.
  waitTime: '10–15 min',
  totalWaitTime: { display: '10–15 min' },
  // Open all day, so the card's open/closed line does not depend on when the
  // suite runs (a salon that closes at 9 pm is closed for a late-evening run).
  businessHours: [{ openingTime: '00:00:00', closingTime: '23:59:00', holidayDays: [] }],
  services: [{ id: 's1', name: 'Hair cut', price: 250, duration: 30 }],
  barbers: [],
};

const flush = async () => {
  // The home screen resolves a location permission before it asks for the list,
  // so the load settles over a few macrotasks rather than one microtask.
  for (let index = 0; index < 4; index += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
};

async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await flush();
  return { container, root };
}

let mounted = null;

beforeEach(() => {
  salonByIdInfo.mockReset();
  salonByIdInfo.mockResolvedValue({ status: 'SUCCESS', data: SALON });
  // A signed-in customer reads the partner door; a visitor reads the public one.
  userSalonList.mockReset();
  userSalonList.mockResolvedValue({ status: 'SUCCESS', data: { salons: [SALON] } });
  userSalonListPublic.mockReset();
  userSalonListPublic.mockResolvedValue({ status: 'SUCCESS', data: { salons: [SALON] } });
});

afterEach(() => {
  if (mounted) act(() => mounted.unmount());
  mounted = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('no promised waiting time', () => {
  // Reported from the salon page, in the customer's words: "while booking don't
  // show the Current wait, because Salon can have offline customer too, so we
  // cannot decide the exact time". A waiting time is a promise the salon cannot
  // keep — an offline customer who sits down while the page is open breaks it —
  // so the tile is gone and nothing replaces it with another number.
  it('drops the "Current wait" tile from the salon page', async () => {
    mounted = (await render(<SalonDetailScreen session={session} params={{ salonId: SALON.salonId, salon: SALON }} navigate={navigate} notify={notify} />)).root;
    const text = document.body.textContent;

    expect(text).not.toMatch(/current wait/i);
    expect(text).not.toMatch(/10\s*[–-]\s*15\s*min/);
    expect(text).not.toMatch(/estimated wait/i);
    // The stat row still exists — it carries the number of services instead.
    expect(document.querySelectorAll('.detail-stat-grid > div')).toHaveLength(2);
    expect(document.querySelector('.detail-stat-grid').textContent).toContain('Services');
    // …and the salon's real opening hours are still stated, so the customer can
    // tell when to come without being quoted a queue.
    expect(document.querySelector('.detail-status-line').textContent).toContain('12:00 am');
  });

  it('shows the salon\'s opening hours on the card, not a queue estimate', async () => {
    mounted = (await render(<HomeScreen session={session} navigate={navigate} notify={notify} />)).root;
    const card = document.querySelector('.salon-card');

    expect(card).not.toBeNull();
    expect(card.textContent).not.toMatch(/10\s*[–-]\s*15\s*min/);
    expect(card.querySelector('.wait-copy')).toBeNull();
    const copy = card.querySelector('.salon-hours-copy');
    expect(copy).not.toBeNull();
    expect(copy.textContent).toContain('12:00 am');
    expect(copy.textContent).toContain('11:59 pm');
  });

  it('falls back to a plain "Open now", never to minutes, when hours are missing', async () => {
    expect(salonHoursLabel([])).toBe('');
    expect(salonHoursLabel([{ openingTime: '', closingTime: '' }])).toBe('');
    expect(salonHoursLabel({ openingTime: '10:30:00', closingTime: '20:00:00' })).toBe('10:30 am – 08:00 pm');
    expect(salonHoursLabel(undefined)).toBe('');
  });
});
