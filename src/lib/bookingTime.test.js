import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  describeOffset,
  formatClockTime,
  isValidOffset,
  offsetForTargetTime,
  parseBookingDateTime,
  shiftBookingTime,
  shiftBookingToTime,
  toInputTime,
  toApiDate,
  toApiTime,
} from './bookingTime';

afterEach(() => { vi.useRealTimers(); });

describe('parseBookingDateTime', () => {
  it('reads HH:mm and HH:mm:ss against a plain date', () => {
    expect(toApiTime(parseBookingDateTime('2026-09-07', '18:30'))).toBe('18:30:00');
    expect(toApiTime(parseBookingDateTime('2026-09-07', '18:30:45'))).toBe('18:30:45');
  });

  it('treats the booking time as local wall-clock, not UTC', () => {
    // Appending a 'Z' here would shift an Indian salon's 6:30 PM by 5h30m.
    const parsed = parseBookingDateTime('2026-09-07', '18:30');
    expect(parsed.getHours()).toBe(18);
    expect(parsed.getMinutes()).toBe(30);
    expect(toApiDate(parsed)).toBe('2026-09-07');
  });

  it('accepts a full ISO timestamp as the date part', () => {
    expect(toApiDate(parseBookingDateTime('2026-09-07T00:00:00.000Z', '09:15'))).toBe('2026-09-07');
  });

  it('rejects unusable input instead of inventing a time', () => {
    expect(parseBookingDateTime('2026-09-07', '')).toBeNull();
    expect(parseBookingDateTime('2026-09-07', 'later')).toBeNull();
    expect(parseBookingDateTime('2026-09-07', '25:00')).toBeNull();
    expect(parseBookingDateTime('2026-09-07', '10:75')).toBeNull();
  });
});

describe('shiftBookingTime', () => {
  it('moves an appointment later and reports both clock times', () => {
    const result = shiftBookingTime('2026-09-07', '18:30', 20);
    expect(result.apiTime).toBe('18:50:00');
    expect(result.originalLabel).toBe(formatClockTime(result.original));
    expect(result.updatedLabel).toContain('50');
    expect(result.crossesDay).toBe(false);
  });

  it('moves an appointment earlier', () => {
    expect(shiftBookingTime('2026-09-07', '18:30', -15).apiTime).toBe('18:15:00');
  });

  it('rolls the hour and the date correctly', () => {
    expect(shiftBookingTime('2026-09-07', '18:50', 20).apiTime).toBe('19:10:00');
    const crossing = shiftBookingTime('2026-09-07', '23:30', 60);
    expect(crossing.apiTime).toBe('00:30:00');
    expect(crossing.apiDate).toBe('2026-09-08');
    expect(crossing.crossesDay).toBe(true);
  });

  it('rolls backwards across midnight', () => {
    const crossing = shiftBookingTime('2026-09-07', '00:15', -30);
    expect(crossing.apiTime).toBe('23:45:00');
    expect(crossing.apiDate).toBe('2026-09-06');
    expect(crossing.crossesDay).toBe(true);
  });

  it('flags a new time that would land in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 18, 0, 0));
    expect(shiftBookingTime('2026-09-07', '18:30', 20).inPast).toBe(false);
    expect(shiftBookingTime('2026-09-07', '18:30', -45).inPast).toBe(true);
  });

  it('returns null rather than a wrong time when input is unusable', () => {
    expect(shiftBookingTime('2026-09-07', '', 20)).toBeNull();
    expect(shiftBookingTime('2026-09-07', '18:30', 'soon')).toBeNull();
  });
});

describe('describeOffset', () => {
  it('spells out direction so +20 and -20 cannot be misread', () => {
    expect(describeOffset(20)).toBe('20 minutes later');
    expect(describeOffset(-15)).toBe('15 minutes earlier');
    expect(describeOffset(1)).toBe('1 minute later');
  });

  it('renders hour-scale offsets', () => {
    expect(describeOffset(60)).toBe('1 hour later');
    expect(describeOffset(90)).toBe('1 hour 30 minutes later');
    expect(describeOffset(-120)).toBe('2 hours earlier');
  });

  it('handles the no-op', () => {
    expect(describeOffset(0)).toBe('No change');
    expect(describeOffset('nonsense')).toBe('No change');
  });
});

describe('isValidOffset', () => {
  it('accepts sensible shifts in both directions', () => {
    expect(isValidOffset(20)).toBe(true);
    expect(isValidOffset(-30)).toBe(true);
  });

  it('rejects zero, fractions and out-of-range values', () => {
    expect(isValidOffset(0)).toBe(false);
    expect(isValidOffset(2.5)).toBe(false);
    expect(isValidOffset(1000)).toBe(false);
    expect(isValidOffset(-600)).toBe(false);
    expect(isValidOffset('abc')).toBe(false);
  });
});

describe('offsetForTargetTime (exact clock-time picker)', () => {
  it('derives a positive offset for a later time', () => {
    expect(offsetForTargetTime('2026-09-07', '18:30', '19:15')).toBe(45);
  });

  it('derives a negative offset for an earlier time', () => {
    expect(offsetForTargetTime('2026-09-07', '18:30', '18:05')).toBe(-25);
  });

  it('reads a small hours target after a late booking as the next day', () => {
    // A salon open past midnight picking 00:15 for a 23:45 booking means
    // "30 minutes later", not "23.5 hours earlier".
    expect(offsetForTargetTime('2026-09-07', '23:45', '00:15')).toBe(30);
  });

  it('still treats an ordinary earlier pick as earlier', () => {
    expect(offsetForTargetTime('2026-09-07', '18:30', '10:00')).toBe(-510);
  });

  it('honours an explicit target date instead of guessing', () => {
    expect(offsetForTargetTime('2026-09-07', '23:45', '00:15', '2026-09-08')).toBe(30);
    expect(offsetForTargetTime('2026-09-07', '10:00', '09:00', '2026-09-07')).toBe(-60);
  });

  it('returns null for unusable input', () => {
    expect(offsetForTargetTime('2026-09-07', '18:30', '')).toBeNull();
    expect(offsetForTargetTime('2026-09-07', '', '19:00')).toBeNull();
  });
});

describe('shiftBookingToTime', () => {
  it('produces the same preview shape as an offset shift', () => {
    const byTime = shiftBookingToTime('2026-09-07', '18:30', '19:15');
    const byOffset = shiftBookingTime('2026-09-07', '18:30', 45);
    expect(byTime.apiTime).toBe(byOffset.apiTime);
    expect(byTime.apiDate).toBe(byOffset.apiDate);
    expect(byTime.offsetMinutes).toBe(45);
  });

  it('carries the day cross through to the API date', () => {
    const result = shiftBookingToTime('2026-09-07', '23:45', '00:15');
    expect(result.apiTime).toBe('00:15:00');
    expect(result.apiDate).toBe('2026-09-08');
    expect(result.crossesDay).toBe(true);
  });
});

describe('toInputTime', () => {
  it('renders HH:mm for an input type=time', () => {
    expect(toInputTime(parseBookingDateTime('2026-09-07', '09:05'))).toBe('09:05');
    expect(toInputTime(null)).toBe('');
  });
});
