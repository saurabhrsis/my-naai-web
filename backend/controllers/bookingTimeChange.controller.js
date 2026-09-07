'use strict';

const mongoose = require('mongoose');

const BookingRequest = require('../models/bookingRequest.model');
const {
  MAX_OFFSET_MINUTES,
  MIN_OFFSET_MINUTES,
  formatTimeLabel,
  isInPast,
  isValidDateString,
  isValidOffset,
  normaliseTime,
  offsetDirection,
  offsetForTargetTime,
  shiftBookingTime,
} = require('../lib/bookingClock');
const {
  notifyCustomerOfTimeChange,
  notifySalonOfResponse,
} = require('../lib/notifyCustomer');

// Adjust these two to your project. Booking is only needed if you mirror the
// time onto a separate Booking document once the customer accepts.
const Booking = mongoose.models.Booking || null;
const User = mongoose.models.User || null;
const Salon = mongoose.models.Salon || null;

const fail = (res, code, message) => res.status(code).json({ status: 'FAILURE', message });
const ok = (res, message, data) => res.status(200).json({ status: 'SUCCESS', message, data });

/**
 * Resolve the requested change from the body.
 *
 * Two shapes arrive here:
 *   quick offset  -> { delayMinutes: '20' }
 *   exact time    -> { delayMinutes: '45', newBookingTime: '19:15:00', newBookingDate: '2026-09-07' }
 *
 * When an exact time is present it wins and the offset is RECOMPUTED from it.
 * The client's arithmetic is a convenience, not evidence: a tab left open past
 * midnight, a device with a wrong clock, or a hand-rolled request would
 * otherwise be able to move a booking somewhere nobody intended.
 *
 * Returns { ok: true, offsetMinutes, target } or { ok: false, message }.
 */
function resolveRequestedChange(booking, body) {
  const { bookingDate, bookingTime } = booking;

  if (!isValidDateString(bookingDate) || !normaliseTime(bookingTime)) {
    return { ok: false, message: 'This booking has no usable date and time, so it cannot be moved.' };
  }

  const rawTime = typeof body.newBookingTime === 'string' ? body.newBookingTime.trim() : '';
  const rawDate = typeof body.newBookingDate === 'string' ? body.newBookingDate.trim() : '';

  if (rawTime) {
    const targetTime = normaliseTime(rawTime);
    if (!targetTime) {
      return { ok: false, message: 'newBookingTime must be a time like "19:15" or "19:15:00".' };
    }
    if (rawDate && !isValidDateString(rawDate)) {
      return { ok: false, message: 'newBookingDate must be a date like "2026-09-07".' };
    }

    const offsetMinutes = offsetForTargetTime(bookingDate, bookingTime, targetTime, rawDate);
    if (offsetMinutes === null) {
      return { ok: false, message: 'Could not work out the new time from the values sent.' };
    }
    if (offsetMinutes === 0) {
      return { ok: false, message: 'That is already the booked time. Pick a different one.' };
    }
    if (!isValidOffset(offsetMinutes)) {
      return {
        ok: false,
        message: `A booking can move between ${MIN_OFFSET_MINUTES} and ${MAX_OFFSET_MINUTES} minutes. Rebook the appointment for anything larger.`,
      };
    }

    // Derive the target through the same shift the offset path uses, so both
    // routes produce byte-identical stored values.
    const target = shiftBookingTime(bookingDate, bookingTime, offsetMinutes);
    return { ok: true, offsetMinutes, target };
  }

  // Quick-offset path. `delayMinutes` arrives as a string from the apps.
  const raw = body.delayMinutes;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: false, message: 'delayMinutes is required (positive to delay, negative to move earlier).' };
  }

  const offsetMinutes = Number(String(raw).trim());
  if (!Number.isInteger(offsetMinutes)) {
    return { ok: false, message: 'delayMinutes must be a whole number of minutes.' };
  }
  if (offsetMinutes === 0) {
    return { ok: false, message: 'delayMinutes cannot be zero — that is not a change.' };
  }
  if (!isValidOffset(offsetMinutes)) {
    return {
      ok: false,
      message: `delayMinutes must be between ${MIN_OFFSET_MINUTES} and ${MAX_OFFSET_MINUTES}.`,
    };
  }

  const target = shiftBookingTime(bookingDate, bookingTime, offsetMinutes);
  if (!target) {
    return { ok: false, message: 'Could not work out the new time from the values sent.' };
  }
  return { ok: true, offsetMinutes, target };
}

/** Does this token's owner own this booking's salon? */
function ownsBooking(req, booking) {
  const callerSalonId = String(req.user?.salonId || req.user?._id || '');
  return callerSalonId && String(booking.salonId) === callerSalonId;
}

/**
 * POST /api/bookingRequest/owner-action/:bookingRequestId/
 * body: { action: 'DELAY', delayMinutes, newBookingDate?, newBookingTime?, proposedTime?, reason? }
 *
 * Mount this as the DELAY branch of your existing owner-action handler; ACCEPT
 * and REJECT stay where they are.
 */
async function proposeTimeChange(req, res) {
  try {
    const { bookingRequestId } = req.params;
    if (!mongoose.isValidObjectId(bookingRequestId)) {
      return fail(res, 400, 'Invalid booking request id.');
    }

    const booking = await BookingRequest.findById(bookingRequestId);
    if (!booking) return fail(res, 404, 'Booking request not found.');
    if (!ownsBooking(req, booking)) {
      return fail(res, 403, 'You can only change bookings for your own salon.');
    }
    if (typeof booking.canChangeTime === 'function' && !booking.canChangeTime()) {
      // Notifying someone about an appointment that is over, cancelled or was
      // never accepted is worse than doing nothing at all.
      return fail(res, 409, `This booking is ${String(booking.status).toLowerCase()} and its time can no longer be changed.`);
    }

    const resolved = resolveRequestedChange(booking, req.body || {});
    if (!resolved.ok) return fail(res, 400, resolved.message);

    const { offsetMinutes, target } = resolved;

    if (isInPast(target.date, target.time)) {
      return fail(res, 400, 'That time has already passed. Pick a time in the future.');
    }

    const reason = typeof req.body.reason === 'string'
      ? req.body.reason.trim().slice(0, 200)
      : '';

    // Duplicate tap / retried request: same proposal already pending, so report
    // success without sending the customer a second identical notification.
    const alreadyPending = booking.timeChangeStatus === 'PENDING'
      && booking.proposedBookingDate === target.date
      && booking.proposedBookingTime === target.time
      && booking.delayMinutes === offsetMinutes;

    const previousDate = booking.bookingDate;
    const previousTime = booking.bookingTime;

    if (!alreadyPending) {
      booking.proposedBookingDate = target.date;
      booking.proposedBookingTime = target.time;
      booking.delayMinutes = offsetMinutes;
      booking.timeChangeReason = reason;
      booking.timeChangeStatus = 'PENDING';
      booking.timeChangeRequestedAt = new Date();
      booking.timeChangeRespondedAt = null;
      booking.status = 'DELAY_REQUESTED';
      booking.timeChangeHistory.push({
        event: 'PROPOSED',
        delayMinutes: offsetMinutes,
        direction: offsetDirection(offsetMinutes),
        fromBookingDate: previousDate,
        fromBookingTime: normaliseTime(previousTime),
        toBookingDate: target.date,
        toBookingTime: target.time,
        reason,
        actorRole: 'SALON',
        actorId: req.user?._id,
        at: new Date(),
      });

      await booking.save();
    }

    // The write is committed; a push failure below must not undo it.
    let notified = false;
    if (!alreadyPending) {
      const [customer, salon] = await Promise.all([
        User ? User.findById(booking.userId).select('deviceToken firstName name fullName').lean() : null,
        Salon ? Salon.findById(booking.salonId).select('salonName name').lean() : null,
      ]);

      notified = await notifyCustomerOfTimeChange({
        deviceToken: customer?.deviceToken,
        salonName: salon?.salonName || salon?.name,
        customerName: booking.userName || customer?.firstName || customer?.name || customer?.fullName,
        bookingRequestId: String(booking._id),
        bookingId: booking.bookingId ? String(booking.bookingId) : '',
        offsetMinutes,
        proposedDate: target.date,
        proposedTime: target.time,
        proposedDateLabel: target.date,
        crossesDay: target.crossesDay,
        reason,
      });
    }

    return ok(
      res,
      notified
        ? 'Customer notified about the new time.'
        : 'New time saved. The customer could not be reached by notification.',
      {
        bookingRequestId: String(booking._id),
        delayMinutes: offsetMinutes,
        direction: offsetDirection(offsetMinutes),
        previousBookingDate: previousDate,
        previousBookingTime: normaliseTime(previousTime),
        proposedBookingDate: target.date,
        proposedBookingTime: target.time,
        proposedTimeLabel: formatTimeLabel(target.time),
        crossesDay: target.crossesDay,
        reason,
        timeChangeStatus: booking.timeChangeStatus,
        notified,
      },
    );
  } catch (error) {
    console.error('[proposeTimeChange]', error);
    return fail(res, 500, 'Could not update the appointment time. Please try again.');
  }
}

/**
 * POST /api/bookingRequest/customer-delay-response/:bookingRequestId/
 * body: { action: 'ACCEPT' | 'REJECT' }
 *
 * The proposed time only becomes the real time here. Until the customer
 * answers, they still hold the slot they originally agreed to.
 */
async function respondToTimeChange(req, res) {
  try {
    const { bookingRequestId } = req.params;
    if (!mongoose.isValidObjectId(bookingRequestId)) {
      return fail(res, 400, 'Invalid booking request id.');
    }

    const action = String(req.body?.action || '').toUpperCase();
    if (action !== 'ACCEPT' && action !== 'REJECT') {
      return fail(res, 400, "action must be 'ACCEPT' or 'REJECT'.");
    }

    const booking = await BookingRequest.findById(bookingRequestId);
    if (!booking) return fail(res, 404, 'Booking request not found.');

    if (String(booking.userId) !== String(req.user?._id)) {
      return fail(res, 403, 'You can only respond to your own booking.');
    }
    if (booking.timeChangeStatus !== 'PENDING') {
      // Tapping the notification twice must not move the booking twice.
      return fail(res, 409, 'There is no time change waiting for your response.');
    }

    const accepted = action === 'ACCEPT';
    const proposedDate = booking.proposedBookingDate;
    const proposedTime = booking.proposedBookingTime;
    const originalDate = booking.bookingDate;
    const originalTime = normaliseTime(booking.bookingTime);

    if (accepted) {
      booking.bookingDate = proposedDate;
      booking.bookingTime = proposedTime;
      // Keep the visible slot window in step with the new start.
      if (booking.startTime) {
        const shiftedStart = shiftBookingTime(originalDate, booking.startTime, booking.delayMinutes);
        if (shiftedStart) booking.startTime = shiftedStart.time;
      }
      if (booking.endTime) {
        const shiftedEnd = shiftBookingTime(originalDate, booking.endTime, booking.delayMinutes);
        if (shiftedEnd) booking.endTime = shiftedEnd.time;
      }
      booking.timeChangeStatus = 'ACCEPTED';
    } else {
      booking.timeChangeStatus = 'REJECTED';
    }

    booking.status = 'ACCEPTED';
    booking.timeChangeRespondedAt = new Date();
    booking.timeChangeHistory.push({
      event: accepted ? 'ACCEPTED' : 'REJECTED',
      delayMinutes: booking.delayMinutes,
      direction: offsetDirection(booking.delayMinutes),
      fromBookingDate: originalDate,
      fromBookingTime: originalTime,
      toBookingDate: accepted ? proposedDate : originalDate,
      toBookingTime: accepted ? proposedTime : originalTime,
      actorRole: 'CUSTOMER',
      actorId: req.user?._id,
      at: new Date(),
    });

    await booking.save();

    // Mirror onto the Booking document if you keep one.
    if (accepted && Booking && booking.bookingId) {
      await Booking.findByIdAndUpdate(booking.bookingId, {
        bookingDate: proposedDate,
        bookingTime: proposedTime,
      }).catch(error => console.error('[respondToTimeChange] booking mirror failed:', error.message));
    }

    const salon = Salon
      ? await Salon.findById(booking.salonId).select('deviceToken salonName name').lean()
      : null;

    const notified = await notifySalonOfResponse({
      deviceToken: salon?.deviceToken,
      customerName: booking.userName,
      accepted,
      bookingRequestId: String(booking._id),
      bookingId: booking.bookingId ? String(booking.bookingId) : '',
      proposedTime,
    });

    return ok(
      res,
      accepted ? 'New time accepted.' : 'Original booking time kept.',
      {
        bookingRequestId: String(booking._id),
        timeChangeStatus: booking.timeChangeStatus,
        bookingDate: booking.bookingDate,
        bookingTime: booking.bookingTime,
        bookingTimeLabel: formatTimeLabel(booking.bookingTime),
        salonNotified: notified,
      },
    );
  } catch (error) {
    console.error('[respondToTimeChange]', error);
    return fail(res, 500, 'Could not save your response. Please try again.');
  }
}

module.exports = {
  proposeTimeChange,
  resolveRequestedChange,
  respondToTimeChange,
};
