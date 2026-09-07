// Time maths for the salon "update appointment time" flow.
//
// The salon can tell a customer it is running late *or* that it can take them
// earlier. Both are the same operation with a signed offset, so everything here
// works in signed minutes: negative = earlier, positive = later.
//
// This lives outside React because the important part is not the modal, it is
// getting the resulting clock time right — that is what the customer reads in
// the notification, and an off-by-one-hour or a wrong AM/PM is worse than no
// feature at all. It is therefore plain, testable functions.

// Booking times arrive as 'HH:mm' or 'HH:mm:ss'; booking dates as 'YYYY-MM-DD'
// or a full ISO timestamp. Parse them as *local* wall-clock values: a salon
// thinks in its own clock, and `new Date('2026-09-07T18:00:00')` without a zone
// is already local, while appending 'Z' would shift the time by the offset.
export function parseBookingDateTime(date, time) {
  const dateText = String(date || '').trim();
  const timeText = String(time || '').trim();
  if (!timeText) return null;
  const timeMatch = timeText.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!timeMatch) return null;
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] || 0);
  if (!Number.isFinite(hours) || hours > 23 || !Number.isFinite(minutes) || minutes > 59) return null;
  const dateOnly = dateText.slice(0, 10);
  const dateMatch = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const base = dateMatch
    ? new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
    : new Date();
  if (Number.isNaN(base.getTime())) return null;
  base.setHours(hours, minutes, seconds, 0);
  return base;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function toApiTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

export function toApiDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

// The customer-facing label. Uses the same en-IN 12-hour formatting as the rest
// of the portal so "6:30 PM" in the modal matches "6:30 PM" in the booking list.
export function formatClockTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '';
  return value.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// Applies a signed offset and reports everything a caller needs: the API values,
// the human label, and whether the shift crossed midnight into another day
// (which the UI must warn about rather than silently move an appointment).
export function shiftBookingTime(date, time, offsetMinutes) {
  const start = parseBookingDateTime(date, time);
  const minutes = Number(offsetMinutes);
  if (!start || !Number.isFinite(minutes)) return null;
  const shifted = new Date(start.getTime() + minutes * 60000);
  return {
    original: start,
    updated: shifted,
    originalLabel: formatClockTime(start),
    updatedLabel: formatClockTime(shifted),
    apiTime: toApiTime(shifted),
    apiDate: toApiDate(shifted),
    offsetMinutes: minutes,
    // A +60 on a 23:30 booking, or a -30 on a 00:15 one, lands on another date.
    crossesDay: toApiDate(shifted) !== toApiDate(start),
    // Moving a slot into the past helps nobody; the UI blocks sending it.
    inPast: shifted.getTime() < Date.now(),
  };
}

// "20 minutes later" / "15 minutes earlier" — spelled out, because "+20" and
// "-20" are easy to misread on a phone in a busy salon.
export function describeOffset(offsetMinutes) {
  const minutes = Number(offsetMinutes);
  if (!Number.isFinite(minutes) || minutes === 0) return 'No change';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (rest) parts.push(`${rest} minute${rest === 1 ? '' : 's'}`);
  return `${parts.join(' ')} ${minutes < 0 ? 'earlier' : 'later'}`;
}

// Offsets the salon can pick with one tap. Deliberately asymmetric: running
// late is the common case and needs longer options, while pulling a customer
// in early is only reasonable by a short amount (they still have to travel).
export const EARLIER_OFFSETS = [-30, -20, -15, -10];
export const LATER_OFFSETS = [10, 20, 30, 45, 60, 90];

export const MIN_OFFSET_MINUTES = -120;
export const MAX_OFFSET_MINUTES = 240;

export function isValidOffset(offsetMinutes) {
  const minutes = Number(offsetMinutes);
  return Number.isFinite(minutes)
    && Number.isInteger(minutes)
    && minutes !== 0
    && minutes >= MIN_OFFSET_MINUTES
    && minutes <= MAX_OFFSET_MINUTES;
}
