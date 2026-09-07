'use strict';

/**
 * Wall-clock maths for booking times.
 *
 * Booking dates and times are stored as plain strings ('2026-09-07', '19:15:00')
 * because a 7:15 pm haircut is 7:15 pm in the salon, whatever the server's TZ is.
 * Everything here operates on those strings. A real Date is only ever built for
 * the "is this in the past" comparison, and even then it is anchored to the
 * salon's zone rather than the process default.
 *
 * No dependencies — this is deliberately runnable in isolation and under
 * `node --test`.
 */

// How far a single change may move a booking. A salon that needs more than four
// hours is not running late, it is rebooking; and pulling something more than
// two hours earlier means the customer is unlikely to be anywhere near the shop.
const MIN_OFFSET_MINUTES = -120;
const MAX_OFFSET_MINUTES = 240;

const SALON_TIME_ZONE = process.env.SALON_TIME_ZONE || 'Asia/Kolkata';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const pad = value => String(value).padStart(2, '0');

/** 'YYYY-MM-DD' -> true. Rejects '2026-13-40' as well as junk. */
function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip through UTC to catch 31 February and friends.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

/** 'HH:mm' or 'HH:mm:ss' -> true. */
function isValidTimeString(value) {
  if (typeof value !== 'string') return false;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
}

/** Anything time-ish -> 'HH:mm:ss', or '' if unusable. Storage is normalised. */
function normaliseTime(value) {
  if (typeof value !== 'string') return '';
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) return '';
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Minutes since midnight, or null. */
function toMinutesOfDay(time) {
  const normalised = normaliseTime(time);
  if (!normalised) return null;
  const [hours, minutes] = normalised.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Add days to 'YYYY-MM-DD' via UTC, which has no DST to trip over. */
function addDays(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Apply a signed minute offset to a booking date+time.
 *
 * Returns { date, time, crossesDay, dayShift } or null if the input is unusable.
 * A late-night booking pushed past midnight rolls the date forward; an early
 * booking pulled back before midnight rolls it back. Getting this wrong means a
 * customer is told to come at 00:15 on a day the salon is shut.
 */
function shiftBookingTime(dateString, timeString, offsetMinutes) {
  if (!isValidDateString(dateString)) return null;
  const startMinutes = toMinutesOfDay(timeString);
  if (startMinutes === null) return null;
  if (!Number.isInteger(offsetMinutes)) return null;

  const total = startMinutes + offsetMinutes;
  const dayShift = Math.floor(total / (24 * 60));
  const minutesOfDay = ((total % (24 * 60)) + 24 * 60) % (24 * 60);

  return {
    date: dayShift === 0 ? dateString : addDays(dateString, dayShift),
    time: `${pad(Math.floor(minutesOfDay / 60))}:${pad(minutesOfDay % 60)}:00`,
    crossesDay: dayShift !== 0,
    dayShift,
  };
}

/**
 * The inverse: the salon picked an exact clock time, work out the offset.
 *
 * `targetDate` is optional. Without it, a target more than 12 hours *before* the
 * booking is read as the next day — a salon closing at 00:30 that picks 00:15
 * for a 23:45 booking means half an hour later, not 23.5 hours earlier.
 *
 * The client sends its own arithmetic, but the server recomputes rather than
 * trusting it. Clock skew and stale tabs are real.
 */
function offsetForTargetTime(dateString, timeString, targetTime, targetDate) {
  if (!isValidDateString(dateString)) return null;
  const startMinutes = toMinutesOfDay(timeString);
  const targetMinutes = toMinutesOfDay(targetTime);
  if (startMinutes === null || targetMinutes === null) return null;

  const explicitDate = typeof targetDate === 'string' ? targetDate.trim() : '';
  if (explicitDate) {
    if (!isValidDateString(explicitDate)) return null;
    const dayDelta = daysBetween(dateString, explicitDate);
    return dayDelta * 24 * 60 + targetMinutes - startMinutes;
  }

  let minutes = targetMinutes - startMinutes;
  if (minutes < -12 * 60) minutes += 24 * 60;
  return minutes;
}

/** Whole days from `from` to `to`, both 'YYYY-MM-DD'. */
function daysBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}

/** -120 <= n <= 240, whole, non-zero. Zero is not a change worth notifying about. */
function isValidOffset(value) {
  return Number.isInteger(value)
    && value !== 0
    && value >= MIN_OFFSET_MINUTES
    && value <= MAX_OFFSET_MINUTES;
}

/** 'LATER' | 'EARLIER'. Drives every piece of customer-facing copy. */
function offsetDirection(offsetMinutes) {
  return offsetMinutes < 0 ? 'EARLIER' : 'LATER';
}

/**
 * "15 minutes", "1 hour", "1 hour 30 minutes" — always the magnitude.
 * The direction is carried by the surrounding sentence, never by a minus sign;
 * "delayed by -15 minutes" is not a thing a customer should ever read.
 */
function describeDuration(offsetMinutes) {
  const total = Math.abs(offsetMinutes);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  return parts.length ? parts.join(' ') : '0 minutes';
}

/** 'HH:mm:ss' -> '07:15 pm', matching what the apps display. */
function formatTimeLabel(timeString) {
  const minutesOfDay = toMinutesOfDay(timeString);
  if (minutesOfDay === null) return '';
  const hours24 = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  const meridiem = hours24 < 12 ? 'am' : 'pm';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${pad(hours12)}:${pad(minutes)} ${meridiem}`;
}

/**
 * Current wall-clock in the salon's zone as { date, time }.
 *
 * `Intl` is used rather than a Date offset so the server can run in UTC, in
 * IST, or anywhere else and still agree with the salon's own clock.
 */
function nowInSalonZone(timeZone = SALON_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const lookup = {};
  for (const part of parts) lookup[part.type] = part.value;
  // Some ICU builds render midnight as hour '24'.
  const hour = lookup.hour === '24' ? '00' : lookup.hour;
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    time: `${hour}:${lookup.minute}:${lookup.second}`,
  };
}

/**
 * Is date+time already behind the salon's clock?
 *
 * A small grace window absorbs the seconds between the salon tapping "Update"
 * and the request landing — without it, "-15 min" on a booking 15 minutes out
 * fails for no reason a human would accept.
 */
function isInPast(dateString, timeString, graceMinutes = 1, timeZone = SALON_TIME_ZONE) {
  const now = nowInSalonZone(timeZone);
  const nowKey = `${now.date} ${normaliseTime(now.time)}`;
  const shifted = shiftBookingTime(dateString, timeString, graceMinutes);
  if (!shifted) return false;
  return `${shifted.date} ${shifted.time}` < nowKey;
}

module.exports = {
  MIN_OFFSET_MINUTES,
  MAX_OFFSET_MINUTES,
  SALON_TIME_ZONE,
  addDays,
  daysBetween,
  describeDuration,
  formatTimeLabel,
  isInPast,
  isValidDateString,
  isValidOffset,
  isValidTimeString,
  normaliseTime,
  nowInSalonZone,
  offsetDirection,
  offsetForTargetTime,
  shiftBookingTime,
  toMinutesOfDay,
};
