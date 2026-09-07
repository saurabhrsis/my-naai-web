'use strict';

// Run with:  node --test backend/tests/bookingClock.test.js
// No test framework needed — this uses the Node built-in runner.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  describeDuration,
  formatTimeLabel,
  isValidDateString,
  isValidOffset,
  isValidTimeString,
  normaliseTime,
  offsetDirection,
  offsetForTargetTime,
  shiftBookingTime,
} = require('../lib/bookingClock');

const { buildTimeChangeCopy } = require('../lib/notifyCustomer');

test('shiftBookingTime moves a booking later', () => {
  const result = shiftBookingTime('2026-09-07', '18:30:00', 45);
  assert.equal(result.date, '2026-09-07');
  assert.equal(result.time, '19:15:00');
  assert.equal(result.crossesDay, false);
});

test('shiftBookingTime moves a booking earlier', () => {
  const result = shiftBookingTime('2026-09-07', '18:30:00', -25);
  assert.equal(result.time, '18:05:00');
  assert.equal(result.crossesDay, false);
});

test('shiftBookingTime rolls the date forward past midnight', () => {
  const result = shiftBookingTime('2026-09-07', '23:45:00', 45);
  assert.equal(result.date, '2026-09-08');
  assert.equal(result.time, '00:30:00');
  assert.equal(result.crossesDay, true);
});

test('shiftBookingTime rolls the date back before midnight', () => {
  const result = shiftBookingTime('2026-09-08', '00:15:00', -30);
  assert.equal(result.date, '2026-09-07');
  assert.equal(result.time, '23:45:00');
  assert.equal(result.crossesDay, true);
});

test('shiftBookingTime crosses a month boundary', () => {
  const result = shiftBookingTime('2026-09-30', '23:50:00', 30);
  assert.equal(result.date, '2026-10-01');
  assert.equal(result.time, '00:20:00');
});

test('shiftBookingTime rejects unusable input', () => {
  assert.equal(shiftBookingTime('not-a-date', '18:30:00', 10), null);
  assert.equal(shiftBookingTime('2026-09-07', 'half past six', 10), null);
  assert.equal(shiftBookingTime('2026-09-07', '18:30:00', 10.5), null);
});

test('offsetForTargetTime derives the offset from an exact time', () => {
  assert.equal(offsetForTargetTime('2026-09-07', '18:30:00', '19:15'), 45);
  assert.equal(offsetForTargetTime('2026-09-07', '18:30:00', '18:05'), -25);
});

test('offsetForTargetTime reads small hours after a late booking as next day', () => {
  assert.equal(offsetForTargetTime('2026-09-07', '23:45:00', '00:15'), 30);
});

test('offsetForTargetTime still treats an ordinary earlier pick as earlier', () => {
  assert.equal(offsetForTargetTime('2026-09-07', '18:30:00', '10:00'), -510);
});

test('offsetForTargetTime honours an explicit date over the guess', () => {
  assert.equal(offsetForTargetTime('2026-09-07', '23:45:00', '00:15', '2026-09-08'), 30);
  assert.equal(offsetForTargetTime('2026-09-07', '10:00:00', '09:00', '2026-09-07'), -60);
});

test('offsetForTargetTime rejects bad input', () => {
  assert.equal(offsetForTargetTime('2026-09-07', '18:30:00', ''), null);
  assert.equal(offsetForTargetTime('2026-09-07', '18:30:00', '19:00', 'nonsense'), null);
});

test('isValidOffset enforces the range and rejects zero', () => {
  assert.equal(isValidOffset(20), true);
  assert.equal(isValidOffset(-15), true);
  assert.equal(isValidOffset(0), false);
  assert.equal(isValidOffset(241), false);
  assert.equal(isValidOffset(-121), false);
  assert.equal(isValidOffset(20.5), false);
  assert.equal(isValidOffset('20'), false);
});

test('isValidDateString rejects impossible dates', () => {
  assert.equal(isValidDateString('2026-09-07'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('2026-13-01'), false);
  assert.equal(isValidDateString('07-09-2026'), false);
});

test('isValidTimeString and normaliseTime agree on shapes', () => {
  assert.equal(isValidTimeString('19:15'), true);
  assert.equal(isValidTimeString('19:15:30'), true);
  assert.equal(isValidTimeString('25:00'), false);
  assert.equal(normaliseTime('9:05'), '09:05:00');
  assert.equal(normaliseTime('19:15:30'), '19:15:30');
  assert.equal(normaliseTime('nope'), '');
});

test('describeDuration always reports the magnitude, never a minus sign', () => {
  assert.equal(describeDuration(15), '15 minutes');
  assert.equal(describeDuration(-15), '15 minutes');
  assert.equal(describeDuration(60), '1 hour');
  assert.equal(describeDuration(-90), '1 hour 30 minutes');
  assert.equal(describeDuration(1), '1 minute');
});

test('formatTimeLabel renders a 12-hour label', () => {
  assert.equal(formatTimeLabel('19:15:00'), '07:15 pm');
  assert.equal(formatTimeLabel('00:05:00'), '12:05 am');
  assert.equal(formatTimeLabel('12:00:00'), '12:00 pm');
});

test('offsetDirection reads the sign', () => {
  assert.equal(offsetDirection(20), 'LATER');
  assert.equal(offsetDirection(-20), 'EARLIER');
});

test('customer copy words a delay as a delay', () => {
  const copy = buildTimeChangeCopy({
    salonName: 'Sharp Cuts',
    offsetMinutes: 15,
    proposedTime: '18:45:00',
  });
  assert.equal(copy.title, 'Your appointment is running late');
  assert.match(copy.body, /Sharp Cuts needs 15 minutes more/);
  assert.match(copy.body, /06:45 pm/);
});

test('customer copy words an earlier slot as an offer, not a negative delay', () => {
  const copy = buildTimeChangeCopy({
    salonName: 'Sharp Cuts',
    offsetMinutes: -15,
    proposedTime: '18:15:00',
  });
  assert.equal(copy.title, 'Earlier time available');
  assert.match(copy.body, /15 minutes earlier/);
  assert.doesNotMatch(copy.body, /-15/);
  assert.doesNotMatch(copy.body, /delay/i);
});

test('customer copy appends the salon note and the new day when it crosses', () => {
  const copy = buildTimeChangeCopy({
    salonName: 'Sharp Cuts',
    offsetMinutes: 45,
    proposedTime: '00:30:00',
    crossesDay: true,
    proposedDateLabel: '2026-09-08',
    reason: 'Previous cut running long',
  });
  assert.match(copy.body, /on 2026-09-08/);
  assert.match(copy.body, /Previous cut running long/);
});
