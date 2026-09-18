// Salon sends an updated time for a booking, and the customer accepts or declines.
//
// This is the third side of the same triangle the other booking controllers form:
//
//   · userCancelBooking.js       — the customer ends the booking, the salon is told
//   · ownerActionBooking.js      — the salon accepts / rejects / delays a REQUEST
//   · salonUpdateBookingTime.js  — the salon moves the time of a BOOKING it has
//                                  already taken, and asks the customer to confirm
//
// Same shape as its neighbours on purpose: one transaction, `req.salon.salonId`,
// the same guards, the same push + in-app notification, the same response body.
//
// Why the customer has to confirm instead of the time simply changing: a slot
// the customer planned their day around was moved, and they are the only person
// who can say whether they can still make it. The booking therefore goes back to
// `delay_requested` with the proposed time on it, and the customer's answer
// (customerDelayAction.js) is what turns it into `confirmed` or `cancelled`.
//
// The notification type matters as much as the copy: the web and mobile clients
// route `DELAY_TIME_PROPOSAL` straight to their "new time" screen and read
// `delayMinutes`, `proposedTime` and `reason` from the payload, so those field
// names (and the SIGN of delayMinutes — negative means earlier) are the client
// contract, not a preference.
//
//   POST /api/booking/salon/update-time/:bookingId
//   { "offsetMinutes": 30 }                       // later by 30
//   { "offsetMinutes": -15 }                      // earlier by 15
//   { "proposedTime": "17:45" }                   // an exact time
//   { "delayMinutes": 30 }                        // the web client's older name
//   { "reason": "One chair is running late", "responseWindowMinutes": 15 }

const db = require('../../database/models');
const { formatTo12Hour } = require('../../utils/timeFormat');
const sendNotificationToDevice = require('../../firebase/sendNotification');

// How long the customer has to answer before the proposal stops being live.
// Long enough to notice a phone, short enough that the salon is not left
// guessing where the slot stands.
const DEFAULT_RESPONSE_WINDOW_MINUTES = 15;
const MIN_RESPONSE_WINDOW_MINUTES = 1;
const MAX_RESPONSE_WINDOW_MINUTES = 120;
// A salon moves a booking by minutes, not by hours; anything larger is a
// mistake (or a bad client) and would be better handled as a re-booking.
const MAX_OFFSET_MINUTES = 240;
const MINUTES_IN_DAY = 24 * 60;

// The statuses a time change may be proposed on:
//   · confirmed      — the salon has taken the booking and needs to move it
//   · requested      — the salon is answering a request with a different time
//   · delay_requested— a proposal is being replaced by a better one
const OPEN_STATUSES = ['confirmed', 'requested', 'delay_requested'];
const CLOSED_STATUSES = ['cancelled', 'completed'];

function pad(value) {
  return String(value).padStart(2, '0');
}

// 'HH:mm' | 'HH:mm:ss' -> minutes since midnight, or null when unparseable.
function toMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || hours > 23 || !Number.isFinite(minutes) || minutes > 59) return null;
  return hours * 60 + minutes;
}

function toClock(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}

function toMinutesValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const minutes = Number(value);
  return Number.isFinite(minutes) ? minutes : null;
}

// The date part of a DATEONLY column, in local time — the same wall clock the
// salon and the customer both read.
function bookingDay(booking) {
  return String(booking.bookingDate || '').slice(0, 10);
}

// Today's date in the SERVER's own wall clock. `new Date().toISOString()` is
// UTC, and a salon in India at 00:30 local is still on yesterday's UTC date —
// comparing a DATEONLY column against that would call today's bookings "past"
// for five and a half hours every night.
function localDay(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isPastDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day < localDay();
}

// Every column this controller writes is one their model has at least once
// declared. The ones commented out of the model file today (`proposedBookingTime`,
// `delayMinutes`, `originalBookingTime`, `expiresAt`) would make Sequelize throw
// "Unknown attribute" the moment they are written, so they are filtered against
// the model that is actually loaded. Uncomment the columns and the writes below
// start landing with no change here.
function knownColumns(update) {
  const attributes = db.Booking.rawAttributes || {};
  return Object.fromEntries(Object.entries(update).filter(([key]) => Object.prototype.hasOwnProperty.call(attributes, key)));
}

const salonUpdateBookingTime = async (req, res) => {
  try {
    const bookingId = req.params.bookingId || req.body.bookingId;
    const salonId = req.salon?.salonId || req.body.salonId;
    const {
      proposedTime = null,
      offsetMinutes = null,
      delayMinutes = null,
      reason = '',
      responseWindowMinutes = null,
    } = req.body || {};

    if (!salonId) {
      return res.status(404).json({ status: 'FAILED', message: 'salonId not found in token' });
    }
    if (!bookingId || bookingId === 'null') {
      return res.status(400).json({ status: 'FAILED', message: 'bookingId required' });
    }

    // ── Read and validate BEFORE opening a transaction ──────────────────────
    // The neighbouring controllers open one at the top and return early from
    // half a dozen validation branches without rolling it back. Every one of
    // those returns leaves a transaction open on the connection pool until the
    // driver times it out — a few mistyped requests from a busy salon counter
    // and the pool is exhausted. Validating first keeps the transaction down to
    // the single write it exists for.
    const booking = await db.Booking.findByPk(bookingId, {
      include: [
        { model: db.User, as: 'user' },
        { model: db.Salon, as: 'salon' },
      ],
    });

    if (!booking) {
      return res.status(404).json({ status: 'FAILED', message: 'Booking not found' });
    }
    if (booking.salonId !== salonId) {
      return res.status(403).json({ status: 'FAILED', message: 'Unauthorized' });
    }
    if (CLOSED_STATUSES.includes(booking.bookingStatus)) {
      return res.status(400).json({
        status: 'FAILED',
        message: `This booking is ${booking.bookingStatus} and its time cannot be changed`,
      });
    }
    if (!OPEN_STATUSES.includes(booking.bookingStatus)) {
      return res.status(400).json({ status: 'FAILED', message: 'Booking cannot be updated' });
    }

    const day = bookingDay(booking);
    if (isPastDay(day)) {
      return res.status(400).json({ status: 'FAILED', message: 'This booking is in the past' });
    }

    const currentTime = booking.bookingTime || booking.originalBookingTime;
    const currentMinutes = toMinutes(currentTime);
    if (currentMinutes === null) {
      return res.status(400).json({ status: 'FAILED', message: 'This booking has no time to change' });
    }

    // A signed offset (the salon is late: positive; a chair freed up: negative),
    // or an exact clock time. `delayMinutes` is accepted because that is the name
    // the web portal already posts.
    const offsetInput = toMinutesValue(offsetMinutes) ?? toMinutesValue(delayMinutes);
    const targetMinutes = toMinutes(proposedTime);

    let shiftedMinutes = null;
    if (offsetInput !== null) {
      if (offsetInput === 0) {
        return res.status(400).json({ status: 'FAILED', message: 'Choose how many minutes to move the booking' });
      }
      if (Math.abs(offsetInput) > MAX_OFFSET_MINUTES) {
        return res.status(400).json({
          status: 'FAILED',
          message: `A time change can be at most ${MAX_OFFSET_MINUTES} minutes`,
        });
      }
      shiftedMinutes = currentMinutes + Math.trunc(offsetInput);
    } else if (targetMinutes !== null) {
      shiftedMinutes = targetMinutes;
    } else {
      return res.status(400).json({ status: 'FAILED', message: 'proposedTime or offsetMinutes required' });
    }

    // Moving an appointment onto another day is a different promise — a new
    // slot, a new reminder, usually a different queue — and this table carries a
    // single `bookingDate`. Refusing is the honest answer; silently writing
    // 00:20 against today's date would send the customer at the wrong time on
    // the wrong day. (Add `proposedBookingDate` when day-crossing needs to be
    // supported, and move `bookingDate` in customerDelayAction on ACCEPT.)
    if (shiftedMinutes < 0 || shiftedMinutes >= MINUTES_IN_DAY) {
      return res.status(400).json({
        status: 'FAILED',
        message: 'That time is on another day — pick a time on the same day as the booking',
      });
    }
    if (shiftedMinutes === currentMinutes) {
      return res.status(400).json({ status: 'FAILED', message: 'The booking is already at that time' });
    }

    const signedOffset = shiftedMinutes - currentMinutes;
    const proposedClock = toClock(shiftedMinutes);

    // A proposed time that has already gone cannot be accepted by anybody.
    if (day === localDay()) {
      const now = new Date();
      if (shiftedMinutes <= now.getHours() * 60 + now.getMinutes()) {
        return res.status(400).json({ status: 'FAILED', message: 'That time has already passed today' });
      }
    }

    const windowMinutes = Math.min(
      MAX_RESPONSE_WINDOW_MINUTES,
      Math.max(MIN_RESPONSE_WINDOW_MINUTES, Number(responseWindowMinutes) || DEFAULT_RESPONSE_WINDOW_MINUTES),
    );
    const expiresAt = new Date(Date.now() + windowMinutes * 60000);

    // ── The write ───────────────────────────────────────────────────────────
    const t = await db.sequelize.transaction();
    try {
      await booking.update(knownColumns({
        bookingStatus: 'delay_requested',
        ownerAction: 'delayed',
        // The original is kept so the customer's screen (and support) can still
        // show what they are being moved away from.
        originalBookingTime: booking.originalBookingTime || currentTime,
        proposedBookingTime: proposedClock,
        requestedDelayMinutes: signedOffset,
        delayMinutes: signedOffset,
        // For a booking that was already confirmed this re-opens it: it is not
        // confirmed again until the customer answers.
        expiresAt,
      }), { transaction: t });
      await t.commit();
    } catch (writeError) {
      await t.rollback();
      throw writeError;
    }

    // ── Tell the customer ───────────────────────────────────────────────────
    const salonName = booking.salon?.salonName || 'your salon';
    const fromLabel = formatTo12Hour(currentTime);
    const toLabel = formatTo12Hour(proposedClock);
    // The sign decides the words, here as much as on the customer's screen: a
    // pulled-forward appointment must never read like the salon is running late.
    const isEarlier = signedOffset < 0;
    const title = isEarlier ? 'Earlier time available' : 'Booking time update';
    const message = `${isEarlier
      ? `Good news — ${salonName} can see you earlier, at ${toLabel} instead of ${fromLabel}.`
      : `${salonName} needs a little more time — can you come at ${toLabel} instead of ${fromLabel}?`}${
      reason ? ` ${reason}` : ''
    } Please respond within ${windowMinutes} minutes.`;

    const userDeviceToken = booking.user?.deviceToken;
    if (userDeviceToken) {
      // `delayMinutes` must stay SIGNED: the customer's screen reads the sign to
      // say "earlier" instead of "running late", and getting that wrong makes
      // people arrive late. `bookingRequestId` is what the client deep-links
      // with, so it is sent alongside the bookingId.
      await sendNotificationToDevice(userDeviceToken, title, message, {
        type: 'DELAY_TIME_PROPOSAL',
        bookingId: booking.bookingId,
        bookingRequestId: booking.bookingRequestId || booking.bookingId,
        delayMinutes: signedOffset,
        proposedTime: proposedClock,
        reason: reason || '',
        expiresAt: expiresAt.toISOString(),
      });
    }

    await db.Notification.create({
      receiverType: 'USER',
      receiverId: booking.userId,
      title,
      message,
    });

    // The customer's app refreshes on `user_<id>` / `booking_status_updated`
    // (the web portal subscribes to exactly that room), and the salon's own
    // queue refreshes on the room its cancel flow already uses.
    if (req.io) {
      req.io.to(`user_${booking.userId}`).emit('booking_status_updated', {
        bookingId: booking.bookingId,
        bookingStatus: 'delay_requested',
        proposedBookingTime: proposedClock,
        delayMinutes: signedOffset,
        expiresAt: expiresAt.toISOString(),
        message,
      });
      req.io.to(`salon_${booking.salonId}`).emit('queue_updated', {
        title,
        message: `Time change sent to the customer — ${fromLabel} to ${toLabel}.`,
        bookingId: booking.bookingId,
      });
    }

    // No reminder is moved here: the booking still *is* at its original time
    // until the customer answers. When they accept, customerDelayAction sets
    // `bookingTime = proposedBookingTime` — and that is the place to cancel the
    // old reminder task (`deleteReminderTask(booking.reminderTaskName)`) and
    // recompute `reminderTime` for the new slot, or the customer is reminded at
    // a time they no longer have.

    return res.status(200).json({
      status: 'SUCCESS',
      message: 'Booking time update sent to the customer',
      data: {
        bookingId: booking.bookingId,
        bookingStatus: 'delay_requested',
        bookingTime: currentTime,
        proposedBookingTime: proposedClock,
        delayMinutes: signedOffset,
        reason: reason || null,
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('Salon Update Booking Time Error:', err);
    return res.status(500).json({ status: 'FAILED', message: err.message });
  }
};

module.exports = salonUpdateBookingTime;
