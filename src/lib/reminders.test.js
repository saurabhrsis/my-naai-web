import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  REMINDER_MINUTES_BEFORE,
  armStoredReminders,
  cancelBookingReminder,
  reminderTimestamp,
  remindersEnabled,
  scheduleBookingReminder,
  setRemindersEnabled,
} from './reminders';

const LIST_KEY = 'mynaaiReminderList';
const PREF_KEY = 'mynaaiBookingRemindersEnabled';

function granted() {
  globalThis.Notification = vi.fn().mockImplementation(() => ({ onclick: null }));
  globalThis.Notification.permission = 'granted';
  globalThis.Notification.requestPermission = vi.fn().mockResolvedValue('granted');
}

function readList() {
  return JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
}

// A start time comfortably in the future regardless of when the test runs:
// tomorrow at the same clock time, 10 minutes from now would race the
// 30-minute lead; the reminder targets tomorrow minus 30 minutes.
const FUTURE_DATE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  delete globalThis.Notification;
});

afterEach(() => {
  delete globalThis.Notification;
});

describe('reminderTimestamp', () => {
  it('subtracts the lead time (30 minutes) from the slot start', () => {
    const ts = reminderTimestamp('2030-05-10', '14:30');
    expect(ts).toBe(new Date('2030-05-10T14:00:00').getTime());
  });

  it('returns NaN for an unparseable date or time', () => {
    expect(Number.isNaN(reminderTimestamp('10/05/2030', '14:30'))).toBe(true);
    expect(Number.isNaN(reminderTimestamp('2030-05-10', 'soon'))).toBe(true);
    expect(Number.isNaN(reminderTimestamp('', ''))).toBe(true);
  });
});

describe('remindersEnabled preference', () => {
  it('defaults to on and persists the toggle', () => {
    expect(remindersEnabled()).toBe(true);
    setRemindersEnabled(false);
    expect(remindersEnabled()).toBe(false);
    setRemindersEnabled(true);
    expect(remindersEnabled()).toBe(true);
    expect(localStorage.getItem(PREF_KEY)).toBe('true');
  });
});

describe('scheduleBookingReminder', () => {
  it('stores the pending reminder and arms the in-page fallback timer', async () => {
    granted();
    vi.useFakeTimers();
    try {
      const outcome = await scheduleBookingReminder({ bookingId: 'b-1', bookingDate: FUTURE_DATE, bookingTime: '10:00', salonName: 'Sharp Cuts' });
      expect(outcome).toBe('armed');
      const [entry] = readList();
      expect(entry.bookingId).toBe('b-1');
      expect(entry.title).toContain('Sharp Cuts');
      expect(entry.ts).toBe(reminderTimestamp(FUTURE_DATE, '10:00'));

      // The reminder fires 30 minutes before the slot and cleans itself up.
      // (vitest fake timers fire by advancing the clock, not by setSystemTime.)
      await vi.advanceTimersByTimeAsync(entry.ts - Date.now() + 5);
      expect(globalThis.Notification).toHaveBeenCalled();
      expect(readList()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when the slot is too close or reminders are off', async () => {
    granted();
    const today = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 10);
    const soonTime = new Date(Date.now() + 5 * 60 * 1000).toTimeString().slice(0, 5);
    expect(await scheduleBookingReminder({ bookingId: 'b-2', bookingDate: today, bookingTime: soonTime })).toBe('');
    expect(readList()).toEqual([]);

    setRemindersEnabled(false);
    expect(await scheduleBookingReminder({ bookingId: 'b-3', bookingDate: FUTURE_DATE, bookingTime: '10:00' })).toBe('');
    setRemindersEnabled(true);
  });

  it('does nothing without the notification permission — one shared flow', async () => {
    globalThis.Notification = { permission: 'default', requestPermission: vi.fn() };
    expect(await scheduleBookingReminder({ bookingId: 'b-4', bookingDate: FUTURE_DATE, bookingTime: '10:00' })).toBe('');
    expect(readList()).toEqual([]);
  });

  it('replaces an existing entry for the same booking', async () => {
    granted();
    await scheduleBookingReminder({ bookingId: 'b-5', bookingDate: FUTURE_DATE, bookingTime: '10:00' });
    await scheduleBookingReminder({ bookingId: 'b-5', bookingDate: FUTURE_DATE, bookingTime: '12:00' });
    expect(readList().length).toBe(1);
    expect(readList()[0].ts).toBe(reminderTimestamp(FUTURE_DATE, '12:00'));
  });
});

describe('cancelBookingReminder / armStoredReminders', () => {
  it('drops the stored reminder on cancellation', async () => {
    granted();
    await scheduleBookingReminder({ bookingId: 'b-6', bookingDate: FUTURE_DATE, bookingTime: '10:00' });
    expect(readList().length).toBe(1);
    cancelBookingReminder('b-6');
    expect(readList()).toEqual([]);
  });

  it('cleans past entries and re-arms future ones on app start', async () => {
    localStorage.setItem(LIST_KEY, JSON.stringify([
      { bookingId: 'past', ts: Date.now() - 1000, title: 'old', body: '' },
      { bookingId: 'future', ts: Date.now() + REMINDER_MINUTES_BEFORE * 60 * 1000, title: 'new', body: '' },
    ]));
    expect(armStoredReminders()).toBe(1);
    expect(readList().map(item => item.bookingId)).toEqual(['future']);
  });

  it('arms nothing when the preference is off', async () => {
    setRemindersEnabled(false);
    localStorage.setItem(LIST_KEY, JSON.stringify([{ bookingId: 'future', ts: Date.now() + 100000, title: 'new', body: '' }]));
    expect(armStoredReminders()).toBe(0);
    setRemindersEnabled(true);
  });
});
